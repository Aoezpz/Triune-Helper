import { describe, expect, it } from 'vitest'
import { coinSession, summarizeLoot, type LootData } from '../src/shared/loot'
import {
  blankTotals,
  foldVisit,
  lifetimeRows,
  MIN_SECONDS_FOR_RATE,
  summarizeZones,
  type ZonesData,
  type ZoneTotals
} from '../src/shared/zones'

const at = (min: number): number => Date.UTC(2026, 7, 12, 1, min, 0)

const visit = (
  zone: string,
  fromMin: number,
  toMin: number,
  extra: Partial<{ kills: number; copper: number; deaths: number; aa: number }> = {}
): ZonesData['visits'][number] => ({
  zone,
  from: at(fromMin),
  to: at(toMin),
  kills: 0,
  copper: 0,
  deaths: 0,
  aa: 0,
  ...extra
})

describe('summarizeZones', () => {
  const data: ZonesData = {
    visits: [
      visit('Drunder, the Fortress of Zek', 0, 60, { kills: 300, copper: 180_000, aa: 12 }),
      // A minute in the Bazaar to sell, which is what a pass-through looks
      // like and must not produce a rate.
      visit('The Bazaar', 60, 61, { copper: 0 }),
      visit('Drunder, the Fortress of Zek', 63, 123, { kills: 280, copper: 160_000, deaths: 2, aa: 9 })
    ]
  }

  it('folds repeat visits to one row and sums them', () => {
    const rows = summarizeZones(data)
    const drunder = rows.find((r) => r.zone.startsWith('Drunder'))!
    expect(drunder.visits).toBe(2)
    expect(drunder.seconds).toBe(7200)
    expect(drunder.kills).toBe(580)
    expect(drunder.deaths).toBe(2)
    expect(drunder.aa).toBe(21)
  })

  it('ranks by time spent, which is the first question the page asks', () => {
    expect(summarizeZones(data).map((r) => r.zone)).toEqual([
      'Drunder, the Fortress of Zek',
      'The Bazaar'
    ])
  })

  it('computes rates over the time actually spent', () => {
    const drunder = summarizeZones(data).find((r) => r.zone.startsWith('Drunder'))!
    expect(drunder.killsPerHour).toBeCloseTo(290, 5) // 580 over two hours
    expect(drunder.copperPerHour).toBeCloseTo(170_000, 5)
  })

  /**
   * The Bazaar case. Zoning in to sell leaves a stub of a visit, and a rate
   * from it would top the table while describing nothing.
   */
  it('withholds a rate from a pass-through', () => {
    const bazaar = summarizeZones(data).find((r) => r.zone === 'The Bazaar')!
    expect(bazaar.seconds).toBeLessThan(MIN_SECONDS_FOR_RATE)
    expect(bazaar.killsPerHour).toBeNull()
    expect(bazaar.copperPerHour).toBeNull()
  })

  it('clips a visit that straddles the window edge', () => {
    // Otherwise a session total could exceed the session it belongs to.
    const rows = summarizeZones(data, { from: at(30), to: at(90) })
    const drunder = rows.find((r) => r.zone.startsWith('Drunder'))!
    expect(drunder.seconds).toBe(30 * 60 + 27 * 60)
  })

  it('leaves out visits entirely outside the window', () => {
    const rows = summarizeZones(data, { from: at(200), to: at(300) })
    expect(rows).toEqual([])
  })
})

/**
 * The lifetime ledger.
 *
 * Visits are capped so the file cannot grow forever; the ledger is not, because
 * "forty hours in Drunder" has to still be true in a year, long after the
 * visits that made it up have rolled off the end of the list.
 */
describe('lifetime totals', () => {
  const fold = (visits: ZonesData['visits']): Record<string, ZoneTotals> => {
    const totals: Record<string, ZoneTotals> = {}
    for (const v of visits) {
      const t = totals[v.zone] ?? blankTotals(v.zone, v.from)
      foldVisit(t, v)
      totals[v.zone] = t
    }
    return totals
  }

  it('accumulates across visits and keeps the span', () => {
    const totals = fold([
      visit('Drunder', 0, 60, { kills: 300, copper: 100 }),
      visit('Drunder', 120, 180, { kills: 200, copper: 50, deaths: 1 })
    ])
    expect(totals.Drunder).toEqual({
      zone: 'Drunder',
      seconds: 7200,
      visits: 2,
      kills: 500,
      copper: 150,
      deaths: 1,
      aa: 0,
      firstSeen: at(0),
      lastSeen: at(180)
    })
  })

  it('renders in the same shape the session table uses', () => {
    const rows = lifetimeRows(fold([visit('Drunder', 0, 60, { kills: 300 })]))
    expect(rows).toHaveLength(1)
    expect(rows[0].zone).toBe('Drunder')
    expect(rows[0].killsPerHour).toBeCloseTo(300, 5)
  })

  it('survives a store written before totals existed', () => {
    expect(lifetimeRows(undefined)).toEqual([])
  })

  /**
   * The double-count trap. The visit you are currently in has to appear in the
   * lifetime figure - otherwise tonight is missing from it - but it must not be
   * banked while still open, or it lands twice when it closes.
   */
  it('counts an in-progress visit exactly once', () => {
    const banked = fold([visit('Drunder', 0, 60, { kills: 300 })])
    const open = visit('Drunder', 60, 90, { kills: 100 })

    // What data() does: fold the open visit into a COPY for display.
    const shown = { ...banked }
    const t = { ...shown.Drunder }
    foldVisit(t, open)
    shown.Drunder = t

    expect(shown.Drunder.kills).toBe(400)
    // The stored ledger is untouched, so closing the visit later adds it once.
    expect(banked.Drunder.kills).toBe(300)

    foldVisit(banked.Drunder, open)
    expect(banked.Drunder.kills).toBe(400)
  })
})

describe('loot by zone', () => {
  const data: LootData = {
    coin: [
      { character: 'Hexzo', at: at(0), copper: 5000, item: 'Head of a Diaku Soldier', zone: 'Drunder' },
      { character: 'Hexzo', at: at(5), copper: 500, item: 'Sunshard Ore', zone: 'Drunder' },
      { character: 'Hexzo', at: at(10), copper: 273 },
      { character: 'Hexzo', at: at(15), copper: 100, zone: 'The Bazaar' }
    ],
    discoveries: []
  }

  it('splits income by where it was earned', () => {
    const s = summarizeLoot(data)
    expect(s.byZone).toEqual([
      { zone: 'Drunder', copper: 5500, events: 2 },
      { zone: 'The Bazaar', copper: 100, events: 1 }
    ])
  })

  it('owns up to coin banked before any zone was known', () => {
    // Rather than filing it under whichever zone came next, which would be a
    // guess dressed as a fact.
    expect(summarizeLoot(data).unzoned).toBe(273)
  })

  it('finds the session as the last unbroken run of activity', () => {
    const gapped: LootData = {
      coin: [
        { character: 'Hexzo', at: at(0), copper: 100 },
        // An hour's gap: yesterday, as far as the page is concerned.
        { character: 'Hexzo', at: at(90), copper: 200 },
        { character: 'Hexzo', at: at(95), copper: 300 }
      ],
      discoveries: []
    }
    const w = coinSession(gapped.coin)!
    expect(w.from).toBe(at(90))
    expect(summarizeLoot(gapped, w).total).toBe(500)
  })
})
