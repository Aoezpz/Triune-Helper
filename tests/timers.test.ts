import { describe, expect, it } from 'vitest'
import { blankMob, type MobTotals } from '../src/shared/mobs'
import {
  countdown,
  duration,
  MAX_PLAUSIBLE_GAP_MS,
  MIN_SPAWN_MS,
  parseDuration,
  remainingMs,
  spawnRows,
  usableGaps,
  type ManualTimer
} from '../src/shared/timers'

/**
 * The claim this page makes is a statistical one, and the tests are here to
 * keep it modest: a gap between two of your own kills is the respawn PLUS your
 * travel time, so the shortest gap is an upper bound and nothing here may
 * present it as anything else.
 */

const MIN = 60_000
const HOUR = 60 * MIN

function mob(name: string, killTimes: number[], extra: Partial<MobTotals> = {}): MobTotals {
  return {
    ...blankMob(name, killTimes[0] ?? 0),
    kills: killTimes.length,
    fights: killTimes.length,
    killTimes,
    zones: ['Drunder, the Fortress of Zek'],
    ...extra
  }
}

const totalsOf = (...list: MobTotals[]): Record<string, MobTotals> =>
  Object.fromEntries(list.map((m) => [m.mob, m]))

describe('usableGaps', () => {
  it('measures the gaps between consecutive kills', () => {
    expect(usableGaps([0, 10 * MIN, 25 * MIN])).toEqual([10 * MIN, 15 * MIN])
  })

  it('sorts before differencing, so an out-of-order ledger still works', () => {
    expect(usableGaps([25 * MIN, 0, 10 * MIN])).toEqual([10 * MIN, 15 * MIN])
  })

  /**
   * The gap across a night's sleep is not a spawn timer, and letting one in
   * would make every mob you killed once a day look like a 20-hour respawn.
   */
  it('throws away gaps that are really you logging off', () => {
    const gaps = usableGaps([0, 20 * MIN, 20 * MIN + 14 * HOUR])
    expect(gaps).toEqual([20 * MIN])
  })

  it('keeps a gap exactly on the cutoff', () => {
    expect(usableGaps([0, MAX_PLAUSIBLE_GAP_MS])).toEqual([MAX_PLAUSIBLE_GAP_MS])
  })

  it('has nothing to say about a single kill', () => {
    expect(usableGaps([1000])).toEqual([])
  })
})

describe('spawnRows', () => {
  it('suggests a mob whose repeat kills are far enough apart to be a respawn', () => {
    const rows = spawnRows(totalsOf(mob('Ragefire', [0, 30 * MIN, 95 * MIN])), [])
    expect(rows).toHaveLength(1)
    expect(rows[0].shortestMs).toBe(30 * MIN)
    expect(rows[0].medianMs).toBe(47.5 * MIN)
    expect(rows[0].samples).toBe(2)
  })

  /**
   * The whole point of the threshold. Trash you killed twice in five minutes
   * is two of them standing next to each other, not one on a timer - and the
   * page would be unusable if every Diaku Guardian appeared on it.
   */
  it('ignores trash killed again too soon to have respawned', () => {
    const rows = spawnRows(totalsOf(mob('Diaku Guardian', [0, 90_000, 200_000])), [])
    expect(rows).toEqual([])
  })

  it('ignores a mob killed only once', () => {
    expect(spawnRows(totalsOf(mob('Ragefire', [0])), [])).toEqual([])
  })

  it('counts down to the last kill plus the shortest gap ever seen', () => {
    const last = 95 * MIN
    const rows = spawnRows(totalsOf(mob('Ragefire', [0, 30 * MIN, last])), [])
    expect(rows[0].lastKillAt).toBe(last)
    expect(rows[0].dueAt).toBe(last + 30 * MIN)
  })

  it('lists a pinned mob even with nothing to estimate from', () => {
    // Killed once. No gap, so no window - but the user asked for the row, and
    // that beats the heuristic that would have dropped it.
    const rows = spawnRows(totalsOf(mob('Ragefire', [1000])), ['Ragefire'])
    expect(rows).toHaveLength(1)
    expect(rows[0].tracked).toBe(true)
    expect(rows[0].shortestMs).toBeNull()
    expect(rows[0].dueAt).toBeNull()
  })

  /**
   * Pinning overrides the suggestion filter, not the arithmetic. If you pin
   * something you killed twice in five seconds, you get a five-second window,
   * because that is what was actually observed - the app doesn't get to
   * substitute a nicer number for the one in the ledger.
   */
  it('still reports the observed gap for a pinned mob below the threshold', () => {
    const rows = spawnRows(totalsOf(mob('a zek initiate', [0, 5000])), ['a zek initiate'])
    expect(rows[0].shortestMs).toBe(5000)
    expect(rows[0].dueAt).toBe(10_000)
  })

  it('puts pinned mobs first, then the soonest due', () => {
    const rows = spawnRows(
      totalsOf(
        mob('Later', [0, 3 * HOUR]),
        mob('Sooner', [0, 20 * MIN]),
        mob('Pinned', [0, 2 * HOUR])
      ),
      ['Pinned']
    )
    expect(rows.map((r) => r.mob)).toEqual(['Pinned', 'Sooner', 'Later'])
  })

  it('withholds a median until there are two gaps to take one of', () => {
    const rows = spawnRows(totalsOf(mob('Ragefire', [0, 30 * MIN])), [])
    expect(rows[0].samples).toBe(1)
    expect(rows[0].medianMs).toBe(30 * MIN)
  })

  /** Ledgers written before this page existed have no killTimes at all. */
  it('survives an older ledger with no kill times recorded', () => {
    const old = { ...blankMob('Ragefire', 0), kills: 12 } as MobTotals
    delete (old as Partial<MobTotals>).killTimes
    const rows = spawnRows(totalsOf(old), ['Ragefire'])
    expect(rows[0].shortestMs).toBeNull()
    expect(rows[0].kills).toBe(12)
  })

  it('treats the threshold as inclusive', () => {
    const rows = spawnRows(totalsOf(mob('Edge', [0, MIN_SPAWN_MS])), [])
    expect(rows).toHaveLength(1)
  })
})

describe('parseDuration', () => {
  it('reads the forms people actually type', () => {
    expect(parseDuration('90')).toBe(90)
    expect(parseDuration('5m')).toBe(300)
    expect(parseDuration('1h')).toBe(3600)
    expect(parseDuration('1h30m')).toBe(5400)
    expect(parseDuration('1h 30m')).toBe(5400)
    expect(parseDuration('45s')).toBe(45)
  })

  it('reads a colon as minutes and seconds, not hours and minutes', () => {
    expect(parseDuration('2:30')).toBe(150)
    expect(parseDuration('1:02:30')).toBe(3750)
  })

  it('refuses what it cannot read rather than guessing', () => {
    expect(parseDuration('')).toBeNull()
    expect(parseDuration('soon')).toBeNull()
    expect(parseDuration('5mx')).toBeNull()
    expect(parseDuration('1:2:3:4')).toBeNull()
    expect(parseDuration('m')).toBeNull()
  })
})

describe('countdown', () => {
  /**
   * Rounding to nearest would show 0:00 for the last half-second, which reads
   * as a timer that finished early and then made a noise about it.
   */
  it('rounds up, so it reads 0:01 until the very last moment', () => {
    expect(countdown(500)).toBe('0:01')
    expect(countdown(1)).toBe('0:01')
    expect(countdown(0)).toBe('0:00')
  })

  it('grows an hours field only when there are hours', () => {
    expect(countdown(90_000)).toBe('1:30')
    expect(countdown(3_600_000)).toBe('1:00:00')
    expect(countdown(3_750_000)).toBe('1:02:30')
  })

  it('never goes negative', () => {
    expect(countdown(-5000)).toBe('0:00')
  })
})

describe('duration', () => {
  it('reads at the scale of the thing being described', () => {
    expect(duration(45_000)).toBe('45s')
    expect(duration(22 * MIN)).toBe('22m')
    expect(duration(3 * HOUR)).toBe('3h')
    expect(duration(3 * HOUR + 20 * MIN)).toBe('3h 20m')
  })
})

describe('remainingMs', () => {
  const timer = (endsAt: number | null): ManualTimer => ({
    id: 'a',
    label: 'Repop',
    seconds: 600,
    endsAt,
    repeat: false,
    sound: 'chime'
  })

  it('is null when stopped, so the page can tell stopped from finished', () => {
    expect(remainingMs(timer(null), 1000)).toBeNull()
  })

  it('floors at zero rather than counting up past the deadline', () => {
    expect(remainingMs(timer(1000), 9999)).toBe(0)
    expect(remainingMs(timer(10_000), 4000)).toBe(6000)
  })
})
