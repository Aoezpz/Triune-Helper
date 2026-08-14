/**
 * What you fight, and how it goes.
 *
 * The zone page answers "where did the evening go"; this answers "what was in
 * it". Both are folds over things the app already computes - here it is one
 * closed fight at a time, because the interesting numbers are all per-fight:
 * how long a Diaku Guardian takes to kill is not a property of any single
 * swing.
 *
 * Kept forever, per mob, for the same reason zone totals are: "I have killed
 * four hundred of these and they have killed me twice" is a fact about a year,
 * not about tonight.
 */

export interface MobTotals {
  mob: string
  /** Fights in which this mob died. */
  kills: number
  /** Fights it appeared in at all, which is larger when things get away. */
  fights: number
  /** Total seconds of fighting it. */
  seconds: number
  /** The best clear, in seconds. Null until one of them has actually died. */
  fastestSeconds: number | null
  damageDone: number
  damageTaken: number
  /** Times one of your characters died in a fight with it. */
  deaths: number
  /** Zones it has been met in, most recent first, capped. */
  zones: string[]
  /**
   * When it died, oldest first, capped. Kept because the gaps between them are
   * the only respawn evidence a log file contains - see shared/timers.ts.
   * Absent on ledgers written before the Timers page existed.
   */
  killTimes: number[]
  firstSeen: number
  lastSeen: number
}

export interface MobsData {
  totals: Record<string, MobTotals>
}

export interface MobRow extends MobTotals {
  /** Total fight time over kills - what a pull actually costs you. */
  averageSeconds: number | null
  /** Damage done over fight time. */
  dps: number | null
  /** Kills per death, the blunt measure of whether a mob is worth it. */
  ratio: number | null
}

/** Don't average or rate anything under this - one lucky pull is not a trend. */
export const MIN_KILLS_FOR_AVERAGE = 3

/**
 * Kill times kept per mob. Enough to see a pattern in a night's camping, few
 * enough that a mob killed ten thousand times costs a fixed 24 numbers.
 */
export const MAX_KILL_TIMES = 24

export function blankMob(mob: string, at: number): MobTotals {
  return {
    mob,
    kills: 0,
    fights: 0,
    seconds: 0,
    fastestSeconds: null,
    damageDone: 0,
    damageTaken: 0,
    deaths: 0,
    zones: [],
    killTimes: [],
    firstSeen: at,
    lastSeen: at
  }
}

export function mobRows(totals: Record<string, MobTotals> | undefined): MobRow[] {
  return Object.values(totals ?? {})
    .map((t) => ({
      ...t,
      averageSeconds: t.kills >= MIN_KILLS_FOR_AVERAGE ? t.seconds / t.kills : null,
      dps: t.seconds > 0 ? t.damageDone / t.seconds : null,
      // A mob that has never killed you has no ratio rather than an infinite
      // one; the page prints a dash, which is the honest shape of "never".
      ratio: t.deaths > 0 ? t.kills / t.deaths : null
    }))
    .sort((a, b) => b.kills - a.kills)
}
