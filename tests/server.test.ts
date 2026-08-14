import { describe, expect, it } from 'vitest'
import { parseLine, type ParseContext } from '../src/shared/parser/patterns'
import { tokenize } from '../src/shared/parser/tokenize'
import {
  awayMs,
  foldTarget,
  attachConsider,
  isAway,
  RETARGET_GAP_MS,
  type AwayWindow,
  type TargetSighting
} from '../src/shared/presence'
import {
  blessingRows,
  censusRows,
  foldBlessing,
  foldCensus,
  intentOf,
  itemsIn,
  MAX_BLESSING_MS,
  type Blessing,
  type CensusEntry
} from '../src/shared/server'
import { buffRows, SONG_MIN_PULSES, type BuffState } from '../src/shared/buffs'

/**
 * The world outside your group, what is on you, and where you are pointed.
 *
 * Every line quoted below was taken verbatim from a real 48,000-line log, not
 * reconstructed - which is the only reason to trust the regexes at all.
 */

const MIN = 60_000
const HOUR = 60 * MIN
const T0 = 1_760_000_000_000

const ctx: ParseContext = { self: 'Hexzo', petOwners: new Map(), players: new Set() }
const parse = (body: string): ReturnType<typeof parseLine> =>
  parseLine(tokenize(`[Wed Aug 12 16:03:05 2026] ${body}`, 'Hexzo', 0)!, ctx)

describe('server broadcasts', () => {
  it('reads a blessing and its stated remainder', () => {
    const e = parse(
      'A server-wide blessing of [Echo of Experience] has been activated/extended! Remaining duration: 7 hours 32 minutes.'
    )
    expect(e.kind).toBe('blessing')
    expect(e.detail).toBe('Echo of Experience')
    expect(e.amount).toBe(7 * HOUR + 32 * MIN)
  })

  it('copes with a remainder that has no hours', () => {
    const e = parse(
      'A server-wide blessing of [Echo of Luck] has been activated/extended! Remaining duration: 44 minutes.'
    )
    expect(e.amount).toBe(44 * MIN)
  })

  /**
   * The two lines you actually see when you take world buffs. Neither names a
   * blessing or states a duration, which is exactly why the page showed
   * nothing after somebody applied buffs and expected it to fill in - the
   * named broadcast is a different, much rarer message.
   */
  it('reads the incoming-buff warning, which names nothing', () => {
    const e = parse('Your senses are tingling. (Global buffs being applied to you in 7 seconds)')
    expect(e.kind).toBe('blessing')
    expect(e.skill).toBe('incoming')
    expect(e.detail).toBeUndefined()
    expect(e.amount).toBe(7000)
  })

  it('reads the moment world buffs land on you', () => {
    const e = parse('You feel a surge of power. (Global buffs have been applied to you)')
    expect(e.kind).toBe('blessing')
    expect(e.skill).toBe('applied')
    expect(e.detail).toBeUndefined()
  })

  /** The personal pair must never be mistaken for a named blessing. */
  it('keeps the personal lines apart from a named blessing', () => {
    const named = parse(
      'A server-wide blessing of [Echo of Selo] has been activated/extended! Remaining duration: 27 hours 13 minutes.'
    )
    expect(named.skill).toBeUndefined()
    expect(named.detail).toBe('Echo of Selo')
    // 27h13m was observed live, and is why the staleness ceiling was raised.
    expect(named.amount).toBe(27 * HOUR + 13 * MIN)
  })

  it('reads a first login, which names only one class', () => {
    const e = parse('Huma (Paladin) has logged in for the first time.')
    expect(e.kind).toBe('census')
    expect(e.census).toBe('login')
    expect(e.target?.name).toBe('Huma')
    expect(e.detail).toBe('Paladin')
  })

  it('reads a level broadcast, which names the whole trio', () => {
    const e = parse('William (Druid/Bard/Magician) has reached Level 65.')
    expect(e.census).toBe('level')
    expect(e.detail).toBe('Druid/Bard/Magician')
    expect(e.amount).toBe(65)
  })

  it('reads a server first', () => {
    const e = parse('Twerp has become the FIRST Warrior/Shaman/Beastlord.')
    expect(e.census).toBe('first')
    expect(e.target?.name).toBe('Twerp')
    expect(e.detail).toBe('Warrior/Shaman/Beastlord')
  })
})

describe('blessings', () => {
  const at = (name: string, seenAt: number, ms: number): Blessing => ({
    name,
    seenAt,
    statedMs: ms,
    endsAt: seenAt + ms
  })

  /** "activated/extended" is one message for two events, so later always wins. */
  it('lets a later sighting replace an earlier one', () => {
    let list = foldBlessing([], 'Echo of Selo', T0, 2 * HOUR)
    list = foldBlessing(list, 'Echo of Selo', T0 + HOUR, 4 * HOUR)
    expect(list).toHaveLength(1)
    expect(list[0].endsAt).toBe(T0 + HOUR + 4 * HOUR)
  })

  it('keeps different blessings apart', () => {
    let list = foldBlessing([], 'Echo of Selo', T0, HOUR)
    list = foldBlessing(list, 'Echo of Luck', T0, HOUR)
    expect(list.map((b) => b.name)).toEqual(['Echo of Luck', 'Echo of Selo'])
  })

  it('counts down and sorts the running ones first', () => {
    const rows = blessingRows(
      [at('Expired', T0 - 3 * HOUR, HOUR), at('Short', T0, HOUR), at('Long', T0, 5 * HOUR)],
      T0 + 30 * MIN
    )
    expect(rows.map((r) => r.name)).toEqual(['Long', 'Short', 'Expired'])
    expect(rows[0].active).toBe(true)
    expect(rows[2].active).toBe(false)
    expect(rows[1].remainingMs).toBe(30 * MIN)
  })

  /**
   * There is no expiry message, so an ancient sighting says nothing about now.
   * Measured against the constant rather than a number, because the first
   * guess at it (26 hours) was already wrong on real data - a remainder of
   * 27h13m turned up in a live log.
   */
  it('marks a sighting older than any possible blessing as stale', () => {
    const fresh = blessingRows([at('Recent', T0, HOUR)], T0 + MAX_BLESSING_MS - HOUR)
    expect(fresh[0].stale).toBe(false)

    const old = blessingRows([at('Old', T0, HOUR)], T0 + MAX_BLESSING_MS + HOUR)
    expect(old[0].stale).toBe(true)
  })
})

describe('census', () => {
  /**
   * A first login names one class; a level names the trio. The trio is strictly
   * better information about the same player and must win whichever arrives
   * second.
   */
  it('upgrades a single class to the full trio', () => {
    const into: Record<string, CensusEntry> = {}
    foldCensus(into, 'William', 'Druid', T0)
    foldCensus(into, 'William', 'Druid/Bard/Magician', T0 + MIN, { level: 65 })
    expect(into.William.classes).toBe('Druid/Bard/Magician')
    expect(into.William.level).toBe(65)
  })

  it('never downgrades a trio back to one class', () => {
    const into: Record<string, CensusEntry> = {}
    foldCensus(into, 'William', 'Druid/Bard/Magician', T0)
    foldCensus(into, 'William', 'Druid', T0 + MIN)
    expect(into.William.classes).toBe('Druid/Bard/Magician')
  })

  it('keeps the highest level seen', () => {
    const into: Record<string, CensusEntry> = {}
    foldCensus(into, 'Aryn', 'Warrior/Paladin/Monk', T0, { level: 60 })
    foldCensus(into, 'Aryn', 'Warrior/Paladin/Monk', T0 + MIN, { level: 65 })
    foldCensus(into, 'Aryn', 'Warrior/Paladin/Monk', T0 + 2 * MIN, { level: 62 })
    expect(into.Aryn.level).toBe(65)
  })

  it('counts trios and credits the server first', () => {
    const into: Record<string, CensusEntry> = {}
    foldCensus(into, 'Twerp', 'Warrior/Shaman/Beastlord', T0, { serverFirst: true })
    foldCensus(into, 'Other', 'Warrior/Shaman/Beastlord', T0)
    foldCensus(into, 'Solo', 'Paladin', T0)
    const rows = censusRows(into)
    expect(rows.trios).toHaveLength(1)
    expect(rows.trios[0]).toMatchObject({ trio: 'Warrior/Shaman/Beastlord', count: 2, firstBy: 'Twerp' })
  })
})

describe('trade talk', () => {
  it('reads the channel off the line', () => {
    const e = parse("Rump auctions, 'WTS Hammer of Holy Vengeance (Legendary) 110k'")
    expect(e.kind).toBe('chat')
    expect(e.channel).toBe('auction')
    expect(e.attacker?.name).toBe('Rump')
    expect(e.detail).toBe('WTS Hammer of Holy Vengeance (Legendary) 110k')
  })

  it('reads out-of-character as ooc', () => {
    const e = parse("Someone says out of character, 'WTB a thing'")
    expect(e.channel).toBe('ooc')
  })

  it('picks out intent', () => {
    expect(intentOf('WTS Hammer of Holy Vengeance (Legendary) 110k')).toBe('sell')
    expect(intentOf("WTB Vyzh'dra's Render of Souls, pst")).toBe('buy')
    expect(intentOf('WTT my thing for your thing')).toBe('trade')
  })

  /** An advert is not an offer, and guessing would put a catchphrase in a price list. */
  it('refuses to guess intent from a line that states none', () => {
    expect(intentOf('Shop Smart, Shop Baalmart!')).toBeNull()
  })

  it('lifts tiered item names out of prose', () => {
    expect(itemsIn('WTS Hammer of Holy Vengeance (Legendary) 110k')).toEqual([
      'Hammer of Holy Vengeance (Legendary)'
    ])
  })

  it('finds nothing when nothing is tiered', () => {
    expect(itemsIn("WTB Vyzh'dra's Render of Souls, pst")).toEqual([])
  })
})

describe('targets and considers', () => {
  it('reads a target change', () => {
    const e = parse('Targeted (NPC): Diaku Guardian')
    expect(e.kind).toBe('target')
    expect(e.detail).toBe('NPC')
    expect(e.target?.name).toBe('Diaku Guardian')
  })

  /** A corpse is the same bestiary entry as the thing that left it. */
  it('strips the possessive off a corpse', () => {
    const e = parse("Targeted (Corpse): Diaku Guardian's corpse")
    expect(e.target?.name).toBe('Diaku Guardian')
  })

  it('reads a consider, keeping both clauses apart', () => {
    const e = parse('Noirsol regards you indifferently -- You could probably win this fight.')
    expect(e.kind).toBe('con')
    expect(e.target?.name).toBe('Noirsol')
    expect(e.skill).toBe('regards you indifferently')
    expect(e.detail).toBe('You could probably win this fight')
  })

  const sighting = (name: string, at: number): TargetSighting => ({
    name,
    kind: 'NPC',
    at,
    assessment: null,
    attitude: null
  })

  /** Hundreds of re-targets a day; a list showing each would be useless. */
  it('treats a quick re-target of the same thing as one sighting', () => {
    let list = foldTarget([], sighting('Diaku Guardian', T0), 40)
    list = foldTarget(list, sighting('Diaku Guardian', T0 + 5000), 40)
    expect(list).toHaveLength(1)
    expect(list[0].at).toBe(T0 + 5000)
  })

  it('records the same thing again after a long gap', () => {
    let list = foldTarget([], sighting('Diaku Guardian', T0), 40)
    list = foldTarget(list, sighting('Diaku Guardian', T0 + RETARGET_GAP_MS + 1), 40)
    expect(list).toHaveLength(2)
  })

  it('attaches a consider to the target it describes', () => {
    const list = foldTarget([], sighting('Noirsol', T0), 40)
    attachConsider(list, 'Noirsol', 'regards you indifferently', 'You could probably win this fight', T0 + 1000)
    expect(list[0].assessment).toBe('You could probably win this fight')
  })

  it('ignores a consider about something you are no longer on', () => {
    const list = foldTarget([], sighting('Noirsol', T0), 40)
    attachConsider(list, 'Somebody Else', 'scowls at you, ready to attack', 'formidable', T0 + 1000)
    expect(list[0].assessment).toBeNull()
  })
})

describe('away from keyboard', () => {
  it('reads both halves of the afk pair', () => {
    expect(parse('You are now AFK.')).toMatchObject({ kind: 'afk', away: true, detail: 'afk' })
    expect(parse('You are no longer AFK.')).toMatchObject({ kind: 'afk', away: false, detail: 'afk' })
  })

  it('reads idle separately, since it is a weaker signal', () => {
    const e = parse('You are now idle. Updates will be sent to you less frequently.')
    expect(e).toMatchObject({ kind: 'afk', away: true, detail: 'idle' })
  })

  const w = (from: number, to: number | null, kind: AwayWindow['kind'] = 'afk'): AwayWindow => ({
    from,
    to,
    kind
  })

  it('totals closed windows', () => {
    expect(awayMs([w(T0, T0 + 10 * MIN), w(T0 + HOUR, T0 + HOUR + 5 * MIN)], T0)).toBe(15 * MIN)
  })

  it('counts an open window up to now', () => {
    expect(awayMs([w(T0, null)], T0 + 3 * MIN)).toBe(3 * MIN)
  })

  it('can total one kind at a time', () => {
    const list = [w(T0, T0 + 10 * MIN, 'afk'), w(T0, T0 + 30 * MIN, 'idle')]
    expect(awayMs(list, T0, 'afk')).toBe(10 * MIN)
    expect(awayMs(list, T0, 'idle')).toBe(30 * MIN)
  })

  it('reports the open window, if there is one', () => {
    expect(isAway([w(T0, T0 + MIN)])).toBeNull()
    expect(isAway([w(T0, null)])?.from).toBe(T0)
  })
})

describe('buff board', () => {
  const buff = (over: Partial<BuffState> = {}): BuffState => ({
    name: 'Warsong of Zek',
    character: 'Hexzo',
    lastOn: T0,
    lastOff: 0,
    pulses: 1,
    ...over
  })

  it('shows what is up and hides what faded', () => {
    const rows = buffRows(
      [buff({ name: 'Up' }), buff({ name: 'Gone', lastOn: T0, lastOff: T0 + MIN })],
      T0 + 2 * MIN
    )
    expect(rows.map((r) => r.name)).toEqual(['Up'])
  })

  it('calls something re-applied constantly a song', () => {
    const rows = buffRows([buff({ pulses: SONG_MIN_PULSES })], T0)
    expect(rows[0].song).toBe(true)
  })

  it('does not call a twice-cast buff a song', () => {
    const rows = buffRows([buff({ pulses: 2 })], T0)
    expect(rows[0].song).toBe(false)
  })

  /**
   * A song that stopped pulsing is the only thing on this board worth acting
   * on, so it floats to the top - but it is "quiet", not "gone": its fade
   * message may simply be one of the ambiguous ones that was thrown away.
   */
  it('floats a song that has gone quiet to the top', () => {
    const rows = buffRows(
      [
        buff({ name: 'Fresh', pulses: SONG_MIN_PULSES, lastOn: T0 + 5 * MIN }),
        buff({ name: 'Quiet', pulses: SONG_MIN_PULSES, lastOn: T0 })
      ],
      T0 + 5 * MIN
    )
    expect(rows[0].name).toBe('Quiet')
    expect(rows[0].quiet).toBe(true)
    expect(rows[1].quiet).toBe(false)
  })

  it('never calls a plain buff quiet, however long it has been up', () => {
    const rows = buffRows([buff({ pulses: 1, lastOn: T0 })], T0 + HOUR)
    expect(rows[0].quiet).toBe(false)
  })
})
