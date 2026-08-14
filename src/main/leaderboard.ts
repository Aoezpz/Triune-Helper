import { parse } from 'node-html-parser'
import type { Board, BossBoards, LeaderboardData, LeaderboardResult } from '@shared/leaderboard'
import { clean, request } from './http'

/**
 * Reads the raid boards off PTDex.
 *
 * There is no JSON endpoint for these - the site renders them server-side (see
 * routes/leaderboard.py) - so this scrapes its own project's markup. That is
 * fragile by nature, and it is handled by being loud rather than clever: if
 * the selectors stop matching, the page says so and offers the website,
 * instead of quietly showing empty boards that look like nobody has killed
 * anything.
 *
 * Fetched through Electron's `net` rather than global fetch so it uses the
 * app's proxy and certificate handling, and never from the renderer, which
 * stays locked to a self-only CSP.
 */

const CACHE_MS = 5 * 60 * 1000

let cache: LeaderboardData | null = null
let inflight: Promise<LeaderboardResult> | null = null

// Was a second, private copy of the same request helper - and the copy had no
// timeout, so a wedged site left the Leaderboards page loading forever. One
// definition, in http.ts, which is also where the timeout and the size cap
// live.

function parseBoards(html: string, base: string): LeaderboardData {
  const root = parse(html)

  const totals = root.querySelectorAll('.tot').map((t) => ({
    value: clean(t.querySelector('.n')?.text),
    label: clean(t.querySelector('.k')?.text)
  }))

  const bosses: BossBoards[] = []

  for (const sec of root.querySelectorAll('section.boss')) {
    const link = sec.querySelector('.bhead h2 a')
    const name = clean(link?.text)
    if (!name) continue

    const href = link?.getAttribute('href') ?? ''
    const key = /\/leaderboard\/boss\/([^/?#]+)/.exec(href)?.[1] ?? name.toLowerCase()

    const boards: Board[] = []
    for (const col of sec.querySelectorAll('.col')) {
      const h3 = col.querySelector('h3')
      if (!h3) continue
      const note = clean(h3.querySelector('em')?.text).replace(/^[—–-]\s*/, '') || null
      const title = clean(
        h3.childNodes.map((n) => (n.rawTagName === 'em' ? '' : n.text)).join('')
      )

      const rows = col.querySelectorAll('a.row').map((r) => {
        const valEl = r.querySelector('.val')
        // The site encodes which board a row belongs to as a second class on
        // .val (first / speed / dps), which is more reliable than the heading.
        const kind =
          (valEl?.getAttribute('class') ?? '')
            .split(/\s+/)
            .find((c) => c && c !== 'val') ?? title.toLowerCase()

        // The site puts the unit in a nested element ("100,058" + "dps"), so
        // taking .text wholesale glues them together. Split them out.
        const unitEl = valEl?.querySelector('em, small, span')
        const unit = clean(unitEl?.text) || null
        const value = unit
          ? clean(valEl?.childNodes.map((n) => (n === unitEl ? '' : n.text)).join(''))
          : clean(valEl?.text)

        return {
          bracket: clean(r.querySelector('.bk')?.text),
          names: clean(r.querySelector('.nm')?.text),
          when: clean(r.querySelector('.when')?.text),
          value,
          unit,
          kind,
          encounterId:
            Number(/\/leaderboard\/encounter\/(\d+)/.exec(r.getAttribute('href') ?? '')?.[1] ?? 0) || null
        }
      })

      if (rows.length > 0) boards.push({ title, note, rows })
    }

    bosses.push({
      key,
      name,
      icon: clean(sec.querySelector('.bicon')?.text) || null,
      accent: /--acc:\s*(#[0-9a-f]{3,8})/i.exec(sec.getAttribute('style') ?? '')?.[1] ?? null,
      meta: clean(sec.querySelector('.bmeta')?.text) || null,
      boards,
      url: href ? new URL(href, base).toString() : base
    })
  }

  if (bosses.length === 0) {
    throw new Error('no boss boards found — the leaderboard page markup has changed')
  }

  return { totals, bosses, fetchedAt: Date.now(), source: `${base}/leaderboard/` }
}

export async function getLeaderboard(base: string, force = false): Promise<LeaderboardResult> {
  if (!base) {
    return { data: null, error: 'No PTDex address configured — set one in Preferences.', stale: false }
  }
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_MS) {
    return { data: cache, error: null, stale: false }
  }
  if (inflight) return inflight

  const url = `${base.replace(/\/$/, '')}/leaderboard/`
  inflight = request(url)
    .then((html) => {
      cache = parseBoards(html, base.replace(/\/$/, ''))
      return { data: cache, error: null, stale: false }
    })
    .catch((err: Error) => ({
      // A cached copy is better than nothing when the site is briefly down, but
      // it is labelled stale so nobody reads an hour-old record as current.
      data: cache,
      error: `Couldn't read the boards: ${err.message}`,
      stale: cache !== null
    }))
    .finally(() => {
      inflight = null
    })

  return inflight
}
