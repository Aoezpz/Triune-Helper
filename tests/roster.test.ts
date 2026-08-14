import { describe, expect, it } from 'vitest'
import { ownsEvent, type MergeConfig } from '../src/shared/parser/merge'
import { parseLine, type ParseContext } from '../src/shared/parser/patterns'
import { tokenize } from '../src/shared/parser/tokenize'
import type { ParsedEvent } from '../src/shared/parser/types'
import {
  applyGroupEvent,
  CLASS_COLOR,
  CLASS_NAMES,
  classLine,
  partyOf,
  type Identity
} from '../src/shared/roster'

/**
 * Group membership, and the identities it unlocks.
 *
 * The strings under test are not reconstructions - they were read out of the
 * client's own `eqstr_us.txt` (ids 1399, 12001-12005, 12283, 12287). If one of
 * these tests ever fails against a real log, the string table changed, not the
 * memory of somebody who used to play EverQuest.
 */

function ctx(self = 'Hexzo', players = new Set<string>([self])): ParseContext {
  return { self, petOwners: new Map(), players }
}

function parse(body: string, c: ParseContext): ParsedEvent {
  const line = tokenize(`[Wed Aug 12 03:12:50 2026] ${body}`, c.self, 0)
  expect(line, `tokenize failed for: ${body}`).not.toBeNull()
  return parseLine(line!, c)
}

describe('group messages', () => {
  it('reads a join and names who joined', () => {
    const ev = parse('Braxus has joined the group.', ctx())
    expect(ev.kind).toBe('group')
    expect(ev.group).toBe('join')
    expect(ev.target).toEqual({ name: 'Braxus', kind: 'player' })
  })

  it('reads a leave', () => {
    const ev = parse('Braxus has left the group.', ctx())
    expect(ev.group).toBe('leave')
    expect(ev.target?.name).toBe('Braxus')
  })

  it('treats being removed by the leader as a leave', () => {
    const ev = parse('You remove Vexthar from the party.', ctx())
    expect(ev.group).toBe('leave')
    expect(ev.target?.name).toBe('Vexthar')
  })

  it('counts the person you accepted an invite from as a group-mate', () => {
    // This is the only line that names the inviter, and without it the invited
    // character's log knows it is in a group but not whose.
    const ev = parse('You notify Hexzo that you agree to join the group.', ctx('Braxus'))
    expect(ev.group).toBe('join')
    expect(ev.target?.name).toBe('Hexzo')
  })

  it('reads the four impersonal forms', () => {
    expect(parse('You have formed the group.', ctx()).group).toBe('form')
    expect(parse('You have joined the group.', ctx()).group).toBe('join')
    expect(parse('Your group has been disbanded.', ctx()).group).toBe('disband')
    expect(parse('You have been removed from the group.', ctx()).group).toBe('disband')
  })

  /**
   * The recovery path. Join lines only help if the app was running - or if the
   * join is still inside the history scan - when the group formed. Group chat
   * proves membership every time somebody speaks, which is the only signal that
   * keeps working hours into a session.
   */
  it('takes group chat as proof of membership without swallowing the line', () => {
    const c = ctx()
    const ev = parse("Braxus tells the group, 'pulling'", c)
    expect(ev.group).toBe('join')
    expect(ev.target?.name).toBe('Braxus')
    // Still a chat line, so the stream shows it as written.
    expect(ev.kind).toBe('chat')
    expect(c.players?.has('Braxus')).toBe(true)
  })

  it('does not mistake a guild join for a group join', () => {
    // A real line from a real log, and the reason the rule anchors on
    // "the group" rather than on "has joined".
    expect(parse('Erlick has joined your guild.', ctx()).kind).not.toBe('group')
  })

  /**
   * The side effect that matters more than the message. `actor()` calls every
   * unrecognised name a mob, so until something proves otherwise a group-mate's
   * damage is counted as the enemy's.
   */
  it('teaches the parser that the named character is a player', () => {
    const c = ctx()
    expect(c.players?.has('Braxus')).toBe(false)
    parse('Braxus has joined the group.', c)
    expect(c.players?.has('Braxus')).toBe(true)

    const swing = parse('Braxus slashes Zelrin Morlock for 412 points of damage.', c)
    expect(swing.attacker).toEqual({ name: 'Braxus', kind: 'player' })
  })
})

describe('applyGroupEvent', () => {
  const fold = (self: string, bodies: string[]): string[] => {
    const c = ctx(self)
    const members = new Set<string>()
    for (const body of bodies) {
      const ev = parse(body, c)
      if (ev.group !== undefined) applyGroupEvent(members, ev, self)
    }
    return [...members].sort()
  }

  it('builds a roster from joins', () => {
    expect(fold('Hexzo', ['Braxus has joined the group.', 'Vexthar has joined the group.'])).toEqual([
      'Braxus',
      'Vexthar'
    ])
  })

  it('never adds the log owner to their own roster', () => {
    // The client does not announce you to your own group, so a self-named join
    // is "a group now exists", not "you are in it twice".
    expect(fold('Hexzo', ['You have joined the group.', 'Braxus has joined the group.'])).toEqual([
      'Braxus'
    ])
  })

  it('removes someone who left', () => {
    expect(
      fold('Hexzo', [
        'Braxus has joined the group.',
        'Vexthar has joined the group.',
        'Braxus has left the group.'
      ])
    ).toEqual(['Vexthar'])
  })

  it('empties the roster on form and on disband', () => {
    expect(fold('Hexzo', ['Braxus has joined the group.', 'You have formed the group.'])).toEqual([])
    expect(
      fold('Hexzo', ['Braxus has joined the group.', 'Your group has been disbanded.'])
    ).toEqual([])
  })

  it('recovers a member whose join line was never seen, from group chat alone', () => {
    expect(fold('Hexzo', ["Erlick tells the group, 'ready'"])).toEqual(['Erlick'])
  })

  it('applies in order, so an old group does not survive a new one', () => {
    expect(
      fold('Hexzo', [
        'Braxus has joined the group.',
        'Your group has been disbanded.',
        'Erlick has joined the group.'
      ])
    ).toEqual(['Erlick'])
  })
})

describe('group ownership across a trio', () => {
  /**
   * Three boxes in one group each write their own copy of the party's
   * messages, and each copy describes a DIFFERENT group - its own. Merging must
   * therefore keep all three rather than crediting them to the primary log, or
   * two of the three characters would appear to be in no group at all.
   */
  const cfg: MergeConfig = {
    selfBySource: new Map([
      ['Hexzo', 'Hexzo'],
      ['Braxus', 'Braxus'],
      ['Vexthar', 'Vexthar']
    ]),
    primarySource: 'Hexzo',
    petOwners: new Map()
  }

  it('keeps a group event in every log that wrote one', () => {
    for (const self of ['Hexzo', 'Braxus', 'Vexthar']) {
      const ev = parse('Erlick has joined the group.', ctx(self))
      expect(ownsEvent(ev, cfg), `${self} should own its own group line`).toBe(true)
    }
  })
})

describe('display helpers', () => {
  const id = (over: Partial<Identity> = {}): Identity => ({
    name: 'Hexzo',
    id: 180750,
    level: 65,
    race: 'Human',
    classes: ['War', 'Rng', 'Brd'],
    guild: 'Lunar Asylum',
    score: 747,
    trioRank: 1,
    trioOf: 18,
    overallRank: 5,
    fetchedAt: 0,
    found: true,
    ...over
  })

  it('renders the class line the way the site does', () => {
    expect(classLine(id())).toBe('War/Rng/Brd')
  })

  it('says nothing rather than something wrong when identity is unknown', () => {
    expect(classLine(undefined)).toBeNull()
    expect(classLine(id({ classes: [] }))).toBeNull()
  })

  it('names and colours every class PTDex can print', () => {
    // The sixteen abbreviations were read off the site's own search results,
    // including SK - which is two letters where every other class is three,
    // and would have been "Shd" in any list written from memory.
    const all = ['War', 'Clr', 'Pal', 'Rng', 'SK', 'Dru', 'Mnk', 'Brd', 'Rog', 'Shm', 'Nec', 'Wiz', 'Mag', 'Enc', 'Bst', 'Ber']
    for (const c of all) {
      expect(CLASS_NAMES[c], `${c} has no full name`).toBeTruthy()
      expect(CLASS_COLOR[c], `${c} has no colour`).toMatch(/^#[0-9a-f]{6}$/)
    }
    expect(Object.keys(CLASS_COLOR)).toHaveLength(all.length)
  })

  it('gives every class its own colour', () => {
    // A duplicate would silently make two classes indistinguishable, which is
    // exactly the thing per-class colours exist to prevent.
    const hexes = Object.values(CLASS_COLOR)
    expect(new Set(hexes).size).toBe(hexes.length)
  })

})

/**
 * Who is in the party.
 *
 * The rule that matters: reading somebody's log is not evidence that they are
 * grouped with you. People box alts at different camps and run a second
 * account for a mule, and the app claiming those are a party is a lie about
 * the only thing this strip exists to say.
 */
describe('partyOf', () => {
  const state = (groups: Record<string, string[]>): Parameters<typeof partyOf>[0] => ({
    known: {},
    busy: false,
    groups
  })

  it('joins the per-log rosters and puts the focus character first', () => {
    // Each box sees the others join, but never itself - so no single log holds
    // the whole party.
    const party = partyOf(
      state({ Hexzo: ['Braxus', 'Erlick'], Braxus: ['Hexzo', 'Erlick'] }),
      ['Hexzo', 'Braxus'],
      'Hexzo'
    )
    expect(party.members).toEqual(['Hexzo', 'Braxus', 'Erlick'])
    expect(party.alsoOnline).toEqual([])
  })

  /** The bug this function exists to fix. */
  it('does not group two boxed characters merely because both logs are open', () => {
    const party = partyOf(state({ Confucius: [], Hexzo: [] }), ['Confucius', 'Hexzo'], 'Confucius')
    expect(party.members).toEqual(['Confucius'])
    expect(party.alsoOnline).toEqual(['Hexzo'])
  })

  it('keeps a real group-mate while leaving an ungrouped box out of it', () => {
    const party = partyOf(
      state({ Hexzo: ['Incredibaal'], Confucius: [] }),
      ['Confucius', 'Hexzo'],
      'Hexzo'
    )
    expect(party.members).toEqual(['Hexzo', 'Incredibaal'])
    expect(party.alsoOnline).toEqual(['Confucius'])
  })

  it('answers about whoever you are looking at', () => {
    const groups = state({ Hexzo: ['Incredibaal'], Confucius: [] })
    expect(partyOf(groups, ['Confucius', 'Hexzo'], 'Confucius').members).toEqual(['Confucius'])
    expect(partyOf(groups, ['Confucius', 'Hexzo'], 'Hexzo').members).toEqual([
      'Hexzo',
      'Incredibaal'
    ])
  })

  /**
   * A log started mid-session never saw the joins the others caught. Reading
   * the graph in both directions is what rescues it: being named by somebody
   * else's log is the same fact as naming them in yours.
   */
  it('accepts membership reported from the other end', () => {
    const party = partyOf(state({ Braxus: ['Hexzo'] }), ['Hexzo', 'Braxus'], 'Hexzo')
    expect(party.members).toEqual(['Hexzo', 'Braxus'])
  })

  it('follows the group through a box that saw more of it than you did', () => {
    const party = partyOf(state({ Braxus: ['Hexzo', 'Erlick'] }), ['Hexzo', 'Braxus'], 'Hexzo')
    expect(party.members).toEqual(['Hexzo', 'Braxus', 'Erlick'])
  })

  it('falls back to the first character when the focus is not being tailed', () => {
    const party = partyOf(state({}), ['Confucius', 'Hexzo'], 'SomeoneElse')
    expect(party.focus).toBe('Confucius')
    expect(party.members).toEqual(['Confucius'])
  })

  it('says nothing at all when no logs are being read', () => {
    expect(partyOf(state({}), [])).toEqual({ members: [], alsoOnline: [], focus: null })
  })

  it('is a party of one when you are soloing', () => {
    const party = partyOf(state({ Hexzo: [] }), ['Hexzo'], 'Hexzo')
    expect(party.members).toEqual(['Hexzo'])
    expect(party.alsoOnline).toEqual([])
  })
})
