import { describe, expect, it } from 'vitest'
import {
  compile,
  exportRules,
  importRules,
  interpolate,
  matches,
  newRule,
  patternFromLine
} from '../src/shared/alerts'
import { parseLine } from '../src/shared/parser/patterns'
import { tokenize } from '../src/shared/parser/tokenize'
import type { ParsedEvent } from '../src/shared/parser/types'

function event(body: string): ParsedEvent {
  const line = tokenize(`[Wed Aug 11 19:44:02 2026] ${body}`, 'Braxus', 0)!
  return parseLine(line, { self: 'Braxus', petOwners: new Map() })
}

describe('matching', () => {
  it('matches plain text, case-insensitively by default', () => {
    const rule = newRule({ match: { kind: 'contains', value: 'charm spell has worn off', caseSensitive: false } })
    expect(matches(rule, event('Your charm spell has worn off.'), null)).toEqual([])
    expect(matches(rule, event('You slash a gnoll for 45 points of damage.'), null)).toBeNull()
  })

  it('honours case sensitivity when asked', () => {
    const rule = newRule({ match: { kind: 'contains', value: 'CHARM', caseSensitive: true } })
    expect(matches(rule, event('Your charm spell has worn off.'), null)).toBeNull()
  })

  it('returns regex captures', () => {
    const rule = newRule({ match: { kind: 'regex', value: '^(.+) has fled', caseSensitive: false } })
    const groups = matches(rule, event('a gnoll has fled.'), compile(rule))
    expect(groups).toEqual(['a gnoll'])
  })

  it('disables a rule with an invalid regex rather than throwing', () => {
    const rule = newRule({ match: { kind: 'regex', value: '([unclosed', caseSensitive: false } })
    expect(compile(rule)).toBeNull()
    expect(() => matches(rule, event('anything at all'), compile(rule))).not.toThrow()
    expect(matches(rule, event('anything at all'), compile(rule))).toBeNull()
  })

  it('respects scope', () => {
    const combatOnly = newRule({ scope: 'combat', match: { kind: 'contains', value: 'gnoll', caseSensitive: false } })
    expect(matches(combatOnly, event('You slash a gnoll for 45 points of damage.'), null)).toEqual([])
    // An unparsed line is chat as far as scoping goes.
    expect(matches(combatOnly, event('Someone tells you, hello gnoll'), null)).toBeNull()

    const chatOnly = newRule({ scope: 'chat', match: { kind: 'contains', value: 'gnoll', caseSensitive: false } })
    expect(matches(chatOnly, event('Someone tells you, hello gnoll'), null)).toEqual([])
    expect(matches(chatOnly, event('You slash a gnoll for 45 points of damage.'), null)).toBeNull()
  })

  it('never matches a disabled rule or an empty pattern', () => {
    const off = newRule({ enabled: false, match: { kind: 'contains', value: 'gnoll', caseSensitive: false } })
    expect(matches(off, event('You slash a gnoll for 45 points of damage.'), null)).toBeNull()
    const blank = newRule({ match: { kind: 'contains', value: '', caseSensitive: false } })
    expect(matches(blank, event('anything'), null)).toBeNull()
  })
})

describe('speech interpolation', () => {
  it('substitutes captures', () => {
    expect(interpolate('Level $1', ['52'])).toBe('Level 52')
    expect(interpolate('$1 fled from $2', ['a gnoll', 'Braxus'])).toBe('a gnoll fled from Braxus')
  })

  it('leaves an unmatched placeholder empty rather than printing $3', () => {
    expect(interpolate('a $3 b', ['x'])).toBe('a  b')
  })
})

describe('building a pattern from a line', () => {
  it('generalises numbers and known names', () => {
    const pattern = patternFromLine('Braxus hits a gnoll for 123 points of damage.', ['Braxus'])
    expect(pattern).toContain('(\\w+)')
    expect(pattern).toContain('(\\d+)')
    // The generated pattern must actually match the line it came from.
    const re = new RegExp(pattern)
    expect(re.test('Braxus hits a gnoll for 123 points of damage.')).toBe(true)
    expect(re.test('Vexthar hits a gnoll for 45 points of damage.')).toBe(true)
  })

  it('escapes regex metacharacters in the source line', () => {
    const pattern = patternFromLine('You gain experience!! (again)')
    expect(() => new RegExp(pattern)).not.toThrow()
    expect(new RegExp(pattern).test('You gain experience!! (again)')).toBe(true)
  })
})

describe('share strings', () => {
  it('round-trips a rule', () => {
    const rule = newRule({
      name: 'Charm break',
      match: { kind: 'regex', value: '^Your charm spell has worn off', caseSensitive: false },
      sound: 'alarm',
      speak: 'Charm broke',
      debounceMs: 1500
    })

    const text = exportRules([rule])
    expect(text.startsWith('TRIA1:')).toBe(true)

    const [back] = importRules(text)
    expect(back.name).toBe(rule.name)
    expect(back.match).toEqual(rule.match)
    expect(back.sound).toBe(rule.sound)
    expect(back.speak).toBe(rule.speak)
    expect(back.debounceMs).toBe(rule.debounceMs)
    // An imported rule gets its own id, so importing twice doesn't collide.
    expect(back.id).not.toBe(rule.id)
  })

  it('round-trips several rules at once', () => {
    const rules = [newRule({ name: 'One' }), newRule({ name: 'Two' })]
    const back = importRules(exportRules(rules))
    expect(back.map((r) => r.name)).toEqual(['One', 'Two'])
  })

  it('survives non-ASCII, which latin1 base64 would mangle', () => {
    const rule = newRule({ name: 'Kelorek`Dar — résumé ✦', speak: 'Kelorek Dar' })
    expect(importRules(exportRules([rule]))[0].name).toBe('Kelorek`Dar — résumé ✦')
  })

  it('rejects anything that is not a Triune string', () => {
    expect(() => importRules('hello')).toThrow(/TRIA1:/)
    expect(() => importRules('GINA1:abcd')).toThrow(/TRIA1:/)
  })
})
