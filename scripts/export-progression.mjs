/**
 * Extracts the Plane of Time flagging structure from PTDex into
 * `data/progression.json`, which the app bundles.
 *
 * The page it reads is per-character, but only the STATE is - the chapters,
 * bosses and zones are the same for everyone. So this takes the definitions
 * and throws the character's ticks away; the app tracks state itself, from the
 * log, and can optionally seed from PTDex at runtime.
 *
 * Rows are the unit, not the page's printed counters - see the note by the
 * badge check below for why those cannot be trusted.
 *
 *   node scripts/export-progression.mjs
 *   node scripts/export-progression.mjs --base https://nms.bestemu.com --character 180260
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parse } from 'node-html-parser'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1])
}

const BASE = args.get('base') ?? 'https://nms.bestemu.com'
const CHARACTER = args.get('character') ?? '180260'
const OUT = args.get('out') ?? join(process.cwd(), 'data', 'progression.json')
const URL_ = `${BASE}/character/${CHARACTER}/progression`

const clean = (s) => (s ?? '').replace(/\s+/g, ' ').trim()
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** Numeric id out of an href like /npc/detail/32040 */
function idFrom(el, prefix) {
  const a = el?.querySelector(`a[href^="${prefix}"]`)
  const m = a && /(\d+)\s*$/.exec(a.getAttribute('href') ?? '')
  return m ? Number(m[1]) : null
}

const res = await fetch(URL_)
if (!res.ok) {
  console.error(`fetch failed: ${res.status} ${res.statusText}`)
  process.exit(1)
}
const root = parse(await res.text())

const sections = []

// Each `.seg` header is followed by a `.climb` holding that section's chapters.
for (const seg of root.querySelectorAll('.seg')) {
  const name = clean(seg.querySelector('.sn')?.text)
  if (!name) continue

  // The climb is the next sibling element that carries the class.
  let climb = seg.nextElementSibling
  while (climb && !climb.classList.contains('climb')) climb = climb.nextElementSibling
  if (!climb) continue

  const chapters = []

  for (const ch of climb.querySelectorAll('details.ch')) {
    const title = clean(ch.querySelector('.tt')?.childNodes.map((n) => (n.rawTagName === 'span' ? '' : n.text)).join(''))
    if (!title) continue

    const groups = []
    for (const grp of ch.querySelectorAll('.grp')) {
      const plane = clean(grp.querySelector('.gn')?.text) || null
      const planeShort = clean(grp.querySelector('.gz')?.text) || null

      const steps = []
      for (const st of grp.querySelectorAll('.st')) {
        const nm = st.querySelector('.nm')
        if (!nm) continue

        // A badge span ("2 stages") rides inside .nm; keep it, but out of the name.
        const badge = clean(nm.querySelector('span')?.text) || null
        const stepName = clean(
          nm.childNodes.map((n) => (n.rawTagName === 'span' ? '' : n.text)).join('')
        )
        if (!stepName) continue

        // Some rows carry a "2 stages" badge - one line on the page, more than
        // one step in the encounter. Recorded so the UI can show it; not used
        // as a multiplier, because the page is inconsistent about whether its
        // own totals count stages or rows.
        const stages = Number(/(\d+)\s*stages?/i.exec(badge ?? '')?.[1] ?? 1) || 1

        const whereat = st.querySelector('.whereat')
        steps.push({
          name: stepName,
          badge,
          stages,
          npcId: idFrom(nm, '/npc/detail/'),
          zone: clean(whereat?.querySelector('a')?.text) || plane,
          zoneId: idFrom(whereat, '/zone/detail/'),
          zoneShort: clean(whereat?.querySelector('.sh')?.text) || planeShort,
          level: Number(/lvl (\d+)/.exec(whereat?.querySelector('.lv')?.text ?? '')?.[1] ?? 0) || null,
          how: clean(st.querySelector('.ds')?.text) || null
        })
      }

      if (steps.length > 0) groups.push({ plane, planeShort, steps })
    }

    /**
     * The page prints a per-chapter count, but it is not a usable oracle: on
     * the reference character Tier 1 badges 12 against 11 rows (counting a
     * two-stage row twice) while Tier 2 badges 8 against 8 rows (not counting
     * its three multi-stage rows at all), and the section header's 42 matches
     * neither the row sum (40) nor the badge sum (41).
     *
     * So rows are what we extract - they are unambiguous, and a row is what
     * the app can actually observe being completed in a log. The badge is
     * recorded for reference and any disagreement is reported, not fatal.
     */
    const rows = groups.reduce((n, g) => n + g.steps.length, 0)
    const stages = groups.reduce((n, g) => n + g.steps.reduce((m, s) => m + s.stages, 0), 0)
    const badgeCount = Number(/(\d+)\s*$/.exec(clean(ch.querySelector('.cnt span')?.text))?.[1] ?? 0) || null
    if (badgeCount !== null && badgeCount !== rows && badgeCount !== stages) {
      console.warn(`  note "${title}": page badge ${badgeCount}, rows ${rows}, stages ${stages}`)
    }

    chapters.push({
      id: slug(title),
      title,
      era: clean(ch.querySelector('.tt .era')?.text) || null,
      blurb: clean(ch.querySelector('.bl')?.text) || null,
      opens: clean(ch.querySelector('.opens b')?.text).replace(/^[^A-Za-z]+/, '') || null,
      rows,
      stages,
      badgeCount,
      groups
    })
  }

  if (chapters.length > 0) {
    sections.push({ id: slug(name), name, detail: clean(seg.querySelector('.sd')?.text), chapters })
  }
}

const stepsIn = (ch) => ch.rows
const total = sections.reduce((s, sec) => s + sec.chapters.reduce((c, ch) => c + stepsIn(ch), 0), 0)

if (total === 0) {
  console.error('extracted nothing - the page markup has changed; fix the selectors above')
  process.exit(1)
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      source: URL_,
      extractedAt: new Date().toISOString(),
      note: 'Definitions only. Per-character state is tracked by the app, never taken from this file.',
      sections
    },
    null,
    2
  )}\n`
)

console.log(`wrote ${OUT} (${total} steps)`)
for (const sec of sections) {
  console.log(`  ${sec.name}: ${sec.chapters.length} chapters`)
  for (const ch of sec.chapters) console.log(`    ${ch.title} — ${stepsIn(ch)}`)
}
