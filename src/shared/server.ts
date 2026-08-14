/**
 * What the server is doing, as opposed to what you are doing.
 *
 * Three things arrive on the same broadcast channel and belong on one page:
 * the world buffs that are currently running, who is levelling and arriving,
 * and what people are trying to sell.
 *
 * All three share one honest limitation, stated once here rather than three
 * times below: YOU ONLY SEE WHAT WAS BROADCAST WHILE YOU WERE LOGGED IN. Every
 * count on this page is a sample of the server taken during your play session,
 * never a total, and nothing here should ever be presented as a census of the
 * whole population.
 */

/* ---------------------------------------------------------------------------
   Server-wide blessings
--------------------------------------------------------------------------- */

export interface Blessing {
  name: string
  /** When the line was written. */
  seenAt: number
  /** Remaining duration it stated, in ms. */
  statedMs: number
  /** `seenAt + statedMs` - the wall-clock moment it runs out. */
  endsAt: number
}

export interface BlessingRow extends Blessing {
  remainingMs: number
  active: boolean
  /**
   * True when the app has been running long enough to be confident this is the
   * whole picture. See `blessingsAreComplete`.
   */
  stale: boolean
}

/**
 * How long a blessing can run.
 *
 * The NPC that sells them says "will last four hours", but they stack as
 * people extend them and a remainder of 27h13m has been observed - so the
 * first guess of 26 hours was already wrong on real data. Forty-eight is
 * generous on purpose: this figure only decides when a remembered blessing has
 * CERTAINLY expired, and being slow to call one dead is a much smaller error
 * than declaring a live one finished.
 */
export const MAX_BLESSING_MS = 48 * 60 * 60 * 1000

export function blessingRows(blessings: readonly Blessing[], now: number): BlessingRow[] {
  return blessings
    .map((b) => ({
      ...b,
      remainingMs: Math.max(0, b.endsAt - now),
      active: b.endsAt > now,
      // A line older than the longest possible blessing tells you nothing about
      // now - the window it described has certainly closed and been replaced.
      stale: now - b.seenAt > MAX_BLESSING_MS
    }))
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1
      return b.remainingMs - a.remainingMs
    })
}

/**
 * Fold a sighting into what is already known.
 *
 * "activated/extended" is one message for two events, so a LATER line replaces
 * an earlier one for the same blessing - an extension is simply a fresh
 * statement of the remaining time.
 *
 * The order that matters is the line's, not the order we happened to read it
 * in. Those are different things here, and assuming otherwise was a real bug:
 * on attach every log is scanned for standing facts, and a character who was
 * offline this morning still holds Tuesday's broadcast near the end of their
 * file. Whichever log was scanned last used to win, so one camped alt could
 * overwrite this morning's blessings with a two-day-old copy and the page sat
 * showing four expired rows while the buffs were plainly running in game.
 *
 * Hence the guard: an older sighting never displaces a newer one.
 */
export function foldBlessing(into: Blessing[], name: string, seenAt: number, statedMs: number): Blessing[] {
  const existing = into.find((b) => b.name === name)
  if (existing && existing.seenAt >= seenAt) return into

  const next = into.filter((b) => b.name !== name)
  next.push({ name, seenAt, statedMs, endsAt: seenAt + statedMs })
  return next.sort((a, b) => a.name.localeCompare(b.name))
}

/* ---------------------------------------------------------------------------
   Who is on the server
--------------------------------------------------------------------------- */

export interface CensusEntry {
  name: string
  /** Classes as broadcast. One class for a first login, three for the rest. */
  classes: string
  /** Highest level seen broadcast for them. Null if only ever seen logging in. */
  level: number | null
  /** They were the first on the server to run this trio. */
  serverFirst: boolean
  firstSeen: number
  lastSeen: number
}

export interface CensusData {
  players: CensusEntry[]
  /** Trio combinations seen, most common first. */
  trios: Array<{ trio: string; count: number; firstBy: string | null }>
}

/** Three classes, or one. Normalised so `Bard/Druid` and `Druid/Bard` differ. */
export const isTrio = (classes: string): boolean => classes.includes('/')

export function foldCensus(
  into: Record<string, CensusEntry>,
  name: string,
  classes: string,
  at: number,
  opts: { level?: number; serverFirst?: boolean } = {}
): void {
  const existing = into[name]
  if (!existing) {
    into[name] = {
      name,
      classes,
      level: opts.level ?? null,
      serverFirst: opts.serverFirst === true,
      firstSeen: at,
      lastSeen: at
    }
    return
  }

  // A trio always beats a single class: the first-login broadcast names only
  // one of the three, so anything with slashes in it is strictly better
  // information about the same player.
  if (isTrio(classes) && !isTrio(existing.classes)) existing.classes = classes
  if (opts.level !== undefined) existing.level = Math.max(existing.level ?? 0, opts.level)
  if (opts.serverFirst) existing.serverFirst = true
  existing.lastSeen = Math.max(existing.lastSeen, at)
}

export function censusRows(players: Record<string, CensusEntry> | undefined): CensusData {
  const list = Object.values(players ?? {}).sort((a, b) => b.lastSeen - a.lastSeen)

  const counts = new Map<string, { count: number; firstBy: string | null }>()
  for (const p of list) {
    if (!isTrio(p.classes)) continue
    const at = counts.get(p.classes) ?? { count: 0, firstBy: null }
    at.count += 1
    if (p.serverFirst) at.firstBy = p.name
    counts.set(p.classes, at)
  }

  return {
    players: list,
    trios: [...counts.entries()]
      .map(([trio, v]) => ({ trio, ...v }))
      .sort((a, b) => b.count - a.count || a.trio.localeCompare(b.trio))
  }
}

/* ---------------------------------------------------------------------------
   The market, such as it is
--------------------------------------------------------------------------- */

export interface Offer {
  /** Who said it. */
  seller: string
  /** `auction` or `ooc` - the only two channels that carry trade. */
  channel: string
  /** The line verbatim, because the parse below is best-effort. */
  text: string
  at: number
  /** WTS / WTB / WTT, when the line says. */
  intent: 'sell' | 'buy' | 'trade' | null
  /** Item names lifted out of the text. Often empty; see the note below. */
  items: string[]
}

/**
 * What somebody is trying to do, from the shorthand everyone uses.
 *
 * Deliberately conservative: a line with no marker gets `null` rather than an
 * assumption, because "Shop Smart, Shop Baalmart!" is an advert and guessing
 * `sell` for it would put a catchphrase in a price list.
 */
export function intentOf(text: string): Offer['intent'] {
  const t = text.toLowerCase()
  if (/\bwt[s]\b|\bselling\b|\bfor sale\b/.test(t)) return 'sell'
  if (/\bwt[b]\b|\bbuying\b|\blooking to buy\b|\blf\b/.test(t)) return 'buy'
  if (/\bwt[t]\b|\btrading\b/.test(t)) return 'trade'
  return null
}

/**
 * Item names out of free prose.
 *
 * Only the tiered form is taken - `Hammer of Holy Vengeance (Legendary)` -
 * because it is the one shape that is unambiguous. Everything else people
 * type is prose with item names embedded in it, sometimes without even a
 * space in front, and a looser rule produced more rubbish than items.
 *
 * So this finds SOME of what is on offer, never all of it, and the raw line is
 * always kept so you can read what it actually said.
 */
export function itemsIn(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/([A-Z][\w'`,-]*(?: [\w'`,-]+){0,5}) \((Legendary|Enchanted|Glamour)\)/g)) {
    // The trade markers are capitalised too, so they get swallowed by a rule
    // looking for a capitalised run - `WTS Hammer of Holy Vengeance` came back
    // as the item's name. Stripped here rather than excluded in the pattern,
    // which would have to know where in the run they can appear.
    const name = m[1].replace(/^(?:WT[SBTA]|LF|PST|ISO|SELLING|BUYING|TRADING)\s+/i, '').trim()
    if (name) out.push(`${name} (${m[2]})`)
  }
  return [...new Set(out)]
}

export interface ServerData {
  blessings: Blessing[]
  census: Record<string, CensusEntry>
  offers: Offer[]
  /** Traders and items in the bazaar, when the server last said. */
  bazaar: { traders: number; items: number; at: number } | null
  /**
   * When world buffs were last applied to YOU - the "You feel a surge of
   * power" line. Separate from the blessing table on purpose: it is the one
   * fact you can be certain of, since the game said it about you directly,
   * while the table is assembled from broadcasts that may predate the app.
   */
  appliedAt: number | null
}
