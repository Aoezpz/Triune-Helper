import { describe, expect, it } from 'vitest'
import { EncounterTracker } from '../src/shared/parser/encounter'
import { parseLine, type ParseContext } from '../src/shared/parser/patterns'
import { tokenize } from '../src/shared/parser/tokenize'
import type { ParsedEvent } from '../src/shared/parser/types'
import { buildSpecials } from '../src/shared/stats'

/**
 * Named hit modifiers.
 *
 * Every sequence below is lifted from a real log. The point of the feature is
 * that these lines are announcements ABOUT the next hit, not events in
 * themselves - so the test that matters is whether the damage ends up carrying
 * the modifier, through however many lines sit in between.
 */

const ctx = (self = 'Hexzo'): ParseContext => ({
  self,
  petOwners: new Map(),
  players: new Set([self])
})

let clock = 0
function feed(bodies: string[], self = 'Hexzo'): ParsedEvent[] {
  const c = ctx(self)
  const tracker = new EncounterTracker({ timeoutSeconds: 30 })
  const events = bodies.map((body, i) => {
    const line = tokenize(
      `[Wed Aug 12 14:0${Math.floor((clock + i) / 60) % 10}:${String((clock + i) % 60).padStart(2, '0')} 2026] ${body}`,
      self,
      i
    )
    expect(line, body).not.toBeNull()
    return parseLine(line!, c)
  })
  clock += bodies.length
  return tracker.feed(events)
}

describe('special hit modifiers', () => {
  it('recognises the four this server writes', () => {
    const out = feed([
      'Your bow shot did double dmg.',
      "You strike through your opponent's defenses!",
      'Hexzo scores a Finishing Blow!!',
      'Hexzo performs a FATAL BOW SHOT!!'
    ])
    expect(out.map((e) => e.skill)).toEqual([
      'Double bow shot',
      'Strikethrough',
      'Finishing Blow',
      'Fatal Bow Shot'
    ])
    expect(out.every((e) => e.kind === 'special')).toBe(true)
  })

  it('attaches the modifier to the hit that follows', () => {
    const out = feed([
      'Hexzo performs a FATAL BOW SHOT!!',
      'You hit Diaku Guardian for 186954 points of damage.'
    ])
    const hit = out.at(-1)!
    expect(hit.kind).toBe('melee')
    expect(hit.amount).toBe(186954)
    expect(hit.mods).toEqual(['Fatal Bow Shot'])
  })

  /**
   * The real sequence that made a "pair with the next line" rule impossible:
   * the double-shot announcement, then a crit announcement, then the damage.
   */
  it('stacks with a crit across the lines between them', () => {
    const out = feed([
      'Your bow shot did double dmg.',
      'Hexzo scores a critical hit! (13694)',
      'You hit Diaku Guardian for 13694 points of damage.'
    ])
    const hit = out.at(-1)!
    expect(hit.critical).toBe(true)
    expect(hit.mods).toEqual(['Double bow shot'])
  })

  it('does not leak a modifier onto a second hit', () => {
    const out = feed([
      'Hexzo scores a Finishing Blow!!',
      'You hit Diaku Guardian for 41386 points of damage.',
      'You hit Diaku Guardian for 900 points of damage.'
    ])
    expect(out[1].mods).toEqual(['Finishing Blow'])
    expect(out[2].mods).toBeUndefined()
  })

  it('keeps one attacker\'s modifier off another\'s hit', () => {
    const out = feed([
      'Incredibaal performs a FATAL BOW SHOT!!',
      'You hit Diaku Guardian for 500 points of damage.'
    ])
    expect(out[1].mods).toBeUndefined()
  })

  it('leaves the killing-spree announcement alone', () => {
    // A streak message, not a modifier - attaching it would credit an
    // unrelated swing with something it did not do.
    const out = feed(['You go on a killing spree!', 'You hit Diaku Guardian for 500 points of damage.'])
    expect(out[0].kind).toBe('unparsed')
    expect(out[1].mods).toBeUndefined()
  })
})

describe('buildSpecials', () => {
  const enc = (events: ParsedEvent[]): Parameters<typeof buildSpecials>[0] => ({
    id: 'f',
    name: 'test',
    zone: null,
    start: 0,
    end: 1,
    live: false,
    activeSeconds: 10,
    events
  })

  it('reports the count and the best hit it landed on', () => {
    const events = feed([
      'Hexzo performs a FATAL BOW SHOT!!',
      'You hit Diaku Guardian for 186954 points of damage.',
      'Hexzo performs a FATAL BOW SHOT!!',
      'You hit Diaku Guardian for 90000 points of damage.'
    ])
    const rows = buildSpecials(enc(events))
    expect(rows).toEqual([
      { name: 'Fatal Bow Shot', count: 2, damage: 276954, best: 186954 }
    ])
  })

  it('still counts an announcement whose hit never arrived', () => {
    // A modifier announced as the fight ends has nothing to attach to. The
    // count is real even though the damage is zero.
    const rows = buildSpecials(enc(feed(['Hexzo scores a Finishing Blow!!'])))
    expect(rows).toEqual([{ name: 'Finishing Blow', count: 1, damage: 0, best: 0 }])
  })
})
