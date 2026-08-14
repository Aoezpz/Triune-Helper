import Store from 'electron-store'
import { parse } from 'node-html-parser'
import { CLASS_ORDER } from '@shared/roster'
import { RESIST_NAMES, type ItemTip, type SpellTip, type Tip, type TipKind, type TipResult } from '@shared/tooltip'
import { clean, request, root } from './http'

/**
 * Item and spell hover cards, read from PTDex.
 *
 * Two sources, picked for what each is actually good at:
 *
 *   * **`/api/v1/spells?name=` and `/api/v1/items?name=`** answer the question
 *     the log poses. A log line says "Time Rend", never "spell 3878", and these
 *     are the only endpoints that take a name. They do a LIKE search, so the
 *     exact match is picked out here rather than trusted from the first row.
 *   * **`/spell-tooltip/<id>`** for the effect lines. "Decrease Hitpoints by
 *     200 (L1) to 500 (L60)" is the product of the spell formula tables, and
 *     re-deriving those from the raw columns would be a week of work and wrong
 *     in the interesting cases. The site already does it; this reads the answer
 *     and throws the markup away.
 *
 * Everything is cached to disk, including misses. A stream scrolling past at a
 * hundred lines a second must never turn into a hundred requests, and hovering
 * the same spell twice must not cost anything the second time.
 */

const FOUND_TTL_MS = 30 * 24 * 60 * 60 * 1000
const MISSING_TTL_MS = 24 * 60 * 60 * 1000
/** Names longer than this are not names; they are a parser accident. */
const MAX_NAME = 64

interface Cached {
  tip: Tip | null
  at: number
}

interface Persisted {
  tips: Record<string, Cached>
}

const store = new Store<Persisted>({
  name: 'triune-tooltips',
  defaults: { tips: {} },
  clearInvalidConfig: true
})

const cache = new Map<string, Cached>(Object.entries(store.get('tips') ?? {}))
/** Collapses a burst of hovers on the same name into one request. */
const inflight = new Map<string, Promise<TipResult>>()
let saveTimer: NodeJS.Timeout | null = null

const key = (kind: TipKind, name: string): string => `${kind}:${name.toLowerCase()}`

function persistSoon(): void {
  if (saveTimer) return
  // Batched: hovering down a skill list would otherwise write the file once per
  // name, and the file grows to hold every spell the trio has ever cast.
  saveTimer = setTimeout(() => {
    saveTimer = null
    store.set('tips', Object.fromEntries(cache))
  }, 3000)
  saveTimer.unref()
}

export function flushTooltips(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  store.set('tips', Object.fromEntries(cache))
}

export async function lookupTip(base: string, kind: TipKind, name: string): Promise<TipResult> {
  const trimmed = clean(name)
  if (!base) return { found: false, tip: null, error: 'No PTDex address configured.' }
  if (!trimmed || trimmed.length > MAX_NAME) return { found: false, tip: null, error: null }

  const k = key(kind, trimmed)
  const hit = cache.get(k)
  if (hit) {
    const ttl = hit.tip ? FOUND_TTL_MS : MISSING_TTL_MS
    if (Date.now() - hit.at < ttl) return { found: hit.tip !== null, tip: hit.tip, error: null }
  }

  const pending = inflight.get(k)
  if (pending) return pending

  const job = (async (): Promise<TipResult> => {
    try {
      const tip = kind === 'spell' ? await fetchSpell(base, trimmed) : await fetchItem(base, trimmed)
      cache.set(k, { tip, at: Date.now() })
      persistSoon()
      return { found: tip !== null, tip, error: null }
    } catch (err) {
      // Unreachable is not "no such spell", so it is not cached as one - the
      // next hover after the network comes back should succeed.
      return { found: false, tip: null, error: (err as Error).message }
    } finally {
      inflight.delete(k)
    }
  })()

  inflight.set(k, job)
  return job
}

/** The LIKE search can return fifty rows; only an exact name is the answer. */
function exactRow(rows: unknown, name: string, field: string): Record<string, unknown> | null {
  if (!Array.isArray(rows)) return null
  const wanted = name.toLowerCase()
  for (const row of rows) {
    if (row && typeof row === 'object' && String((row as Record<string, unknown>)[field] ?? '').toLowerCase() === wanted) {
      return row as Record<string, unknown>
    }
  }
  return null
}

const int = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const positive = (v: unknown): number | null => {
  const n = int(v)
  return n !== null && n > 0 ? n : null
}

async function fetchSpell(base: string, name: string): Promise<SpellTip | null> {
  const json = await request(`${root(base)}/api/v1/spells?name=${encodeURIComponent(name)}`)
  const row = exactRow(JSON.parse(json), name, 'name')
  if (!row) return null

  const id = int(row.id)
  if (id === null) return null

  const classes: SpellTip['classes'] = []
  CLASS_ORDER.forEach((abbrev, i) => {
    // 0 means "not this class" and 254/255 mean "never" - the table uses the
    // top of the byte as its sentinel rather than a null.
    const level = int(row[`classes${i + 1}`])
    if (level !== null && level > 0 && level < 254) classes.push({ abbrev, level })
  })

  const resistId = int(row.resisttype)

  return {
    kind: 'spell',
    name: String(row.name ?? name),
    id,
    mana: positive(row.mana),
    // The table stores milliseconds; nobody thinks in milliseconds.
    castSeconds: positive(row.cast_time) === null ? null : (int(row.cast_time) as number) / 1000,
    recastSeconds: positive(row.recast_time) === null ? null : (int(row.recast_time) as number) / 1000,
    durationTicks: positive(row.buffduration),
    range: positive(row.range),
    resist: resistId === null ? null : (RESIST_NAMES[resistId] ?? null),
    effects: await fetchSpellEffects(base, id),
    classes
  }
}

/**
 * The effect lines, from the site's own tooltip fragment.
 *
 * A failure here is not a failure of the lookup: a spell card with its mana,
 * range and resist but no effect list is still worth showing, so this swallows
 * its errors and returns nothing rather than sinking the whole card.
 */
async function fetchSpellEffects(base: string, id: number): Promise<string[]> {
  try {
    const html = await request(`${root(base)}/spell-tooltip/${id}`)
    const out: string[] = []
    for (const tr of parse(html).querySelectorAll('tr')) {
      const tds = tr.querySelectorAll('td')
      // Rows read `<td>slot2</td><td>Decrease Hitpoints by 2 ...</td>`; the
      // slot number is an implementation detail of the spell format, so only
      // the description survives.
      if (tds.length < 2) continue
      const text = clean(tds[tds.length - 1].text)
      if (text) out.push(text)
    }
    return out
  } catch {
    return []
  }
}

async function fetchItem(base: string, name: string): Promise<ItemTip | null> {
  const json = await request(`${root(base)}/api/v1/items?name=${encodeURIComponent(name)}`)
  const row = exactRow(JSON.parse(json), name, 'Name')
  if (!row) return null

  const id = int(row.id)
  if (id === null) return null

  const tip: ItemTip = { kind: 'item', name: String(row.Name ?? name), id, notes: [], stats: [], extras: [] }

  // The item card is read rather than rebuilt from the raw columns, because the
  // raw columns are bitmasks - `slots = 26624`, `classes = 65535` - and getting
  // one of those bit orders wrong produces an item card that is confidently
  // wrong about who can wear it. The site holds the correct decoding.
  try {
    return parseItemCard(await request(`${root(base)}/tooltip/${id}`), tip)
  } catch {
    // Same reasoning as the spell effects: a name and an id still make a card
    // worth showing, so a failure here costs the stats, not the tooltip.
    return tip
  }
}

/**
 * Read PTDex's rendered item card into rows.
 *
 * Exported so the tests can feed it saved markup instead of the network - and
 * so the network path and the tested path are the same code rather than two
 * walks that agree today.
 *
 * The card's shape carries the meaning: rows with no cells at all are the
 * site's free-text lines ("Class: ALL", "Secondary Primary Range"), single
 * cells marked `nowrap` are augment slots, and anything whose first cell ends
 * in a colon is a stat.
 */
export function parseItemCard(html: string, into: ItemTip): ItemTip {
  for (const tr of parse(html).querySelectorAll('tr')) {
    const tds = tr.querySelectorAll('td')

    if (tds.length === 0) {
      const text = clean(tr.text)
      if (text && text !== into.name) into.notes.push(text)
      continue
    }

    if (tds.length === 1) {
      const text = clean(tds[0].text)
      if (text && tds[0].getAttribute('nowrap')) into.extras.push(text)
      continue
    }

    const label = clean(tds[0].text)
    const value = clean(tds[tds.length - 1].text)
    if (label.endsWith(':') && value) into.stats.push({ label: label.slice(0, -1), value })
  }
  return into
}
