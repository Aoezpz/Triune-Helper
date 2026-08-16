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
  groupCallOf,
  foldCensus,
  intentOf,
  itemsIn,
  GROUPING_WINDOW_MS,
  MARKET_WINDOW_MS,
  recent,
  MAX_BLESSING_MS,
  type Blessing,
  type CensusEntry
} from '../src/shared/server'
import {
  boardIsCurrent,
  BOARD_STALE_MS,
  buffRows,
  SONG_MIN_PULSES,
  type BuffState
} from '../src/shared/buffs'

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


/**
 * Reading order is not event order.
 *
 * On attach every log is scanned for standing facts, and the logs are scanned
 * in whatever order the folder listed them. A character who was offline this
 * morning still holds an older broadcast near the end of their file, so a stale
 * copy can arrive AFTER a fresh one. Taken from a real failure: blessings
 * announced at 09:00 today were being overwritten by a copy from two days
 * earlier sitting in a camped alt's log, and the page showed four expired rows
 * while the buffs were visibly running in game.
 */
describe('folding blessings out of several logs', () => {
  const TUES = Date.parse('2026-08-12T17:34:38')
  const TODAY = Date.parse('2026-08-14T09:00:26')

  it('does not let an older sighting overwrite a newer one', () => {
    let rows = foldBlessing([], 'Echo of Selo', TODAY, 27 * 3600_000)
    // The camped alt's log is scanned second and holds Tuesday's copy.
    rows = foldBlessing(rows, 'Echo of Selo', TUES, 27 * 3600_000)

    expect(rows).toHaveLength(1)
    expect(rows[0].seenAt).toBe(TODAY)
  })

  it('still takes a newer sighting whichever order it arrives in', () => {
    let rows = foldBlessing([], 'Echo of Selo', TUES, 27 * 3600_000)
    rows = foldBlessing(rows, 'Echo of Selo', TODAY, 27 * 3600_000)
    expect(rows[0].seenAt).toBe(TODAY)
  })

  /** Every online log carries the same broadcast; folding it twice is a no-op. */
  it('is idempotent for the same broadcast seen in two logs', () => {
    let rows = foldBlessing([], 'Echo of Power', TODAY, 19 * 3600_000)
    rows = foldBlessing(rows, 'Echo of Power', TODAY, 19 * 3600_000)
    expect(rows).toHaveLength(1)
    expect(rows[0].endsAt).toBe(TODAY + 19 * 3600_000)
  })

  it('keeps blessings apart by name', () => {
    let rows = foldBlessing([], 'Echo of Selo', TODAY, 27 * 3600_000)
    rows = foldBlessing(rows, 'Echo of Luck', TODAY, 19 * 3600_000)
    expect(rows.map((r) => r.name)).toEqual(['Echo of Luck', 'Echo of Selo'])
  })
})

/**
 * Intent, and refusing to guess it.
 *
 * A wrong tag is worse than no tag, because "WTS" reads as a fact the speaker
 * stated. All of these are real lines off the server.
 */
describe('reading trade intent', () => {
  it('trusts the shorthand wherever it appears', () => {
    expect(intentOf('WTS Bracer of Precision (Legendary)')).toBe('sell')
    expect(intentOf('WTB Staff of Elemental Water')).toBe('buy')
    expect(intentOf('WTT my bracer for yours')).toBe('trade')
  })

  /**
   * The marker inverts inside a question, because you are asking about the
   * other side of the trade rather than announcing your own.
   *
   * This started as "filed under WTS", was over-corrected to "no tag at all",
   * and is now what the channel actually means. Twice this block has held my
   * caution written down as a requirement; both times a real line settled it.
   */
  it('reads a question about a sale as somebody wanting to buy', () => {
    expect(intentOf('any orb of masterys out there for sale?')).toBe('buy')
    expect(intentOf('anything good for sale?')).toBe('buy')
  })

  it('reads a question about buyers as somebody wanting to sell', () => {
    expect(intentOf('anyone buying gems?')).toBe('sell')
  })

  it('reads the same wording as a statement the plain way round', () => {
    expect(intentOf('selling my bracer 40k')).toBe('sell')
    expect(intentOf('buying gems, 100pp each')).toBe('buy')
  })

  /** A question with the shorthand in it is still unambiguous. */
  it('still trusts the shorthand inside a question', () => {
    expect(intentOf('WTB Seru aug with shissar bane damage?')).toBe('buy')
  })

  it('reads plain prose when it is not a question', () => {
    expect(intentOf('selling my bracer 40k')).toBe('sell')
    expect(intentOf('looking to buy a Seru aug')).toBe('buy')
  })

  /** An advert is not an offer, and never was. */
  it('gives no intent to a line that states none', () => {
    expect(intentOf('Shop Smart, Shop Baalmart!')).toBeNull()
    expect(intentOf('its not worth it to leggo those Froglok Egg Capsule (Legendary)')).toBeNull()
  })
})

/**
 * Phrasing that carries direction, including inside a question.
 *
 * "anyone want a bracer?" and "anyone have a bracer?" are both questions and
 * mean opposite things. Blanket-refusing to read questions - which is what
 * 0.1.3 did - threw both away. Every line below is real traffic off the server.
 */
describe('reading intent from how people actually talk', () => {
  it('reads offering it out, even as a question', () => {
    expect(intentOf('any one want Monsoon, Sword of the Swiftwind (Enchanted)?')).toBe('sell')
    expect(intentOf('any need a Serpentine Bracer (Legendary)?')).toBe('sell')
    expect(intentOf('anyone need a Guise of the Deceiver?')).toBe('sell')
    expect(intentOf('who wants a Hopebringer')).toBe('sell')
  })

  it('reads asking for it, even as a question', () => {
    expect(intentOf('does anyone have a Staff of Elemental Water?')).toBe('buy')
    expect(intentOf('anyone have an orb of mastery')).toBe('buy')
    expect(intentOf('Great Cloak of Shadows (Enchanted) still available?')).toBe('buy')
    expect(intentOf('looking for a Seru aug')).toBe('buy')
    expect(intentOf('ISO Symbol of Ancient Summoning')).toBe('buy')
  })

  it('reads a giveaway as its own thing', () => {
    expect(intentOf('Free to a good home: Shadow Footpads, Grimoire of Enchantment')).toBe('give')
    expect(intentOf('giving away my old bracers')).toBe('give')
    expect(intentOf('Froglok Egg Capsule for free')).toBe('give')
  })

  /**
   * "anyone have X available" is somebody asking, not advertising - so wanting
   * has to be tested before offering rather than after.
   */
  it('does not mistake asking for advertising', () => {
    expect(intentOf('anyone have a Hopebringer available?')).toBe('buy')
  })

  /**
   * A line with no marker of any kind still gets nothing. The question mark
   * flips a marker that is there; it does not invent one.
   */
  it('still refuses a line that states no direction at all', () => {
    expect(intentOf('its not worth it to leggo those Froglok Egg Capsule (Legendary)')).toBeNull()
    expect(intentOf('anyone know where DN is?')).toBeNull()
    expect(intentOf('Shop Smart, Shop Baalmart!')).toBeNull()
  })

  it('still lets the shorthand win over everything', () => {
    expect(intentOf('WTS anyone have a spare bracer')).toBe('sell')
    expect(intentOf('WTB free to a good home items')).toBe('buy')
  })
})

/**
 * Group calls, which are not sales.
 *
 * "flagging group, anyone want to come, got more spots" was tagged WTS and put
 * in the market, because it contains "anyone want". Grouping shouts share the
 * channel with trade and nothing else - they are about people, not goods.
 */
describe('spotting a group call', () => {
  it('reads somebody with a group who wants bodies', () => {
    expect(groupCallOf('flagging group, anyone want to come, got more spots')).toBe('forming')
    expect(groupCallOf('anyone want to do DN')).toBe('forming')
    expect(groupCallOf('anyone want to go kill Vindicator')).toBe('forming')
    expect(groupCallOf('LFM 2 more for HoH')).toBe('forming')
    expect(groupCallOf('need 2 more for a Seru run')).toBe('forming')
  })

  it('reads somebody looking to join', () => {
    expect(groupCallOf('LFG anything')).toBe('seeking')
    expect(groupCallOf('anyone doing Progression for Kunark?')).toBe('seeking')
    expect(groupCallOf('anyone running DN tonight')).toBe('seeking')
  })

  /** The market must not lose lines that really are trade. */
  it('is not a group call when it is a sale', () => {
    expect(groupCallOf('WTS Bracer of Precision (Legendary)')).toBe(false)
    expect(groupCallOf('WTB Staff of Elemental Water')).toBe(false)
    // A port is a service somebody sells, not a group forming.
    expect(groupCallOf('WTS ports to DN, anyone want to go')).toBe(false)
  })

  /** Chatter about a zone is not a group call. */
  it('refuses lines that merely mention content', () => {
    expect(groupCallOf('DN is rough without a cleric')).toBe(false)
    expect(groupCallOf('grats on the clear!')).toBe(false)
  })

  /**
   * The corresponding half: a grouping shout must not read as an item offer.
   * "anyone want a bracer" still does, because there is no verb after "want".
   */
  it('keeps "anyone want to X" out of the market', () => {
    expect(intentOf('flagging group, anyone want to come, got more spots')).toBeNull()
    expect(intentOf('anyone want to do DN')).toBeNull()
    expect(intentOf('any one want Monsoon, Sword of the Swiftwind (Enchanted)?')).toBe('sell')
  })
})

/**
 * "free" on its own, which is how people actually type it.
 *
 * Both of these are real shouts that were filed as untagged chatter, because
 * the rule only knew set phrases like "free to a good home".
 */
describe('giveaways written the lazy way', () => {
  it('reads a bare "free" as a giveaway', () => {
    expect(intentOf('free Mind Worm hide mantle (Legendary), Attuned Spire Shard (Legendary)')).toBe('give')
    expect(intentOf('2 more free item, Symbol of the Plaguebringer (Legendary)')).toBe('give')
    expect(intentOf('free stuff at the bazaar campfire')).toBe('give')
  })

  it('still reads the tidy phrasings', () => {
    expect(intentOf('Free to a good home: Shadow Footpads')).toBe('give')
    expect(intentOf('giving away my old bracers')).toBe('give')
    expect(intentOf('Froglok Egg Capsule for free')).toBe('give')
  })

  /** The one common phrase where "free" means nothing at all. */
  it('does not read "feel free" as a giveaway', () => {
    expect(intentOf('feel free to send me a tell')).toBeNull()
    expect(intentOf('WTS bracer, feel free to haggle')).toBe('sell')
  })

  /** A zone name is not an offer. \b will not split Freeport. */
  it('does not trip on Freeport', () => {
    expect(intentOf('porting to Freeport in 5')).toBeNull()
  })

  /** An invitation is a group call, and is caught before intent is read. */
  it('treats "anyone free for X" as grouping, not a giveaway', () => {
    expect(groupCallOf('anyone free for a DN run?')).toBe('forming')
  })
})

/**
 * A feed, not an archive.
 *
 * Everything is kept on disk; these windows govern what is worth showing. An
 * item advertised two days ago has been sold or forgotten, and a group does not
 * survive being formed - nobody is still filling spots they shouted about
 * ninety minutes ago.
 */
describe('how long a shout stays on the page', () => {
  const row = (at: number): { at: number } => ({ at })
  const NOW = 1_700_000_000_000
  const HOURS = 3600_000

  it('keeps trade for six hours and drops it after', () => {
    const rows = [row(NOW - 1 * HOURS), row(NOW - 5 * HOURS), row(NOW - 7 * HOURS)]
    expect(recent(rows, NOW, MARKET_WINDOW_MS)).toHaveLength(2)
  })

  it('drops grouping sooner, because a group does not last', () => {
    const rows = [row(NOW - 30 * 60_000), row(NOW - 3 * HOURS)]
    expect(recent(rows, NOW, GROUPING_WINDOW_MS)).toHaveLength(1)
    // The same pair would both survive the market window.
    expect(recent(rows, NOW, MARKET_WINDOW_MS)).toHaveLength(2)
  })

  it('returns newest first', () => {
    const rows = [row(NOW - 3 * HOURS), row(NOW - 1 * HOURS), row(NOW - 2 * HOURS)]
    expect(recent(rows, NOW, MARKET_WINDOW_MS).map((r) => r.at)).toEqual([
      NOW - 1 * HOURS,
      NOW - 2 * HOURS,
      NOW - 3 * HOURS
    ])
  })
})

/** Asking whether something is free is not offering it. */
describe('a bare "free" inside a question', () => {
  it('reads as somebody hoping to receive, not giving', () => {
    expect(intentOf('and the helberd if thats free too?')).toBe('buy')
    expect(intentOf('is the mantle still free?')).toBe('buy')
  })

  it('still reads a stated giveaway as a giveaway', () => {
    expect(intentOf('free Mind Worm hide mantle (Legendary)')).toBe('give')
  })

  /** A set phrase says it outright, so the question mark does not flip it. */
  it('keeps "free to a good home" a giveaway even when asked', () => {
    expect(intentOf('free to a good home, anyone want these?')).toBe('give')
  })
})

/**
 * Flag runs, which are most of the grouping traffic on this server.
 *
 * All three of these were tagged WTS and filed in the market, because "anyone
 * needs" and "anyone wants" read as somebody offering goods.
 */
describe('flag runs', () => {
  it('reads a content run with an invitation as a group forming', () => {
    expect(groupCallOf('doing talendor if anyone needs flag')).toBe('forming')
    expect(groupCallOf('on to velious flags if anyone wants in')).toBe('forming')
    expect(groupCallOf('doing vox if anyone needs flag')).toBe('forming')
    expect(groupCallOf('running DN if anyone wants to come')).toBe('forming')
  })

  /**
   * Both halves are needed. An invitation tacked onto a giveaway is still a
   * giveaway, and belongs in the market.
   */
  it('needs a content verb, not just an invitation', () => {
    expect(groupCallOf('free to a good home if anyone needs them')).toBe(false)
    expect(intentOf('free to a good home if anyone needs them')).toBe('give')
  })

  it('leaves those lines out of the market entirely', () => {
    expect(intentOf('doing talendor if anyone needs flag')).toBe('sell')
    // ...but groupCallOf is asked first, so the market never sees it.
    expect(groupCallOf('doing talendor if anyone needs flag')).not.toBe(false)
  })
})

/**
 * People address a class, not the room.
 *
 * "any war want? Legionnaire Scale Helm (Legendary)" is a warrior-specific
 * offer and read as untagged chatter, because the rule wanted the literal word
 * "anyone". One optional word between "any" and the verb covers it.
 */
describe('offers aimed at a class', () => {
  it('reads "any <class> want" as an offer', () => {
    expect(intentOf('any war want? Legionnaire Scale Helm (Legendary)')).toBe('sell')
    expect(intentOf('any shm need this')).toBe('sell')
    expect(intentOf('any rogue want a Shadowy Assassin Sash (Legendary)?')).toBe('sell')
    expect(intentOf('any cleric need Guise of the Deceiver?')).toBe('sell')
  })

  it('still reads the plain forms', () => {
    expect(intentOf('anyone want a bracer')).toBe('sell')
    expect(intentOf('who needs a Hopebringer')).toBe('sell')
  })

  /** The verb guard still holds with a class in the way. */
  it('keeps "any <class> want to X" out of the market', () => {
    expect(intentOf('any war want to come to DN')).toBeNull()
    expect(groupCallOf('any war want to come to DN')).toBe('forming')
  })

  /** "any" followed by an unrelated noun is not an offer. */
  it('does not fire on ordinary sentences starting with any', () => {
    expect(intentOf('any idea what this drops from')).toBeNull()
    expect(intentOf('anything good happening tonight')).toBeNull()
  })
})

/**
 * The invitation is the signal, not the verb.
 *
 * The first flag-run rule demanded a content verb from a list I made up -
 * doing, running, heading to - and "kill gore for flag if anyone needs" walked
 * straight past it. The verb is the part that varies.
 */
describe('flag runs, however they are phrased', () => {
  it('reads any activity offered with an invitation', () => {
    expect(groupCallOf('kill gore for flag if anyone needs')).toBe('forming')
    expect(groupCallOf('doing talendor if anyone needs flag')).toBe('forming')
    expect(groupCallOf('on to velious flags if anyone wants in')).toBe('forming')
    expect(groupCallOf('heading into ToV if anyone wants')).toBe('forming')
    expect(groupCallOf('CT in 10 if anyone needs it')).toBe('forming')
  })

  /**
   * A giveaway ends the same way and is still a giveaway. Checked by asking
   * for the trade intent rather than by teaching the grouping pattern about
   * every phrasing of "free".
   */
  it('does not steal giveaways that end with an invitation', () => {
    expect(groupCallOf('free to a good home if anyone needs them')).toBe(false)
    expect(intentOf('free to a good home if anyone needs them')).toBe('give')
    expect(groupCallOf('giving away spare bracers if anyone wants')).toBe(false)
  })

  it('still leaves a plain sale alone', () => {
    expect(groupCallOf('WTS Legionnaire Scale Helm if anyone needs')).toBe(false)
  })
})

/**
 * The buff board only means something while the game is still writing.
 *
 * It is built entirely from effect messages, so once a character goes quiet it
 * freezes on whatever was last true - and a frozen board is worse than an empty
 * one, because it looks current. Somebody logged out two hours ago was shown
 * holding seven buffs, four of them songs that had not pulsed since.
 */
describe('whether a buff board still has grounds', () => {
  const NOW = 1_700_000_000_000

  it('holds while the game is writing', () => {
    expect(boardIsCurrent(NOW - 60_000, NOW)).toBe(true)
    expect(boardIsCurrent(NOW - (BOARD_STALE_MS - 60_000), NOW)).toBe(true)
  })

  it('gives up once the game has been silent a long time', () => {
    expect(boardIsCurrent(NOW - (BOARD_STALE_MS + 60_000), NOW)).toBe(false)
    expect(boardIsCurrent(NOW - 2 * 60 * 60_000, NOW)).toBe(false)
  })

  /**
   * Deliberately far more forgiving than the two minutes the party strip uses
   * for "offline": EverQuest writes nothing for a character standing still, and
   * a short AFK should not wipe a board that is still true.
   */
  it('survives a short silence that would read as offline elsewhere', () => {
    expect(boardIsCurrent(NOW - 5 * 60_000, NOW)).toBe(true)
  })

  it('shows nothing for a character that has produced no lines at all', () => {
    expect(boardIsCurrent(null, NOW)).toBe(false)
  })
})