import { describe, expect, it } from 'vitest'
import { coinToCopper, formatCoin, summarizeLoot, type LootData } from '../src/shared/loot'
import { parseLine, type ParseContext } from '../src/shared/parser/patterns'
import { tokenize } from '../src/shared/parser/tokenize'
import type { ParsedEvent } from '../src/shared/parser/types'

const ctx = (): ParseContext => ({ self: 'Hexzo', petOwners: new Map(), players: new Set(['Hexzo']) })

const parse = (body: string): ParsedEvent => {
  const line = tokenize(`[Wed Aug 12 01:47:48 2026] ${body}`, 'Hexzo', 0)
  expect(line, body).not.toBeNull()
  return parseLine(line!, ctx())
}

/**
 * Money.
 *
 * Everything here is stored in copper and formatted on the way out. The
 * alternative - keeping "2 gold 7 silver" as text and adding it up later - is
 * how a total ends up disagreeing with the rows above it.
 */
describe('coin arithmetic', () => {
  it('converts a full phrase', () => {
    expect(coinToCopper('2 gold, 7 silver, 3 copper')).toBe(273)
  })

  it('converts phrases with units missing', () => {
    // The game prints only the units that are non-zero, in every combination.
    expect(coinToCopper('4 gold, 1 silver')).toBe(410)
    expect(coinToCopper('5 platinum')).toBe(5000)
    expect(coinToCopper('2 silver')).toBe(20)
    expect(coinToCopper('5 platinum, 2 gold, 1 silver')).toBe(5210)
  })

  it('returns null for something that is not a coin phrase', () => {
    // So "You receive no coin." stays distinguishable from a drop of zero.
    expect(coinToCopper('no coin')).toBeNull()
    expect(coinToCopper('')).toBeNull()
  })

  it('formats back to the units players read', () => {
    expect(formatCoin(273)).toBe('2g 7s 3c')
    expect(formatCoin(5000)).toBe('5p')
    expect(formatCoin(1234)).toBe('1p 2g 3s 4c')
    expect(formatCoin(0)).toBe('0c')
  })

  it('round-trips', () => {
    for (const n of [1, 9, 10, 99, 1000, 12345, 987654]) {
      expect(coinToCopper(formatCoin(n).replace(/(\d+)p/, '$1 platinum').replace(/(\d+)g/, '$1 gold').replace(/(\d+)s/, '$1 silver').replace(/(\d+)c/, '$1 copper'))).toBe(n)
    }
  })
})

describe('money lines', () => {
  it('reads coin off a corpse', () => {
    const ev = parse('You receive 2 gold, 7 silver, 3 copper.')
    expect(ev.kind).toBe('coin')
    expect(ev.amount).toBe(273)
    expect(ev.item).toBeUndefined()
  })

  it('reads the auto-sell, item and all', () => {
    const ev = parse('[NMS] Sunshard Ore sold for 5 silver.')
    expect(ev.kind).toBe('coin')
    expect(ev.amount).toBe(50)
    expect(ev.item).toBe('Sunshard Ore')
  })

  it('reads a multi-unit sale', () => {
    const ev = parse('[NMS] Diaku Forged Scimitar sold for 3 platinum, 2 gold.')
    expect(ev.amount).toBe(3200)
    expect(ev.item).toBe('Diaku Forged Scimitar')
  })

  it('ignores the empty-handed message', () => {
    // 119 of these in a day. Recording them as drops of zero would bury the
    // real ones.
    expect(parse('You receive no coin.').kind).toBe('unparsed')
  })
})

describe('summarizeLoot', () => {
  const at = (s: number): number => Date.UTC(2026, 7, 12, 1, 0, s)

  const data: LootData = {
    coin: [
      { character: 'Hexzo', at: at(0), copper: 273 },
      { character: 'Hexzo', at: at(60), copper: 50, item: 'Sunshard Ore' },
      { character: 'Hexzo', at: at(120), copper: 50, item: 'Sunshard Ore' },
      { character: 'Hexzo', at: at(180), copper: 5000, item: 'Diaku Forged Axe' }
    ],
    discoveries: []
  }

  it('splits the two income streams and totals them', () => {
    const s = summarizeLoot(data)
    expect(s.fromKills).toBe(273)
    expect(s.fromSales).toBe(5100)
    expect(s.total).toBe(5373)
  })

  it('ranks what sold by what it earned, not by how often', () => {
    const s = summarizeLoot(data)
    expect(s.sold.map((r) => r.item)).toEqual(['Diaku Forged Axe', 'Sunshard Ore'])
    expect(s.sold[1]).toEqual({ item: 'Sunshard Ore', count: 2, copper: 100 })
  })

  it('measures the rate across the drops, not the requested window', () => {
    // 5373 copper over 180 seconds.
    const s = summarizeLoot(data)
    expect(s.perHour).toBeCloseTo((5373 / 180) * 3600, 5)
  })

  it('refuses a rate when too little time has passed', () => {
    // Two drops nine seconds apart. Extrapolating that to an hour would report
    // a plat/hour figure off by an order of magnitude in either direction.
    const brief: LootData = {
      coin: [
        { character: 'Hexzo', at: at(0), copper: 273 },
        { character: 'Hexzo', at: at(9), copper: 50, item: 'Sunshard Ore' }
      ],
      discoveries: []
    }
    expect(summarizeLoot(brief).perHour).toBeNull()
  })

  it('starts reporting a rate exactly at the threshold', () => {
    const edge: LootData = {
      coin: [
        { character: 'Hexzo', at: at(0), copper: 1000 },
        { character: 'Hexzo', at: at(60), copper: 1000 }
      ],
      discoveries: []
    }
    expect(summarizeLoot(edge).perHour).toBeCloseTo(120_000, 5)
  })

  it('reports no rate at all from a single drop', () => {
    const one: LootData = { coin: [data.coin[0]], discoveries: [] }
    expect(summarizeLoot(one).perHour).toBeNull()
    expect(one.coin).toHaveLength(1)
  })
})
