import { HTMLElement, parse } from 'node-html-parser'
import { allSteps, type ProgressionData } from '@shared/progression'
import { clean, request } from './http'

/**
 * Reads a character's page on PTDex.
 *
 * This exists because the log cannot answer two questions:
 *
 *   * **What level am I?** A log states a level only when you ding. A
 *     character who has not levelled since the app was installed reads "level
 *     unknown" forever, and `/who` output does not reach the log on this
 *     server - 1867 lines of a real session contained none.
 *   * **What am I flagged for?** Flags earned before the app existed are not
 *     in any log it will ever see.
 *
 * The site knows both, because the game server tells it. So the app asks.
 */

export interface PtdexCharacter {
  id: number
  name: string
  level: number | null
  race: string | null
  /** `['War', 'Rng', 'Brd']`. Empty when the row didn't carry them. */
  classes: string[]
  guild: string | null
  score: number | null
  trioRank: number | null
  trioOf: number | null
  overallRank: number | null
}

const num = (s: string | undefined): number | null => {
  const m = /-?\d[\d,]*/.exec(s ?? '')
  if (!m) return null
  const n = Number(m[0].replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Find a character by exact name.
 *
 * The browser is a POST form doing a LIKE search, so it can return several
 * rows - "Hex" would match "Hexzo" and "Hexen". Only an exact,
 * case-insensitive name match is accepted; syncing the wrong character's flags
 * would be worse than syncing none.
 *
 * The row is read by COLUMN HEADING rather than by position. That is not
 * fussiness: an earlier version pulled the level with the first one-to-three
 * digit number in the row's text, which on a ranked row is the "#1" of the trio
 * rank, so every character came back level 1. Reading `Level` from the header
 * map means a new column can be added to the site without silently shifting
 * every field one to the right.
 */
export async function findCharacter(base: string, name: string): Promise<PtdexCharacter | null> {
  const html = await request(`${base.replace(/\/$/, '')}/characters`, { name })
  const root = parse(html)

  const table = root.querySelector('table#charResults') ?? root.querySelector('table')
  if (!table) return null

  const heads = table.querySelectorAll('th').map((th) => clean(th.text).toLowerCase())
  const col = (label: string): number => heads.indexOf(label)

  for (const row of table.querySelectorAll('tbody tr')) {
    const link = row.querySelector('a[href*="/character/"]')
    if (!link) continue
    if (clean(link.text).toLowerCase() !== name.toLowerCase()) continue

    const id = Number(/\/character\/(\d+)/.exec(link.getAttribute('href') ?? '')?.[1] ?? 0)
    if (!id) continue

    const tds = row.querySelectorAll('td')
    const cell = (label: string): string | undefined => {
      const i = col(label)
      return i >= 0 ? clean(tds[i]?.text) : undefined
    }

    const trio = cell('trio rank') ?? ''

    return {
      id,
      name: clean(link.text),
      level: num(cell('level')),
      race: null, // the row doesn't carry it; the progression page does
      classes: (cell('class') ?? '')
        .split('/')
        .map((c) => c.trim())
        .filter(Boolean),
      guild: clean(row.querySelector('td.guild')?.text) || null,
      score: num(cell('player score')),
      // "#1 of 18" - rank among everyone running this exact class combination.
      trioRank: num(/#(\d+)/.exec(trio)?.[1]),
      trioOf: num(/of\s+(\d+)/.exec(trio)?.[1]),
      overallRank: num(/#(\d+)/.exec(cell('overall rank') ?? '')?.[1])
    }
  }
  return null
}

export interface PtdexProgress {
  character: PtdexCharacter
  /** Step keys, in the app's own key format, that the site shows as earned. */
  earned: string[]
  /** Steps the site shows as earned that the bundled data has no entry for. */
  unknownSteps: string[]
}

/**
 * Read one character's progression page and translate it into step keys.
 *
 * Matching is by chapter title + step name, which is exactly how the bundled
 * data was generated, so the two stay in step as long as both come from the
 * same page. Anything that does not match is reported rather than dropped -
 * a silent mismatch would look like "you are less flagged than you are".
 */
export async function fetchProgress(
  base: string,
  character: PtdexCharacter,
  data: ProgressionData
): Promise<PtdexProgress> {
  const html = await request(`${base.replace(/\/$/, '')}/character/${character.id}/progression`)
  const root = parse(html)

  // `.meta` on the progression page reads
  //   Level 65 Human<span class=cchip>War</span><span class=cchip>Rng</span>…
  // which is the app's only reliable level source: a log states a level only
  // when you ding, and /who output never reaches the log on this server.
  //
  // The classes are read from the chip ELEMENTS rather than from the flattened
  // text. Flattened, the same markup reads "Level 65 HumanWarRngBrd", and
  // splitting that back apart means guessing where the race ends - which works
  // for Human and falls over on Half Elf and Wood Elf.
  const metaEl = root.querySelector('.meta')
  const meta = clean(metaEl?.text)
  const level = Number(/Level\s*(\d+)/i.exec(meta)?.[1] ?? 0)
  const classes = (metaEl?.querySelectorAll('.cchip') ?? []).map((c) => clean(c.text)).filter(Boolean)

  // The race is whatever text precedes the first class chip. Taking every
  // non-span node instead would also collect the "shared account-wide" note
  // that trails them, and hand back "Human shared account-wide".
  const before: string[] = []
  for (const node of metaEl?.childNodes ?? []) {
    if (node instanceof HTMLElement && node.classList.contains('cchip')) break
    before.push(node.text)
  }
  const race = clean(before.join('')).replace(/^Level\s*\d+\s*/i, '') || null

  // Build a lookup from (chapter title, step name) to our key.
  const byName = new Map<string, string>()
  for (const { chapter, step, key } of allSteps(data)) {
    byName.set(`${chapter.title}|${step.name}`.toLowerCase(), key)
    // Names are unique enough in practice; the fallback covers a chapter
    // being retitled on the site without the bundled data being regenerated.
    if (!byName.has(step.name.toLowerCase())) byName.set(step.name.toLowerCase(), key)
  }

  const earned: string[] = []
  const unknownSteps: string[] = []

  for (const ch of root.querySelectorAll('details.ch')) {
    const title = clean(
      ch.querySelector('.tt')?.childNodes.map((n) => (n.rawTagName === 'span' ? '' : n.text)).join('')
    )
    for (const st of ch.querySelectorAll('.st')) {
      // `.st on` is how the site marks a completed step.
      if (!st.classList.contains('on')) continue
      const nm = st.querySelector('.nm')
      if (!nm) continue
      const stepName = clean(
        nm.childNodes.map((n) => (n.rawTagName === 'span' ? '' : n.text)).join('')
      )
      if (!stepName) continue

      const key =
        byName.get(`${title}|${stepName}`.toLowerCase()) ?? byName.get(stepName.toLowerCase())
      if (key) earned.push(key)
      else unknownSteps.push(`${title} / ${stepName}`)
    }
  }

  return {
    character: {
      ...character,
      level: level || character.level,
      race: race ?? character.race,
      classes: classes.length > 0 ? classes : character.classes
    },
    earned,
    unknownSteps
  }
}
