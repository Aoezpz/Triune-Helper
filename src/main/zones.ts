import Store from 'electron-store'
import type { ParsedEvent } from '@shared/parser/types'
import { blankTotals, foldVisit, type ZonesData, type ZoneTotals, type ZoneVisit } from '@shared/zones'

/**
 * Zone visits, accumulated from the merged stream.
 *
 * The open visit is the only mutable state: everything that arrives goes into
 * it until a zone line closes it and opens the next. That makes the whole thing
 * a fold over the event stream, which is why it needs no timers and cannot
 * drift out of step with the meter.
 *
 * One subtlety worth stating: `to` advances with every event seen, not with the
 * wall clock. Leaving the app running overnight in an empty zone therefore adds
 * no time to it - which is right, because you were not there, your client was.
 */

const MAX_VISITS = 2000
/** A visit shorter than this was a load screen, not a stay. */
const MIN_VISIT_MS = 5_000

interface Persisted {
  visits: ZoneVisit[]
  totals: Record<string, ZoneTotals>
  /** The visit that was still open when we last wrote. */
  open: ZoneVisit | null
}

const store = new Store<Persisted>({
  name: 'triune-zones',
  defaults: { visits: [], totals: {}, open: null },
  clearInvalidConfig: true
})

export class Zones {
  private visits: ZoneVisit[] = store.get('visits') ?? []
  private totals: Record<string, ZoneTotals> = store.get('totals') ?? {}
  private open: ZoneVisit | null = null
  private dirty = false

  constructor() {
    /**
     * A visit left open by the last run is closed now rather than resumed.
     *
     * Resuming would be wrong: the gap between then and now is time you were
     * not playing, and folding it in would credit the zone with an evening
     * spent asleep. Closing it banks exactly what was observed.
     *
     * This is also what keeps the lifetime ledger honest across restarts - the
     * open visit is the one that would otherwise never be folded in, because
     * `closeOpen` is the only thing that folds and it never ran for it.
     */
    const stranded = store.get('open')
    if (stranded) {
      this.bank(stranded)
      store.set('open', null)
    }

    setInterval(() => this.flush(), 20_000).unref()
  }

  /** Close a visit into both the recent list and the lifetime ledger. */
  private bank(v: ZoneVisit): void {
    if (v.to - v.from < MIN_VISIT_MS) return
    this.visits.push(v)
    const t = this.totals[v.zone] ?? blankTotals(v.zone, v.from)
    foldVisit(t, v)
    this.totals[v.zone] = t
    if (this.visits.length > MAX_VISITS) this.visits.splice(0, this.visits.length - MAX_VISITS)
    this.dirty = true
  }

  observe(events: ParsedEvent[]): void {
    for (const e of events) {
      if (e.kind === 'zone' && e.detail) {
        this.closeOpen()
        this.open = {
          zone: e.detail,
          from: e.ts,
          to: e.ts,
          kills: 0,
          copper: 0,
          deaths: 0,
          aa: 0
        }
        this.dirty = true
        continue
      }

      if (!this.open) continue

      // Any line at all proves you were still there, so the clock follows the
      // log rather than the wall.
      if (e.ts > this.open.to) this.open.to = e.ts

      if (e.kind === 'xp') this.open.kills += 1
      else if (e.kind === 'aa') this.open.aa += 1
      else if (e.kind === 'coin' && e.amount) this.open.copper += e.amount
      else if (e.kind === 'death' && e.target?.kind === 'self') this.open.deaths += 1

      this.dirty = true
    }
  }

  /**
   * The open visit is folded in on the way out rather than banked early, so
   * the page shows the zone you are standing in without that time being
   * counted twice when it eventually closes.
   */
  data(): ZonesData {
    if (!this.open) return { visits: this.visits, totals: this.totals }

    const totals: Record<string, ZoneTotals> = { ...this.totals }
    const t = { ...(totals[this.open.zone] ?? blankTotals(this.open.zone, this.open.from)) }
    foldVisit(t, this.open)
    totals[this.open.zone] = t

    return { visits: [...this.visits, { ...this.open }], totals }
  }

  reset(): ZonesData {
    this.visits = []
    this.totals = {}
    this.open = null
    this.dirty = true
    store.set('open', null)
    this.flush()
    return this.data()
  }

  private closeOpen(): void {
    if (!this.open) return
    // Zoning through the Bazaar to sell leaves a five-second visit that would
    // otherwise clutter the table with places you did not go.
    this.bank(this.open)
    this.open = null
  }

  flush(): void {
    if (!this.dirty) return
    this.dirty = false
    store.set('visits', this.visits)
    store.set('totals', this.totals)
    // Stored apart from the banked visits so a crash cannot double-count it:
    // on next launch it is banked exactly once, by the constructor.
    store.set('open', this.open)
  }
}
