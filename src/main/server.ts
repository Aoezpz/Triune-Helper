import Store from 'electron-store'
import type { ParsedEvent } from '@shared/parser/types'
import {
  foldBlessing,
  foldCensus,
  groupCallOf,
  intentOf,
  itemsIn,
  type Blessing,
  type CensusEntry,
  type GroupCall,
  type Offer,
  type ServerData
} from '@shared/server'

/**
 * The world outside your group.
 *
 * Everything here comes off the server's broadcast channels, which means it is
 * only ever a sample of what happened while you were logged in. That is stated
 * on the page rather than hidden, because the alternative - a "server
 * population" that is really "people who dinged near me" - would be worse than
 * showing nothing.
 *
 * Persisted, because the whole value is continuity: a blessing announced last
 * night is still running this morning, and a trio census built over a month is
 * worth something where one built over an hour is not.
 */

const MAX_OFFERS = 400

interface Persisted {
  blessings: Blessing[]
  census: Record<string, CensusEntry>
  groups: GroupCall[]
  offers: Offer[]
  bazaar: ServerData['bazaar']
  appliedAt: number | null
}

const store = new Store<Persisted>({
  name: 'triune-server',
  defaults: { blessings: [], census: {}, groups: [], offers: [], bazaar: null, appliedAt: null },
  clearInvalidConfig: true
})

/**
 * One row per thing actually said.
 *
 * Same key as the write-side guard: the line's own timestamp, who said it, and
 * what it said. Two identical shouts a minute apart stay two rows, because the
 * timestamps differ.
 */
function dedupe<T extends { at: number; text: string }>(rows: T[], who: (r: T) => string): T[] {
  const seen = new Set<string>()
  return rows.filter((r) => {
    const key = `${r.at}|${who(r)}|${r.text}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export class ServerWatch {
  private blessings: Blessing[] = store.get('blessings') ?? []
  private census: Record<string, CensusEntry> = store.get('census') ?? {}
  private groups: GroupCall[] = store.get('groups') ?? []
  private offers: Offer[] = store.get('offers') ?? []
  private bazaar: ServerData['bazaar'] = store.get('bazaar') ?? null
  private appliedAt: number | null = store.get('appliedAt') ?? null
  private dirty = false

  constructor() {
    setInterval(() => this.flush(), 20_000).unref()
  }

  observe(events: ParsedEvent[]): void {
    for (const e of events) {
      if (e.kind === 'blessing') {
        // The pair about you personally. `applied` is the moment they landed;
        // `incoming` is the few seconds' warning, which is a heads-up rather
        // than a record and is not stored.
        if (e.skill === 'applied') {
          this.appliedAt = Math.max(this.appliedAt ?? 0, e.ts)
          this.dirty = true
          continue
        }
        if (e.skill === 'incoming') continue

        if (!e.detail || e.amount === undefined) continue
        this.blessings = foldBlessing(this.blessings, e.detail, e.ts, e.amount)
        this.dirty = true
        continue
      }

      if (e.kind === 'census' && e.target && e.detail) {
        foldCensus(this.census, e.target.name, e.detail, e.ts, {
          level: e.census === 'level' ? e.amount : undefined,
          serverFirst: e.census === 'first'
        })
        this.dirty = true
        continue
      }

      if (e.kind === 'chat') this.trade(e)
    }
  }

  /**
   * Trade talk, kept only when it is actually trade talk.
   *
   * Auction is the channel for it and OOC carries the overflow; everything
   * else people say is conversation. A line with no WTS/WTB/WTT marker and no
   * recognisable item is dropped rather than filed as an offer with nothing
   * in it.
   */
  private trade(e: ParsedEvent): void {
    if (e.channel !== 'auction' && e.channel !== 'ooc') return
    const text = e.detail ?? ''
    if (!text) return

    // People before goods. A group call goes to its own list and never reaches
    // the market, which is what stopped "anyone want to come, got more spots"
    // being advertised as a sale.
    const call = groupCallOf(text)
    if (call !== false) {
      const caller = e.attacker?.name ?? 'someone'
      const seen = Math.max(0, this.groups.length - 200)
      for (let i = this.groups.length - 1; i >= seen; i--) {
        const g = this.groups[i]
        if (g.at === e.ts && g.caller === caller && g.text === text) return
      }
      this.groups.push({ caller, channel: e.channel, text, at: e.ts, kind: call })
      if (this.groups.length > MAX_OFFERS) {
        this.groups.splice(0, this.groups.length - MAX_OFFERS)
      }
      this.dirty = true
      return
    }

    const intent = intentOf(text)
    const items = itemsIn(text)
    if (intent === null && items.length === 0) return

    // The same line must not be stored twice.
    //
    // On attach the watcher rewinds 64 KB and reads forward, so every restart
    // re-delivers auction lines that are already here - and this list is
    // persisted, so they piled up. Three restarts in an evening put three
    // copies of the same shout on the page.
    //
    // Keyed on the line's own timestamp plus who said it and what it said, so
    // two genuinely separate shouts of identical text a minute apart are still
    // two rows. Only the recent tail is searched: the log arrives in time order
    // and MAX_OFFERS is 400, so a duplicate is always near the end.
    const seller = e.attacker?.name ?? 'someone'
    const from = Math.max(0, this.offers.length - 200)
    for (let i = this.offers.length - 1; i >= from; i--) {
      const o = this.offers[i]
      if (o.at === e.ts && o.seller === seller && o.text === text) return
    }

    this.offers.push({
      seller,
      channel: e.channel,
      text,
      at: e.ts,
      intent,
      items
    })
    if (this.offers.length > MAX_OFFERS) this.offers.splice(0, this.offers.length - MAX_OFFERS)
    this.dirty = true
  }

  data(): ServerData {
    // Anything already stored as an offer that is really a group call moves
    // across on the way out. Without this the Grouping tab starts empty on a
    // store built before it existed, and "flagging group, anyone want to come"
    // stays in the market wearing the WTS tag the old rules gave it. Same
    // principle as re-deriving intent: what was said is the fact, which list it
    // belongs in is an opinion.
    const stored = dedupe(this.offers, (o) => o.seller)
    const strayCalls: GroupCall[] = []
    const trade: Offer[] = []
    for (const o of stored) {
      const call = groupCallOf(o.text)
      if (call === false) trade.push(o)
      else strayCalls.push({ caller: o.seller, channel: o.channel, text: o.text, at: o.at, kind: call })
    }

    const groups = dedupe([...this.groups, ...strayCalls], (g) => g.caller).sort((a, b) => a.at - b.at)

    return {
      blessings: this.blessings,
      census: this.census,
      groups,
      // Two things happen on the way out.
      //
      // Deduplicated, because the same shout is re-delivered by the 64 KB
      // attach backfill on every restart and this list is persisted - three
      // restarts in an evening used to put three copies of one line on the
      // page. Doing it here as well as on write means a store that already
      // accumulated copies cleans itself up rather than needing a reset.
      //
      // And intent and item names are RE-DERIVED rather than trusted from the
      // store. They were computed once when the line arrived and persisted
      // beside it, which quietly meant every improvement to the rules only ever
      // reached lines heard afterwards. The line is the fact; anything read out
      // of it is an opinion, and an opinion should follow the current rules.
      offers: trade.map((o) => ({
        ...o,
        intent: intentOf(o.text),
        items: itemsIn(o.text)
      })),
      bazaar: this.bazaar,
      appliedAt: this.appliedAt
    }
  }

  reset(): ServerData {
    this.blessings = []
    this.census = {}
    this.groups = []
    this.offers = []
    this.bazaar = null
    this.appliedAt = null
    this.dirty = true
    this.flush()
    return this.data()
  }

  flush(): void {
    if (!this.dirty) return
    this.dirty = false
    store.set('blessings', this.blessings)
    store.set('census', this.census)
    store.set('groups', this.groups)
    store.set('offers', this.offers)
    store.set('bazaar', this.bazaar)
    store.set('appliedAt', this.appliedAt)
  }
}
