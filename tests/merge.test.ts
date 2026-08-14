import { describe, expect, it } from 'vitest'
import { EncounterTracker } from '../src/shared/parser/encounter'
import { mergeEvents, type MergeConfig } from '../src/shared/parser/merge'
import { parseLine, type ParseContext } from '../src/shared/parser/patterns'
import { tokenize } from '../src/shared/parser/tokenize'
import type { ParsedEvent } from '../src/shared/parser/types'

const TRIO = ['Braxus', 'Vexthar', 'Solene']

function cfg(): MergeConfig {
  return {
    selfBySource: new Map(TRIO.map((c) => [c, c])),
    primarySource: 'Braxus',
    petOwners: new Map([['Gark', 'Vexthar']])
  }
}

/** Parse a log as if written by `self`, at second `sec` past the base minute. */
function log(self: string, lines: Array<[sec: number, body: string]>): ParsedEvent[] {
  const ctx: ParseContext = { self, petOwners: new Map([['Gark', 'Vexthar']]) }
  return lines.map(([sec, body], i) => {
    const ss = String(sec).padStart(2, '0')
    const line = tokenize(`[Wed Aug 11 19:44:${ss} 2026] ${body}`, self, i)!
    return parseLine(line, ctx)
  })
}

function damageTotal(events: ParsedEvent[]): number {
  return events.reduce((sum, e) => sum + (e.amount ?? 0), 0)
}

/**
 * The same fight, written three ways.
 *
 * Braxus and Vexthar each swing twice; Vexthar's pet Gark swings once; the mob
 * swings at Braxus once. Each character's log records their OWN swings in the
 * first person and everyone else's in the third - which is exactly why naive
 * concatenation triples the third-party lines.
 */
const BRAXUS_LOG: Array<[number, string]> = [
  [1, 'You slash a gnoll for 100 points of damage.'],
  [2, 'Vexthar slashes a gnoll for 50 points of damage.'],
  [2, 'Gark bites a gnoll for 30 points of damage.'],
  [3, 'a gnoll hits Braxus for 12 points of damage.'],
  [4, 'You slash a gnoll for 100 points of damage.'],
  [4, 'Vexthar slashes a gnoll for 50 points of damage.']
]

const VEXTHAR_LOG: Array<[number, string]> = [
  [1, 'Braxus slashes a gnoll for 100 points of damage.'],
  [2, 'You slash a gnoll for 50 points of damage.'],
  [2, 'Gark bites a gnoll for 30 points of damage.'],
  [3, 'a gnoll hits Braxus for 12 points of damage.'],
  [4, 'Braxus slashes a gnoll for 100 points of damage.'],
  [4, 'You slash a gnoll for 50 points of damage.']
]

const SOLENE_LOG: Array<[number, string]> = [
  [1, 'Braxus slashes a gnoll for 100 points of damage.'],
  [2, 'Vexthar slashes a gnoll for 50 points of damage.'],
  [2, 'Gark bites a gnoll for 30 points of damage.'],
  [3, 'a gnoll hits Braxus for 12 points of damage.'],
  [4, 'Braxus slashes a gnoll for 100 points of damage.'],
  [4, 'Vexthar slashes a gnoll for 50 points of damage.']
]

/** 100+50+30+12+100+50 */
const TRUE_TOTAL = 342

describe('trio merge', () => {
  it('a single log parses to the true total', () => {
    expect(damageTotal(log('Braxus', BRAXUS_LOG))).toBe(TRUE_TOTAL)
  })

  it('naive concatenation of three logs triples third-party damage', () => {
    const all = [...log('Braxus', BRAXUS_LOG), ...log('Vexthar', VEXTHAR_LOG), ...log('Solene', SOLENE_LOG)]
    // This is the bug the merge rule exists to prevent - assert it is real, so
    // the test fails loudly if someone "simplifies" the merge away.
    expect(damageTotal(all)).toBeGreaterThan(TRUE_TOTAL)
  })

  it('merging three logs gives the same total as one log', () => {
    const all = [...log('Braxus', BRAXUS_LOG), ...log('Vexthar', VEXTHAR_LOG), ...log('Solene', SOLENE_LOG)]
    expect(damageTotal(mergeEvents(all, cfg()))).toBe(TRUE_TOTAL)
  })

  it('counts each combatant exactly once', () => {
    const all = [...log('Braxus', BRAXUS_LOG), ...log('Vexthar', VEXTHAR_LOG), ...log('Solene', SOLENE_LOG)]
    const merged = mergeEvents(all, cfg())

    const by = (name: string): number =>
      damageTotal(merged.filter((e) => e.attacker?.name === name))

    expect(by('Braxus')).toBe(200)
    expect(by('Vexthar')).toBe(100)
    expect(by('Gark')).toBe(30) // the pet, owned by Vexthar's log
    expect(by('a gnoll')).toBe(12) // the mob, owned by the primary log
  })

  it("attributes a pet's damage through the owner's log, not the primary", () => {
    const all = [...log('Braxus', BRAXUS_LOG), ...log('Vexthar', VEXTHAR_LOG), ...log('Solene', SOLENE_LOG)]
    const gark = mergeEvents(all, cfg()).filter((e) => e.attacker?.name === 'Gark')
    expect(gark).toHaveLength(1)
    expect(gark[0].source).toBe('Vexthar')
  })

  it('does not collapse two genuinely identical simultaneous hits', () => {
    // Two characters landing the same number on the same mob in the same second
    // is common. A timestamp+amount de-dupe would eat one of these.
    const events = [
      ...log('Braxus', [[5, 'You slash a gnoll for 75 points of damage.']]),
      ...log('Vexthar', [[5, 'You slash a gnoll for 75 points of damage.']])
    ]
    expect(damageTotal(mergeEvents(events, cfg()))).toBe(150)
  })

  it('keeps levels and ability points from every log, not just the primary', () => {
    // Each character levels independently, and each writes "You have gained a
    // level!" to its OWN log. Attributing these by the primary-log rule would
    // make two thirds of the trio look like they never level.
    const events = [
      ...log('Braxus', [[1, 'You have gained a level! Welcome to level 52!']]),
      ...log('Vexthar', [[2, 'You have gained a level! Welcome to level 51!']]),
      ...log('Solene', [[3, 'You have gained an ability point!  You now have 12 ability points.']])
    ]
    const merged = mergeEvents(events, cfg())
    expect(merged).toHaveLength(3)
    expect(merged.map((e) => e.source).sort()).toEqual(['Braxus', 'Solene', 'Vexthar'])
  })

  it('still counts experience messages once per character', () => {
    const events = [
      ...log('Braxus', [[1, 'You gain experience!!']]),
      ...log('Vexthar', [[1, 'You gain experience!!']])
    ]
    expect(mergeEvents(events, cfg())).toHaveLength(2)
  })

  it('drops a solo log entirely when it is neither the actor nor primary', () => {
    // Solene swung at nothing, so her log contributes no totals at all.
    const merged = mergeEvents(log('Solene', SOLENE_LOG), cfg())
    expect(merged).toHaveLength(0)
  })
})

describe('encounters', () => {
  function track(events: ParsedEvent[], timeoutSeconds = 8): EncounterTracker {
    const t = new EncounterTracker({ timeoutSeconds })
    t.feed(events)
    return t
  }

  it('opens on the first damage against a mob', () => {
    const t = track(log('Braxus', BRAXUS_LOG))
    expect(t.live).not.toBeNull()
    expect(t.live!.name).toBe('a gnoll')
  })

  it('ignores non-combat chatter before a fight', () => {
    const t = track(log('Braxus', [[1, 'You gain experience!!'], [2, 'You have entered Plane of Fear.']]))
    expect(t.live).toBeNull()
  })

  it('closes when the mob dies', () => {
    const t = track(
      log('Braxus', [
        [1, 'You slash a gnoll for 100 points of damage.'],
        [2, 'You have slain a gnoll!']
      ])
    )
    expect(t.live).toBeNull()
    expect(t.history).toHaveLength(1)
    expect(t.history[0].live).toBe(false)
  })

  it('stays open while an add is still alive', () => {
    const t = track(
      log('Braxus', [
        [1, 'You slash a gnoll for 100 points of damage.'],
        [2, 'You slash a rat for 10 points of damage.'],
        [3, 'You have slain a gnoll!']
      ])
    )
    expect(t.live).not.toBeNull()
  })

  it('closes on silence and names the fight for the mob that took the most', () => {
    const t = track(
      log('Braxus', [
        [1, 'You slash a rat for 10 points of damage.'],
        [2, 'You slash a gnoll for 500 points of damage.']
      ])
    )
    t.tick(new Date('2026-08-11T19:44:30').getTime())
    expect(t.live).toBeNull()
    expect(t.history[0].name).toBe('a gnoll')
  })

  it('counts active seconds as distinct seconds of damage, not wall clock', () => {
    const t = track(
      log('Braxus', [
        [1, 'You slash a gnoll for 10 points of damage.'],
        [1, 'You slash a gnoll for 10 points of damage.'],
        [7, 'You slash a gnoll for 10 points of damage.']
      ])
    )
    // Two distinct seconds of damage across a seven-second fight.
    expect(t.live!.activeSeconds).toBe(2)
  })

  it('zoning ends the fight', () => {
    const t = track(
      log('Braxus', [
        [1, 'You slash a gnoll for 100 points of damage.'],
        [2, 'You have entered Plane of Fear.']
      ])
    )
    expect(t.live).toBeNull()
    expect(t.history).toHaveLength(1)
  })

  it('attributes unnamed non-melee damage to the spell just cast', () => {
    const t = track(
      log('Braxus', [
        [1, 'You slash a gnoll for 10 points of damage.'],
        [2, 'You begin casting Flame of Light.'],
        [3, 'a gnoll was hit by non-melee for 300 points of damage.']
      ])
    )
    const hit = t.live!.events.find((e) => e.amount === 300)!
    expect(hit.attacker!.name).toBe('Braxus')
    expect(hit.skill).toBe('Flame of Light')
  })

  it('leaves non-melee unattributed when no cast is near it', () => {
    const t = track(
      log('Braxus', [
        [1, 'You slash a gnoll for 10 points of damage.'],
        [2, 'a gnoll was hit by non-melee for 300 points of damage.']
      ])
    )
    const hit = t.live!.events.find((e) => e.amount === 300)!
    expect(hit.attacker).toBeUndefined()
  })

  it('flags the damage that follows a crit annotation', () => {
    const t = track(
      log('Braxus', [
        [1, 'You deliver a critical blow! (450)'],
        [1, 'You slash a gnoll for 450 points of damage.']
      ])
    )
    const hit = t.live!.events.find((e) => e.kind === 'melee')!
    expect(hit.critical).toBe(true)
  })
})

/**
 * Two accounts, two camps, one app.
 *
 * The merge rule was written for a boxed trio, where every log holds a copy of
 * every line and the job is to throw duplicates away. Boxing two accounts that
 * are NOT grouped is the opposite situation: the logs share nothing, there are
 * no duplicates, and a rule that routes third-party events through one primary
 * log deletes everything that happened to the other character.
 *
 * Nothing here is grouped. Confucius and Hexzo are in different zones killing
 * different things, and both must come out whole.
 */
describe('two boxes who are not grouped', () => {
  const apart = (primary: string): MergeConfig => ({
    selfBySource: new Map([
      ['Confucius', 'Confucius'],
      ['Hexzo', 'Hexzo']
    ]),
    primarySource: primary,
    petOwners: new Map()
  })

  const CONFUCIUS_LOG: Array<[number, string]> = [
    [1, 'You hit a Gladiator for 500 points of damage.'],
    [2, 'a Gladiator hits YOU for 50 points of damage.'],
    [3, 'You have slain a Gladiator!']
  ]

  const HEXZO_LOG: Array<[number, string]> = [
    [1, 'You hit Diaku Guardian for 1000 points of damage.'],
    [2, 'Diaku Guardian hits YOU for 200 points of damage.'],
    [3, 'You have slain Diaku Guardian!']
  ]

  /** The regression. Whichever log is primary, the other keeps its bruises. */
  for (const primary of ['Confucius', 'Hexzo']) {
    it(`keeps both characters' incoming damage with ${primary} as primary`, () => {
      const merged = mergeEvents(
        [...log('Confucius', CONFUCIUS_LOG), ...log('Hexzo', HEXZO_LOG)],
        apart(primary)
      )
      const taken = merged.filter((e) => e.attacker?.kind === 'mob')
      expect(taken.map((e) => e.attacker?.name).sort()).toEqual(['Diaku Guardian', 'a Gladiator'])
      expect(damageTotal(taken)).toBe(250)
    })
  }

  it('keeps every kill, whoever is primary', () => {
    const merged = mergeEvents(
      [...log('Confucius', CONFUCIUS_LOG), ...log('Hexzo', HEXZO_LOG)],
      apart('Hexzo')
    )
    const slain = merged.filter((e) => e.kind === 'death').map((e) => e.target?.name)
    expect(slain.sort()).toEqual(['Diaku Guardian', 'a Gladiator'])
  })

  it('totals the same either way, because nothing is being deduplicated', () => {
    const events = [...log('Confucius', CONFUCIUS_LOG), ...log('Hexzo', HEXZO_LOG)]
    expect(damageTotal(mergeEvents(events, apart('Confucius')))).toBe(
      damageTotal(mergeEvents(events, apart('Hexzo')))
    )
  })
})

/**
 * Ownership by target, in the grouped case where duplicates DO exist.
 *
 * A hit on Vexthar is written "hits YOU" in Vexthar's log and "hits Vexthar"
 * in the other two. Exactly one of those three may be counted, and it has to
 * be the same one no matter who is primary.
 */
describe('ownership by target', () => {
  const hitOnVexthar: Record<string, Array<[number, string]>> = {
    Vexthar: [[3, 'a gnoll hits YOU for 12 points of damage.']],
    Braxus: [[3, 'a gnoll hits Vexthar for 12 points of damage.']],
    Solene: [[3, 'a gnoll hits Vexthar for 12 points of damage.']]
  }

  const all = (): ParsedEvent[] =>
    Object.entries(hitOnVexthar).flatMap(([self, lines]) => log(self, lines))

  it('counts a hit on a group-mate exactly once', () => {
    expect(damageTotal(mergeEvents(all(), cfg()))).toBe(12)
  })

  it('counts it from the victim, not from whoever happens to be primary', () => {
    for (const primary of TRIO) {
      const merged = mergeEvents(all(), { ...cfg(), primarySource: primary })
      expect(merged).toHaveLength(1)
      expect(merged[0].source).toBe('Vexthar')
    }
  })

  /**
   * Order between the two claims. A heal from one box to another is both "an
   * event another box caused" and "an event that happened to me"; the caster's
   * log must win, or it is counted twice.
   */
  it('gives a heal between boxes to the caster, not the target', () => {
    const merged = mergeEvents(
      [
        ...log('Solene', [[5, 'You have healed Vexthar for 300 points of damage.']]),
        ...log('Vexthar', [[5, 'Solene has healed you for 300 points of damage.']])
      ],
      cfg()
    )
    expect(merged).toHaveLength(1)
    expect(merged[0].source).toBe('Solene')
  })
})
