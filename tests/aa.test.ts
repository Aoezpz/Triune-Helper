import { describe, expect, it } from 'vitest'
import { summarizeCharacter, type LevelingData } from '../src/shared/leveling'
import { parseLine, type ParseContext } from '../src/shared/parser/patterns'
import { tokenize } from '../src/shared/parser/tokenize'

/**
 * The one quantity this server states outright.
 *
 * Regular experience is unquantified and the app says so. AA is not: the log
 * carries "You gain bonus AA experience! (5087/18850)", and what those numbers
 * mean was established by reading a real log rather than by assuming - across
 * 142 of them the first rises by exactly one per ability point earned and the
 * second never moves. Earned out of available, not progress toward the next.
 */

const ctx = (self = 'Hexzo'): ParseContext => ({
  self,
  petOwners: new Map(),
  players: new Set([self])
})

const parse = (body: string): ReturnType<typeof parseLine> => {
  const line = tokenize(`[Wed Aug 12 01:47:35 2026] ${body}`, 'Hexzo', 0)
  expect(line, body).not.toBeNull()
  return parseLine(line!, ctx())
}

describe('the AA counter', () => {
  it('reads both halves of the pair', () => {
    const ev = parse('You gain bonus AA experience! (5059/18850)')
    expect(ev.kind).toBe('aaxp')
    expect(ev.amount).toBe(5059)
    expect(ev.outOf).toBe(18850)
  })

  it('does not swallow the plain experience message', () => {
    // These sit next to each other in the log and share a prefix.
    expect(parse('You gain experience!!').kind).toBe('xp')
    expect(parse('You gain party experience!!').kind).toBe('xp')
  })

  it('leaves the ability-point message as its own thing', () => {
    // Unspent points - a different quantity from AA earned, and confusing the
    // two is what made the page report 23 for a character who had earned 5,087.
    const ev = parse('You have gained an ability point!  You now have 23 ability points.')
    expect(ev.kind).toBe('aa')
    expect(ev.amount).toBe(23)
  })
})

describe('AA rates', () => {
  const at = (h: number): number => Date.UTC(2026, 7, 12, h, 0, 0)

  const data = (marks: Array<[hour: number, earned: number]>): LevelingData => ({
    levels: [],
    aa: [],
    aaxp: marks.map(([h, earned]) => ({
      character: 'Hexzo',
      at: at(h),
      earned,
      available: 18850
    })),
    ticks: [{ character: 'Hexzo', at: at(0) }]
  })

  it('reports earned and available from the latest reading', () => {
    const p = summarizeCharacter('Hexzo', data([[0, 5059], [2, 5087]]), { from: at(0), to: at(2) })
    expect(p.aaEarned).toBe(5087)
    expect(p.aaAvailable).toBe(18850)
  })

  /**
   * The rate is a difference over elapsed time, NOT a count of messages. The
   * counter is printed on nearly every kill and moves on few of them, so
   * counting messages would report a rate many times the truth.
   */
  it('measures the rate from the readings, not from how often they appeared', () => {
    const p = summarizeCharacter('Hexzo', data([[0, 5059], [2, 5087]]), { from: at(0), to: at(2) })
    expect(p.aaEarnedPerHour).toBe(14) // 28 gained over 2 hours
  })

  it('projects the remaining AA at that rate', () => {
    const p = summarizeCharacter('Hexzo', data([[0, 5059], [2, 5087]]), { from: at(0), to: at(2) })
    // 18850 - 5087 = 13763 remaining, at 14/hour.
    expect(p.etaAllAaSeconds).toBeCloseTo((13763 / 14) * 3600, 0)
  })

  it('refuses to project from a single reading', () => {
    const p = summarizeCharacter('Hexzo', data([[0, 5059]]), { from: at(0), to: at(0) })
    expect(p.aaEarnedPerHour).toBeNull()
    expect(p.etaAllAaSeconds).toBeNull()
  })

  it('refuses to project when the counter has not moved', () => {
    const p = summarizeCharacter('Hexzo', data([[0, 5059], [2, 5059]]), { from: at(0), to: at(2) })
    expect(p.aaEarnedPerHour).toBeNull()
    expect(p.etaAllAaSeconds).toBeNull()
  })

  it('survives a store written before AA was tracked', () => {
    // Existing installs have no `aaxp` key at all; reading one must not throw.
    const legacy = { levels: [], aa: [], ticks: [] } as unknown as LevelingData
    const p = summarizeCharacter('Hexzo', legacy, null)
    expect(p.aaEarned).toBeNull()
    expect(p.aaEarnedPerHour).toBeNull()
  })
})
