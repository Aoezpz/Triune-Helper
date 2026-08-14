import Store from 'electron-store'
import type { ParsedEvent } from '@shared/parser/types'
import {
  foldBlessing,
  foldCensus,
  intentOf,
  itemsIn,
  type Blessing,
  type CensusEntry,
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
  offers: Offer[]
  bazaar: ServerData['bazaar']
  appliedAt: number | null
}

const store = new Store<Persisted>({
  name: 'triune-server',
  defaults: { blessings: [], census: {}, offers: [], bazaar: null, appliedAt: null },
  clearInvalidConfig: true
})

export class ServerWatch {
  private blessings: Blessing[] = store.get('blessings') ?? []
  private census: Record<string, CensusEntry> = store.get('census') ?? {}
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

    const intent = intentOf(text)
    const items = itemsIn(text)
    if (intent === null && items.length === 0) return

    this.offers.push({
      seller: e.attacker?.name ?? 'someone',
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
    return {
      blessings: this.blessings,
      census: this.census,
      // Intent and item names are DERIVED, so they are re-derived here rather
      // than trusted from the store. They were being computed once when the
      // line arrived and persisted alongside it, which quietly meant every
      // improvement to the rules only applied to lines heard afterwards - four
      // hundred stored rows kept whatever the old rules decided, forever. The
      // line itself is the fact; everything read out of it is an opinion, and
      // an opinion should be recomputed from the current rules.
      offers: this.offers.map((o) => ({
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
    store.set('offers', this.offers)
    store.set('bazaar', this.bazaar)
    store.set('appliedAt', this.appliedAt)
  }
}
