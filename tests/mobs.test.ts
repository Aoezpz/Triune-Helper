import { describe, expect, it } from 'vitest'
import { blankMob, MIN_KILLS_FOR_AVERAGE, mobRows, type MobTotals } from '../src/shared/mobs'

/**
 * The bestiary's arithmetic.
 *
 * The store itself imports electron, so what is tested here is the shape the
 * page renders from - which is where every judgement call about what may be
 * claimed actually lives.
 */

const mob = (over: Partial<MobTotals> = {}): MobTotals => ({
  ...blankMob('Diaku Guardian', 0),
  ...over
})

describe('mobRows', () => {
  it('averages a kill time once there are enough kills to mean one', () => {
    const rows = mobRows({ a: mob({ kills: 10, seconds: 600, damageDone: 6000 }) })
    expect(rows[0].averageSeconds).toBe(60)
  })

  it('refuses to average one lucky pull', () => {
    const rows = mobRows({ a: mob({ kills: MIN_KILLS_FOR_AVERAGE - 1, seconds: 12 }) })
    expect(rows[0].averageSeconds).toBeNull()
  })

  it('keeps the fastest kill regardless of how few there have been', () => {
    // A personal best is a fact about one fight, so unlike the average it needs
    // no sample size to be true.
    const rows = mobRows({ a: mob({ kills: 1, seconds: 12, fastestSeconds: 12 }) })
    expect(rows[0].fastestSeconds).toBe(12)
    expect(rows[0].averageSeconds).toBeNull()
  })

  it('says nothing rather than infinity for a mob that has never killed you', () => {
    const rows = mobRows({ a: mob({ kills: 40, deaths: 0 }) })
    expect(rows[0].ratio).toBeNull()
  })

  it('computes a kill-to-death ratio when there is one to compute', () => {
    const rows = mobRows({ a: mob({ kills: 40, deaths: 2 }) })
    expect(rows[0].ratio).toBe(20)
  })

  it('rates damage over the time spent fighting', () => {
    const rows = mobRows({ a: mob({ seconds: 100, damageDone: 250_000 }) })
    expect(rows[0].dps).toBe(2500)
  })

  it('ranks by kills', () => {
    const rows = mobRows({
      a: mob({ mob: 'a zek initiate', kills: 3 }),
      b: mob({ mob: 'Diaku Guardian', kills: 30 })
    })
    expect(rows.map((r) => r.mob)).toEqual(['Diaku Guardian', 'a zek initiate'])
  })

  it('survives a store written before mobs were tracked', () => {
    expect(mobRows(undefined)).toEqual([])
  })
})
