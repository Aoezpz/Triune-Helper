import type { AlertSound } from './alerts'
import type { MobTotals } from './mobs'

/**
 * Timers.
 *
 * Worth saying up front what this page is NOT, because the obvious version of
 * it can't be built from a log file. EverQuest writes no buff durations, no
 * recast timers and no spawn tables. I checked this server's log rather than
 * assuming: the only recurring "timer-shaped" lines are corpse-decay notices
 * (which are anonymous - they fire when you try to loot something out of
 * range, and never name the corpse) and buff fades, which on Project Triune
 * are dominated by a proc that faded 4,940 times in one day. Neither supports
 * a countdown worth drawing.
 *
 * What the log DOES support is the thing people actually use timers for:
 * knowing when a named is worth checking again. That is derivable, because the
 * app already records every kill. Two kills of the same mob bracket a respawn.
 *
 * The honest reading of that bracket matters. An observed gap is
 *
 *     respawn + however long it took you to find and kill it again
 *
 * so every gap you see is an OVER-estimate of the real timer, and the shortest
 * gap you have ever seen is the tightest upper bound you own. That is the
 * number this page counts down to, and it is labelled as what it is: the
 * soonest you have ever had it back, not a spawn table.
 *
 * Everything else here is a manual countdown, which needs no log at all.
 */

/* ---------------------------------------------------------------------------
   Spawn windows, observed
--------------------------------------------------------------------------- */

/**
 * Gaps longer than this are you logging off, not a mob taking its time. Six
 * hours is well past any respawn in this era and well short of a night's sleep,
 * so it separates the two cleanly without needing to know either.
 */
export const MAX_PLAUSIBLE_GAP_MS = 6 * 60 * 60 * 1000

/**
 * Below this, a repeat kill says "there were two of them" or "it was a trash
 * pull", not "it respawned". Nothing in this era comes back inside eight
 * minutes, so a shorter gap is evidence the mob is not on a timer at all -
 * which is exactly how the suggestion list tells named apart from trash
 * without a spawn table.
 */
export const MIN_SPAWN_MS = 8 * 60 * 1000

export interface SpawnRow {
  mob: string
  /** Pinned by the user. Pinned rows are shown whether or not they qualify. */
  tracked: boolean
  kills: number
  lastKillAt: number
  zone: string | null
  /** Consecutive-kill gaps that were short enough to be a respawn. */
  samples: number
  /** The tightest upper bound on the real timer. Null with no usable gap. */
  shortestMs: number | null
  /** What it typically takes you to see it again - travel time included. */
  medianMs: number | null
  longestMs: number | null
  /** `lastKillAt + shortestMs`. Null when there is no estimate yet. */
  dueAt: number | null
}

/** Consecutive-kill gaps, minus the ones that are obviously downtime. */
export function usableGaps(killTimes: readonly number[]): number[] {
  const sorted = [...killTimes].sort((a, b) => a - b)
  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1]
    if (gap > 0 && gap <= MAX_PLAUSIBLE_GAP_MS) gaps.push(gap)
  }
  return gaps
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function rowFor(t: MobTotals, tracked: boolean): SpawnRow {
  const times = t.killTimes ?? []
  const gaps = usableGaps(times)
  const shortest = gaps.length > 0 ? Math.min(...gaps) : null
  const last = times.length > 0 ? Math.max(...times) : t.lastSeen

  return {
    mob: t.mob,
    tracked,
    kills: t.kills,
    lastKillAt: last,
    zone: t.zones[0] ?? null,
    samples: gaps.length,
    shortestMs: shortest,
    medianMs: median(gaps),
    longestMs: gaps.length > 0 ? Math.max(...gaps) : null,
    dueAt: shortest === null ? null : last + shortest
  }
}

/**
 * Everything worth a countdown: what you pinned, plus what looks like it is on
 * a timer.
 *
 * A mob qualifies as a suggestion when the shortest gap you have ever seen is
 * long enough to be a respawn rather than a second copy of the same trash. A
 * pinned mob is always listed, estimate or not, because the user pinning it is
 * better evidence than any heuristic.
 */
export function spawnRows(
  totals: Record<string, MobTotals> | undefined,
  tracked: readonly string[]
): SpawnRow[] {
  const pinned = new Set(tracked)
  const rows: SpawnRow[] = []

  for (const t of Object.values(totals ?? {})) {
    const isPinned = pinned.has(t.mob)
    if (!isPinned) {
      if (t.kills < 2) continue
      const gaps = usableGaps(t.killTimes ?? [])
      if (gaps.length === 0 || Math.min(...gaps) < MIN_SPAWN_MS) continue
    }
    rows.push(rowFor(t, isPinned))
  }

  // Pinned first and soonest-due at the top of each block, so the row you are
  // waiting on is the row your eye lands on. A row with no estimate sorts last
  // within its block rather than first, which is what `Infinity` buys.
  return rows.sort((a, b) => {
    if (a.tracked !== b.tracked) return a.tracked ? -1 : 1
    return (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity)
  })
}

/* ---------------------------------------------------------------------------
   Manual countdowns
--------------------------------------------------------------------------- */

export interface ManualTimer {
  id: string
  label: string
  /** Length of one run. */
  seconds: number
  /**
   * When this run ends. Null means stopped - the timer exists and is ready,
   * but nothing is counting. Storing the deadline rather than a remaining
   * count is what lets it survive a restart and stay accurate while the app
   * was closed.
   */
  endsAt: number | null
  /** Start the next run the instant this one ends. */
  repeat: boolean
  /** `none` is silent, and also suppresses the spoken label. */
  sound: AlertSound
}

export interface TimersData {
  manual: ManualTimer[]
  spawns: SpawnRow[]
  tracked: string[]
}

/** Presets that cover what people actually set a timer for on an EMU server. */
export const TIMER_PRESETS: Array<{ label: string; seconds: number }> = [
  { label: '1m', seconds: 60 },
  { label: '5m', seconds: 300 },
  { label: '10m', seconds: 600 },
  { label: '22m', seconds: 22 * 60 },
  { label: '30m', seconds: 1800 },
  { label: '1h', seconds: 3600 }
]

export function isRunning(t: ManualTimer, now: number): boolean {
  return t.endsAt !== null && t.endsAt > now
}

/** Milliseconds left, floored at zero. Null when the timer is stopped. */
export function remainingMs(t: ManualTimer, now: number): number | null {
  if (t.endsAt === null) return null
  return Math.max(0, t.endsAt - now)
}

/**
 * `h:mm:ss` past an hour, `m:ss` below it.
 *
 * Rounds UP, so a timer reads 0:01 for the whole of its last second and hits
 * 0:00 exactly when it fires. Rounding to nearest shows 0:00 for half a second
 * before the alert, which reads as a bug.
 */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

/**
 * Read a typed duration.
 *
 * Accepts the forms people actually type when they are half looking at a game:
 * `90` (seconds), `5m`, `1h`, `1h30m`, `2:30` (m:ss) and `1:02:30` (h:mm:ss).
 * Returns null on anything it cannot read, so the caller can refuse rather
 * than silently start a one-second timer.
 */
export function parseDuration(text: string): number | null {
  // Spaces go first, so `1h 30m` and `1h30m` are the same input by the time
  // anything looks at it.
  const raw = text.toLowerCase().replace(/\s+/g, '')
  if (raw === '') return null

  // Colon form first: `2:30` is two and a half minutes, not two hours thirty.
  if (raw.includes(':')) {
    const parts = raw.split(':')
    if (parts.length > 3 || parts.some((p) => p === '' || !/^\d+$/.test(p))) return null
    const nums = parts.map(Number)
    const [h, m, s] = nums.length === 3 ? nums : [0, nums[0], nums[1]]
    return h * 3600 + m * 60 + s
  }

  if (/^\d+$/.test(raw)) return Number(raw)

  // Unit form. Every character has to be consumed, so `5mx` is a refusal
  // rather than five minutes with the tail quietly ignored.
  const units: Record<string, number> = { h: 3600, m: 60, s: 1 }
  let total = 0
  let matched = 0
  for (const [whole, n, u] of raw.matchAll(/(\d+)([hms])/g)) {
    total += Number(n) * units[u]
    matched += whole.length
  }
  if (matched !== raw.length || total === 0) return null
  return total
}

/** "3h 20m", "12m", "45s" - for durations that are read, not watched. */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`
}
