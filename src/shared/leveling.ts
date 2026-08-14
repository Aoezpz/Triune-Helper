/**
 * Progression data and the honest derivatives you can compute from it.
 *
 * The constraint that shapes most of this file: EverQuest logs never state how
 * much regular experience you gained, only that you gained some. Levels, kills
 * and rates are all derived from counts and timestamps, and nothing here
 * pretends to know a percentage.
 *
 * AA is the exception, and it took a real log to notice. Project Triune writes
 * "You gain bonus AA experience! (5087/18850)" - a counted numerator and
 * denominator - so the AA side of this page is measured rather than inferred.
 */

export interface LevelMark {
  character: string
  at: number
  /** The new level, or the running ability-point total. */
  value: number
  /**
   * How we learned it. A who mark reports the level you already had; only
   * a ding is a level actually gained, and only dings are counted as such.
   */
  via?: 'ding' | 'who'
}

export interface XpTick {
  character: string
  at: number
}

/**
 * One reading of the AA counter the game prints: earned out of available.
 *
 * Kept as a series rather than a single latest value so the page can show a
 * rate that is counted from two real readings rather than estimated from how
 * often a message appeared.
 */
export interface AaMark {
  character: string
  at: number
  earned: number
  available: number
}

export interface LevelingData {
  levels: LevelMark[]
  /** Ability points UNSPENT, as "You now have N ability points" reports them. */
  aa: LevelMark[]
  /** AA earned out of available, from the counter in the log. */
  aaxp: AaMark[]
  ticks: XpTick[]
}

export interface CharacterProgress {
  character: string
  level: number | null
  /** Unspent ability points. */
  aa: number | null
  /** AA earned and available, from the log's own counter. */
  aaEarned: number | null
  aaAvailable: number | null
  /**
   * AA earned per hour, measured from the first and last readings in the
   * window - a real difference over a real elapsed time, not a message count.
   * Null until there are two readings far enough apart to divide.
   */
  aaEarnedPerHour: number | null
  /** Seconds to finish the remaining AA at that rate. Null when not moving. */
  etaAllAaSeconds: number | null
  /** Levels gained in the window, and how long each took. */
  levelsGained: number
  aaGained: number
  /** Experience messages per hour over the window. */
  killsPerHour: number
  aaPerHour: number
  /** Seconds between the last two dings, when there have been two. */
  lastLevelSeconds: number | null
  /** Projected seconds to the next ability point at the current rate. */
  etaNextAaSeconds: number | null
  /** Session window actually observed, in seconds. */
  observedSeconds: number
  levels: LevelMark[]
  aa_: LevelMark[]
  ticks: XpTick[]
}

/**
 * A "session" is a run of activity with no gap longer than `gapMinutes`.
 * Rates computed over wall-clock since the first log line would be meaningless
 * for someone who left the app open overnight.
 */
export function sessionWindow(ticks: XpTick[], gapMinutes = 30): { from: number; to: number } | null {
  if (ticks.length === 0) return null
  const sorted = [...ticks].sort((a, b) => a.at - b.at)
  const gap = gapMinutes * 60_000

  let from = sorted[sorted.length - 1].at
  for (let i = sorted.length - 1; i > 0; i--) {
    if (sorted[i].at - sorted[i - 1].at > gap) break
    from = sorted[i - 1].at
  }
  return { from, to: sorted[sorted.length - 1].at }
}

export function summarizeCharacter(
  character: string,
  data: LevelingData,
  window?: { from: number; to: number } | null
): CharacterProgress {
  const inWindow = <T extends { at: number; character: string }>(rows: T[]): T[] =>
    rows
      .filter((r) => r.character === character)
      .filter((r) => !window || (r.at >= window.from && r.at <= window.to))
      .sort((a, b) => a.at - b.at)

  const levels = inWindow(data.levels)
  const aa = inWindow(data.aa)
  const ticks = inWindow(data.ticks)
  const aaxp = inWindow(data.aaxp ?? [])

  const allLevels = data.levels.filter((l) => l.character === character)
  const allAa = data.aa.filter((l) => l.character === character)
  const allAaXp = (data.aaxp ?? []).filter((l) => l.character === character)

  const observedSeconds = window ? Math.max(1, (window.to - window.from) / 1000) : 1
  const hours = observedSeconds / 3600

  const dings = levels.filter((l) => l.via !== 'who')
  const lastLevelSeconds =
    dings.length >= 2 ? (dings[dings.length - 1].at - dings[dings.length - 2].at) / 1000 : null

  const aaPerHour = hours > 0 ? aa.length / hours : 0

  /**
   * The AA rate, measured rather than counted.
   *
   * Two readings and the time between them is a real rate. Deliberately NOT
   * `aaxp.length / hours` - the counter is printed on every kill and only moves
   * on some of them, so counting messages would report a rate several times the
   * truth. The span guard keeps a pair of readings a few seconds apart from
   * projecting a fantasy.
   */
  const latest = allAaXp.at(-1) ?? null
  const first = aaxp[0]
  const last = aaxp.at(-1)
  const spanHours = first && last ? (last.at - first.at) / 3_600_000 : 0
  const gained = first && last ? last.earned - first.earned : 0
  const aaEarnedPerHour = spanHours >= 1 / 60 && gained > 0 ? gained / spanHours : null

  const remaining = latest ? latest.available - latest.earned : 0

  return {
    character,
    level: allLevels.at(-1)?.value ?? null,
    aa: allAa.at(-1)?.value ?? null,
    aaEarned: latest?.earned ?? null,
    aaAvailable: latest?.available ?? null,
    aaEarnedPerHour,
    etaAllAaSeconds:
      aaEarnedPerHour !== null && remaining > 0 ? (remaining / aaEarnedPerHour) * 3600 : null,
    levelsGained: levels.filter((l) => l.via !== 'who').length,
    aaGained: aa.length,
    killsPerHour: hours > 0 ? ticks.length / hours : 0,
    aaPerHour,
    lastLevelSeconds,
    // Only projected once there is a rate to project from; one data point is
    // not a rate, and a made-up ETA is worse than none.
    etaNextAaSeconds: aa.length >= 2 && aaPerHour > 0 ? 3600 / aaPerHour : null,
    observedSeconds,
    levels,
    aa_: aa,
    ticks
  }
}

/** Bucket experience messages into per-interval counts, for the rate chart. */
export function ratePoints(
  ticks: XpTick[],
  window: { from: number; to: number },
  buckets = 40
): Array<{ t: number; count: number }> {
  if (window.to <= window.from) return []
  const size = (window.to - window.from) / buckets
  const out = Array.from({ length: buckets }, (_, i) => ({ t: window.from + i * size, count: 0 }))
  for (const tick of ticks) {
    const i = Math.min(buckets - 1, Math.max(0, Math.floor((tick.at - window.from) / size)))
    out[i].count += 1
  }
  return out
}
