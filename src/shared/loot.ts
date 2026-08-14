/**
 * Money and things.
 *
 * Project Triune logs two income streams and this page is the only place they
 * are ever added together:
 *
 *   "You receive 2 gold, 7 silver, 3 copper."      - coin off a corpse
 *   "[NMS] Sunshard Ore sold for 5 silver."        - the server's auto-sell
 *
 * The second is much the larger by volume - 244 sales against 47 coin drops in
 * a day's play - and it names the item, which makes it the only running record
 * of what your trio is actually killing for.
 *
 * Everything is stored in copper and formatted on the way out. Storing "2 gold
 * 7 silver" as text and adding it up later is how you end up with a total that
 * disagrees with itself.
 */

/** Copper per unit. EverQuest's currency is decimal, thankfully. */
export const COIN_UNITS: Array<[name: string, copper: number, short: string]> = [
  ['platinum', 1000, 'p'],
  ['gold', 100, 'g'],
  ['silver', 10, 's'],
  ['copper', 1, 'c']
]

/**
 * "2 gold, 7 silver, 3 copper" -> 273.
 *
 * Returns null rather than 0 for anything that is not a coin phrase, so
 * "You receive no coin." is distinguishable from a real drop of nothing.
 */
export function coinToCopper(phrase: string): number | null {
  let total = 0
  let matched = false
  for (const [name, copper] of COIN_UNITS) {
    const m = new RegExp(`(\\d+)\\s+${name}`, 'i').exec(phrase)
    if (!m) continue
    total += Number(m[1]) * copper
    matched = true
  }
  return matched ? total : null
}

/** 1234 -> "1p 2g 3s 4c", dropping the units that are zero. */
export function formatCoin(copper: number): string {
  if (copper <= 0) return '0c'
  let left = Math.round(copper)
  const parts: string[] = []
  for (const [, unit, short] of COIN_UNITS) {
    const n = Math.floor(left / unit)
    if (n > 0) parts.push(`${n.toLocaleString()}${short}`)
    left -= n * unit
  }
  return parts.join(' ')
}

/** Platinum as a decimal, for rates where "3p 4g" reads worse than "3.4". */
export function toPlatinum(copper: number): number {
  return copper / 1000
}

export interface CoinEvent {
  character: string
  at: number
  copper: number
  /** Set when this was an auto-sale rather than coin off a corpse. */
  item?: string
  /**
   * Where it was earned, from the last zone line seen. Absent for anything
   * banked before the app saw a zone change - on first run that is everything
   * until you next zone, and the page says so rather than filing it under a
   * guess.
   */
  zone?: string
}

/** An item name seen in a discovery broadcast, with who found it. */
export interface DiscoveryEvent {
  at: number
  who: string
  item: string
  tier: string | null
}

export interface LootData {
  coin: CoinEvent[]
  discoveries: DiscoveryEvent[]
}

export interface SoldRow {
  item: string
  count: number
  copper: number
}

export interface ZoneCoinRow {
  zone: string
  copper: number
  /** Drops and sales, so a zone with one fat sale reads differently from a
   *  zone with a hundred small ones. */
  events: number
}

/**
 * A run of activity with no gap longer than `gapMinutes`.
 *
 * Rates over wall-clock-since-install would be meaningless for anyone who
 * leaves the app open, which is everyone.
 */
export function coinSession(coin: CoinEvent[], gapMinutes = 30): { from: number; to: number } | null {
  if (coin.length === 0) return null
  const sorted = [...coin].sort((a, b) => a.at - b.at)
  const gap = gapMinutes * 60_000

  let from = sorted[sorted.length - 1].at
  for (let i = sorted.length - 1; i > 0; i--) {
    if (sorted[i].at - sorted[i - 1].at > gap) break
    from = sorted[i - 1].at
  }
  return { from, to: sorted[sorted.length - 1].at }
}

export interface LootSummary {
  /** Copper from corpses. */
  fromKills: number
  /** Copper from the server auto-selling loot. */
  fromSales: number
  total: number
  /** Copper per hour over the observed window. Null when too short to divide. */
  perHour: number | null
  observedSeconds: number
  /** What sold, ranked by what it earned. */
  sold: SoldRow[]
  /** Where it was earned, ranked. Coin with no zone recorded is left out. */
  byZone: ZoneCoinRow[]
  /** Copper that predates any zone line, so the page can own up to it. */
  unzoned: number
  coin: CoinEvent[]
}

/** Below this there is not enough elapsed time for a rate to mean anything. */
export const MIN_SECONDS_FOR_RATE = 60

export function summarizeLoot(
  data: LootData,
  window?: { from: number; to: number } | null
): LootSummary {
  const coin = data.coin
    .filter((c) => !window || (c.at >= window.from && c.at <= window.to))
    .sort((a, b) => a.at - b.at)

  let fromKills = 0
  let fromSales = 0
  let unzoned = 0
  const sold = new Map<string, SoldRow>()
  const zones = new Map<string, ZoneCoinRow>()

  for (const c of coin) {
    if (c.item) {
      fromSales += c.copper
      const row = sold.get(c.item) ?? { item: c.item, count: 0, copper: 0 }
      row.count += 1
      row.copper += c.copper
      sold.set(c.item, row)
    } else {
      fromKills += c.copper
    }

    if (c.zone) {
      const z = zones.get(c.zone) ?? { zone: c.zone, copper: 0, events: 0 }
      z.copper += c.copper
      z.events += 1
      zones.set(c.zone, z)
    } else {
      unzoned += c.copper
    }
  }

  // Measured across the actual coin events rather than the requested window:
  // a window that starts an hour before the first drop would halve the rate.
  const span = coin.length >= 2 ? (coin[coin.length - 1].at - coin[0].at) / 1000 : 0
  const total = fromKills + fromSales

  return {
    fromKills,
    fromSales,
    total,
    perHour: span >= MIN_SECONDS_FOR_RATE ? (total / span) * 3600 : null,
    observedSeconds: span,
    sold: [...sold.values()].sort((a, b) => b.copper - a.copper),
    byZone: [...zones.values()].sort((a, b) => b.copper - a.copper),
    unzoned,
    coin
  }
}
