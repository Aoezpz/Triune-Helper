import { describe, expect, it } from 'vitest'
import { parseLine, type ParseContext } from '../src/shared/parser/patterns'
import { tokenize } from '../src/shared/parser/tokenize'
import type { Encounter, ParsedEvent } from '../src/shared/parser/types'
import { summarize } from '../src/shared/stats'

/**
 * Healing, corrected against a real log.
 *
 * Every line below was copied out of eqlog_Hexzo_multiclass.txt. The rules they
 * exercise were written from the standard client strings and were wrong for
 * this server in two ways at once: the wording carries a trailing spell name,
 * and the target is a reflexive pronoun. Between them the Heals tab recorded
 * nothing at all.
 */

const ctx = (self = 'Hexzo', players: string[] = ['Hexzo']): ParseContext => ({
  self,
  petOwners: new Map(),
  players: new Set(players)
})

const parse = (body: string, c: ParseContext = ctx()): ParsedEvent => {
  const line = tokenize(`[Wed Aug 12 13:52:51 2026] ${body}`, c.self, 0)
  expect(line, body).not.toBeNull()
  return parseLine(line!, c)
}

describe('heals', () => {
  it('reads the wording this server actually writes, spell and all', () => {
    const ev = parse('Hexzo has healed herself for 1841 points of damage. (Killing Spree)')
    expect(ev.kind).toBe('heal')
    expect(ev.amount).toBe(1841)
    expect(ev.skill).toBe('Killing Spree')
  })

  it('resolves a reflexive target to the healer', () => {
    // Previously recorded as healing a mob named "herself".
    const ev = parse('Hexzo has healed herself for 1841 points of damage. (Killing Spree)')
    expect(ev.attacker?.name).toBe('Hexzo')
    expect(ev.target?.name).toBe('Hexzo')
    expect(ev.target?.kind).not.toBe('mob')
  })

  it('handles "itself" for a mob healing itself', () => {
    const ev = parse('Dumdududum has healed itself for 500 points of damage. (Vampiric Curse Recourse)')
    expect(ev.kind).toBe('heal')
    expect(ev.attacker?.name).toBe('Dumdududum')
    expect(ev.target?.name).toBe('Dumdududum')
  })

  it('still reads a heal on somebody else', () => {
    const ev = parse('Incredibaal has healed Hexzo for 900 points of damage.', ctx('Hexzo', ['Hexzo', 'Incredibaal']))
    expect(ev.attacker?.name).toBe('Incredibaal')
    expect(ev.target?.name).toBe('Hexzo')
    expect(ev.skill).toBe('Heal')
  })

  it('keeps the older hit-points wording working', () => {
    const ev = parse('Braxus healed Hexzo for 300 hit points by Celestial Health.')
    expect(ev.kind).toBe('heal')
    expect(ev.amount).toBe(300)
    expect(ev.skill).toBe('Celestial Health')
  })

  it('counts a crit heal, which names neither target nor spell', () => {
    const ev = parse('You perform an exceptional heal! (4213)')
    expect(ev.kind).toBe('heal')
    expect(ev.amount).toBe(4213)
    expect(ev.critical).toBe(true)
    expect(ev.attacker?.kind).toBe('self')
  })
})

describe('absorbs', () => {
  it('reads shielded damage as its own thing', () => {
    const ev = parse('Hexzo has shielded herself from 214 points of damage. (Shield of Songs)')
    expect(ev.kind).toBe('absorb')
    expect(ev.amount).toBe(214)
    expect(ev.skill).toBe('Shield of Songs')
    expect(ev.target?.name).toBe('Hexzo')
  })

  it('is not counted as healing', () => {
    // The whole point of the separate kind: a bard's shield must not outrank a
    // cleric on the healing board.
    const events = [
      parse('Hexzo has healed herself for 100 points of damage. (Killing Spree)'),
      parse('Hexzo has shielded herself from 900 points of damage. (Shield of Songs)')
    ]
    const enc: Encounter = {
      id: 'f',
      name: 'test',
      zone: null,
      start: events[0].ts,
      end: events[1].ts,
      live: false,
      activeSeconds: 10,
      events
    }
    const s = summarize(enc, new Set(['Hexzo']))
    expect(s.totalHealed).toBe(100)
    expect(s.totalAbsorbed).toBe(900)
    // And it produces no row, so the healing list stays a list of healers.
    expect(s.healing.reduce((n, r) => n + r.damage, 0)).toBe(100)
  })
})
