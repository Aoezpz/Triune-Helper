import { describe, expect, it } from 'vitest'
import { ownsEvent, type MergeConfig } from '../src/shared/parser/merge'
import { parseLine, type ParseContext } from '../src/shared/parser/patterns'
import { tokenize } from '../src/shared/parser/tokenize'

/**
 * The third-person-about-yourself case.
 *
 * Project Triune writes attributed spell damage in the third person even in
 * your own log - `Hexzo hit Diaku Guardian for 950 points of non-melee damage.
 * (Time Rend)` appears in Hexzo's file, naming Hexzo. Melee, by contrast, is
 * first person. So a single character produces both forms, and the merge rule
 * has to count each exactly once without the two shapes disagreeing about who
 * did it.
 */
describe('a log naming its own character in the third person', () => {
  const ctx = (self: string, players: string[]): ParseContext => ({
    self,
    petOwners: new Map(),
    players: new Set(players)
  })

  const parse = (body: string, c: ParseContext): ReturnType<typeof parseLine> => {
    const line = tokenize(`[Wed Aug 12 01:47:35 2026] ${body}`, c.self, 0)
    expect(line).not.toBeNull()
    return parseLine(line!, c)
  }

  const solo: MergeConfig = {
    selfBySource: new Map([['Hexzo', 'Hexzo']]),
    primarySource: 'Hexzo',
    petOwners: new Map()
  }

  it('credits the damage to the character, not to a stranger', () => {
    const ev = parse(
      'Hexzo hit Diaku Guardian for 950 points of non-melee damage. (Time Rend)',
      ctx('Hexzo', ['Hexzo'])
    )
    expect(ev.kind).toBe('spell')
    expect(ev.attacker?.name).toBe('Hexzo')
    expect(ev.skill).toBe('Time Rend')
  })

  it('does the same for third-person melee', () => {
    const ev = parse('Hexzo hits Zelrin Morlock for 7207 points of damage.', ctx('Hexzo', ['Hexzo']))
    expect(ev.kind).toBe('melee')
    expect(ev.attacker?.name).toBe('Hexzo')
    expect(ownsEvent(ev, solo)).toBe(true)
  })

  it('counts it once when that character is the only log being read', () => {
    const ev = parse(
      'Hexzo hit Diaku Guardian for 950 points of non-melee damage. (Time Rend)',
      ctx('Hexzo', ['Hexzo'])
    )
    // Without this the meter reads zero for every caster on the server, because
    // the only place the line exists is the log of the person it names.
    expect(ownsEvent(ev, solo)).toBe(true)
  })

  it('still counts it exactly once across a boxed trio', () => {
    const trio: MergeConfig = {
      selfBySource: new Map([
        ['Hexzo', 'Hexzo'],
        ['Braxus', 'Braxus'],
        ['Vexthar', 'Vexthar']
      ]),
      primarySource: 'Hexzo',
      petOwners: new Map()
    }
    const players = ['Hexzo', 'Braxus', 'Vexthar']

    // The same line is written to all three logs. Exactly one copy must count,
    // and it has to be the copy in Braxus's own log - that is the one that is
    // never truncated by distance.
    const owned = players.filter((source) =>
      ownsEvent(
        parse(
          'Braxus hit Diaku Guardian for 950 points of non-melee damage. (Time Rend)',
          ctx(source, players)
        ),
        trio
      )
    )
    expect(owned).toEqual(['Braxus'])
  })
})
