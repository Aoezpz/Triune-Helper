/**
 * Where you have been, and what it was worth.
 *
 * Built from one line - "You have entered Drunder, the Fortress of Zek." - and
 * everything that happened before the next one. That is the whole trick: the
 * log never states a position, but it states every transition, and a zone is
 * just the gap between two of them.
 *
 * What this deliberately is NOT: a map. Triune-Helper reads logs and nothing
 * else, and a log carries no coordinates - not one `/loc` in twenty-three
 * thousand lines of real play. Anything drawing a dot for "you are here" would
 * be inventing it.
 */

export interface ZoneVisit {
  zone: string
  /** Epoch ms of the zone-in, and of the last line seen while there. */
  from: number
  to: number
  /** Experience messages - one per kill you got credit for. */
  kills: number
  /** Copper, both streams. */
  copper: number
  /** Times one of your characters died here. */
  deaths: number
  /** Ability points earned here. */
  aa: number
}

/**
 * The lifetime ledger for one zone.
 *
 * Kept separately from the visit list and never trimmed. Visits are capped so
 * the file cannot grow without bound, but a cap on visits must not become a cap
 * on memory: "I have spent forty hours in Drunder" should still be true in a
 * year, long after the individual visits that made it up have rolled off.
 */
export interface ZoneTotals {
  zone: string
  seconds: number
  visits: number
  kills: number
  copper: number
  deaths: number
  aa: number
  firstSeen: number
  lastSeen: number
}

export interface ZonesData {
  /** Recent visits, capped. Used for session windows. */
  visits: ZoneVisit[]
  /** Everything, forever, by zone. Absent on a store written before this existed. */
  totals?: Record<string, ZoneTotals>
}

/** An empty ledger entry, so folding never has to null-check. */
export function blankTotals(zone: string, at: number): ZoneTotals {
  return {
    zone,
    seconds: 0,
    visits: 0,
    kills: 0,
    copper: 0,
    deaths: 0,
    aa: 0,
    firstSeen: at,
    lastSeen: at
  }
}

/** Add a completed visit to a zone's lifetime ledger, in place. */
export function foldVisit(into: ZoneTotals, v: ZoneVisit): void {
  into.seconds += Math.max(0, (v.to - v.from) / 1000)
  into.visits += 1
  into.kills += v.kills
  into.copper += v.copper
  into.deaths += v.deaths
  into.aa += v.aa
  into.firstSeen = Math.min(into.firstSeen, v.from)
  into.lastSeen = Math.max(into.lastSeen, v.to)
}

/**
 * Lifetime rows in the same shape the session table uses, so one table can
 * render either without knowing which it is looking at.
 */
export function lifetimeRows(totals: Record<string, ZoneTotals> | undefined): ZoneRow[] {
  return Object.values(totals ?? {})
    .map((t) => {
      const hours = t.seconds / 3600
      const rated = t.seconds >= MIN_SECONDS_FOR_RATE
      return {
        zone: t.zone,
        seconds: t.seconds,
        visits: t.visits,
        kills: t.kills,
        copper: t.copper,
        deaths: t.deaths,
        aa: t.aa,
        killsPerHour: rated ? t.kills / hours : null,
        copperPerHour: rated ? t.copper / hours : null,
        lastSeen: t.lastSeen
      }
    })
    .sort((a, b) => b.seconds - a.seconds)
}

export interface ZoneRow {
  zone: string
  /** Seconds actually spent there, summed across every visit. */
  seconds: number
  visits: number
  kills: number
  copper: number
  deaths: number
  aa: number
  /** Per hour, or null when the stay was too short to divide by. */
  killsPerHour: number | null
  copperPerHour: number | null
  lastSeen: number
}

/**
 * Below this, a visit is a pass-through rather than a stay.
 *
 * Rates from a thirty-second stop in the Bazaar to sell would otherwise top the
 * table, which is exactly backwards - the whole point of the page is to show
 * where the hours actually go.
 */
export const MIN_SECONDS_FOR_RATE = 120

export function summarizeZones(
  data: ZonesData,
  window?: { from: number; to: number } | null
): ZoneRow[] {
  const rows = new Map<string, ZoneRow>()

  for (const v of data.visits) {
    if (window && (v.to < window.from || v.from > window.to)) continue

    // A visit straddling the window edge counts only the part inside it, so a
    // session total can never exceed the session.
    const from = window ? Math.max(v.from, window.from) : v.from
    const to = window ? Math.min(v.to, window.to) : v.to
    const seconds = Math.max(0, (to - from) / 1000)

    let row = rows.get(v.zone)
    if (!row) {
      row = {
        zone: v.zone,
        seconds: 0,
        visits: 0,
        kills: 0,
        copper: 0,
        deaths: 0,
        aa: 0,
        killsPerHour: null,
        copperPerHour: null,
        lastSeen: 0
      }
      rows.set(v.zone, row)
    }

    row.seconds += seconds
    row.visits += 1
    row.kills += v.kills
    row.copper += v.copper
    row.deaths += v.deaths
    row.aa += v.aa
    row.lastSeen = Math.max(row.lastSeen, v.to)
  }

  for (const row of rows.values()) {
    if (row.seconds >= MIN_SECONDS_FOR_RATE) {
      const hours = row.seconds / 3600
      row.killsPerHour = row.kills / hours
      row.copperPerHour = row.copper / hours
    }
  }

  // Ranked by time spent, not by income: this answers "where did the evening
  // go" first, and "what did it pay" second.
  return [...rows.values()].sort((a, b) => b.seconds - a.seconds)
}

/** Total seconds across the rows, for the share bars. */
export function totalSeconds(rows: ZoneRow[]): number {
  return rows.reduce((n, r) => n + r.seconds, 0)
}
