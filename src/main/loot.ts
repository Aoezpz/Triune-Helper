import Store from 'electron-store'
import type { CoinEvent, DiscoveryEvent, LootData } from '@shared/loot'
import type { ParsedEvent } from '@shared/parser/types'

/**
 * Income and item sightings, kept across sessions.
 *
 * Two things worth knowing about the shape of this data:
 *
 *   * **Coin is high volume.** The auto-sell fires on most kills, so an
 *     evening is thousands of rows. They are capped, oldest first, and the cap
 *     is generous enough to cover a long session without letting the file grow
 *     without bound.
 *   * **Discoveries are everybody's.** They are a server-wide broadcast, so
 *     this is a record of what is dropping across the whole of Project Triune,
 *     not what your trio found. That makes them interesting for a different
 *     reason, and the page says which is which.
 */

const MAX_COIN = 20_000
const MAX_DISCOVERIES = 400

interface Persisted {
  coin: CoinEvent[]
  discoveries: DiscoveryEvent[]
}

const store = new Store<Persisted>({
  name: 'triune-loot',
  defaults: { coin: [], discoveries: [] },
  clearInvalidConfig: true
})

export class Loot {
  private coin: CoinEvent[] = store.get('coin') ?? []
  private discoveries: DiscoveryEvent[] = store.get('discoveries') ?? []
  private dirty = false

  /**
   * Where the money is being made, from the last zone line seen.
   *
   * One zone rather than one per character, because a boxed trio zones
   * together - they have to, they are one group in one place. Tracking it per
   * character would be more precise about a situation that does not arise and
   * would report nothing at all for the two boxes whose zone lines the merge
   * rule discards as duplicates.
   */
  private zone: string | null = null

  constructor() {
    setInterval(() => this.flush(), 20_000).unref()
  }

  observe(events: ParsedEvent[]): void {
    for (const e of events) {
      if (e.kind === 'zone' && e.detail) this.zone = e.detail

      if (e.kind === 'coin' && e.amount !== undefined && e.amount > 0) {
        this.coin.push({
          character: e.source,
          at: e.ts,
          copper: e.amount,
          ...(e.item ? { item: e.item } : {}),
          ...(this.zone ? { zone: this.zone } : {})
        })
        this.dirty = true
      }

      if (e.kind === 'loot' && e.broadcast && e.item) {
        this.discoveries.push({
          at: e.ts,
          who: e.target?.name ?? 'someone',
          item: e.item,
          tier: e.tier ?? null
        })
        this.dirty = true
      }
    }

    if (this.coin.length > MAX_COIN) this.coin.splice(0, this.coin.length - MAX_COIN)
    if (this.discoveries.length > MAX_DISCOVERIES) {
      this.discoveries.splice(0, this.discoveries.length - MAX_DISCOVERIES)
    }
  }

  data(): LootData {
    return { coin: this.coin, discoveries: this.discoveries }
  }

  reset(): LootData {
    this.coin = []
    this.discoveries = []
    this.dirty = true
    this.flush()
    return this.data()
  }

  flush(): void {
    if (!this.dirty) return
    this.dirty = false
    store.set('coin', this.coin)
    store.set('discoveries', this.discoveries)
  }
}
