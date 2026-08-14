import { describe, expect, it } from 'vitest'
import type { Encounter, ParsedEvent } from '../src/shared/parser/types'
import { buildProcs, MIN_SECONDS_FOR_RATE } from '../src/shared/stats'

/**
 * What the proc panel is allowed to claim.
 *
 * A count is an observation. A rate is a derivation, and dividing one proc by a
 * two-second fight produces "30 per minute" - arithmetically true, worthless as
 * information, and actively misleading because PPM is already the name of the
 * proc rate printed on a weapon. So the rate is withheld until the sample can
 * carry it.
 */

let seq = 0
const ev = (over: Partial<ParsedEvent>): ParsedEvent => ({
  kind: 'melee',
  ts: 1_000_000 + seq * 1000,
  seq: seq++,
  source: 'Hexzo',
  raw: '',
  ...over
})

const swing = (by: string): ParsedEvent =>
  ev({ kind: 'melee', attacker: { name: by, kind: 'self' }, skill: 'slash', amount: 100 })

const proc = (by: string, name: string): ParsedEvent =>
  ev({ kind: 'spell', attacker: { name: by, kind: 'self' }, skill: name, amount: 500 })

const fight = (events: ParsedEvent[]): Encounter => ({
  id: 'f',
  name: 'Diaku Guardian',
  zone: null,
  start: 1_000_000,
  end: 1_000_000,
  live: false,
  activeSeconds: 0,
  events
})

describe('proc rates', () => {
  it('counts a proc as a proc when its source also swings a weapon', () => {
    const rows = buildProcs(fight([swing('Hexzo'), proc('Hexzo', 'Time Rend')]), 60)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({ name: 'Time Rend', count: 1, perMinute: 1 })
  })

  it('says nothing about the rate on a fight too short to support one', () => {
    // The two-second pull that started this: 1 proc became "30.00 ppm".
    const rows = buildProcs(fight([swing('Hexzo'), proc('Hexzo', 'Time Rend')]), 2)
    expect(rows[0].count).toBe(1)
    expect(rows[0].perMinute).toBeNull()
  })

  it('starts reporting a rate exactly at the threshold', () => {
    const events = [swing('Hexzo'), proc('Hexzo', 'Time Rend'), proc('Hexzo', 'Time Rend')]
    expect(buildProcs(fight(events), MIN_SECONDS_FOR_RATE - 1)[0].perMinute).toBeNull()
    expect(buildProcs(fight(events), MIN_SECONDS_FOR_RATE)[0].perMinute).toBe(4)
  })

  it('leaves a cast nuke out of the proc list', () => {
    // A caster who never swings is casting, not proccing. Without this the
    // panel would report every wizard nuke as a weapon proc.
    const rows = buildProcs(fight([swing('Hexzo'), proc('Vexthar', 'Ice Comet')]), 60)
    expect(rows).toHaveLength(0)
  })

  it('leaves damage shields out', () => {
    const rows = buildProcs(fight([swing('Hexzo'), proc('Hexzo', 'Damage shield')]), 60)
    expect(rows).toHaveLength(0)
  })

  it('ranks by count, not by rate - they cannot disagree, and count is the fact', () => {
    const rows = buildProcs(
      fight([
        swing('Hexzo'),
        proc('Hexzo', 'Cry of Thunder Strike'),
        proc('Hexzo', 'Time Rend'),
        proc('Hexzo', 'Time Rend')
      ]),
      60
    )
    expect(rows.map((r) => r.name)).toEqual(['Time Rend', 'Cry of Thunder Strike'])
  })
})
