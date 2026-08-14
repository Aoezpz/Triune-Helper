import Store from 'electron-store'
import type { ParsedEvent } from '@shared/parser/types'
import {
  attachConsider,
  foldTarget,
  isAway,
  type AwayWindow,
  type PresenceData,
  type TargetSighting
} from '@shared/presence'

/**
 * Your own session state: what you have been pointed at, and when you stepped
 * away.
 *
 * Persisted so the away ledger survives a restart, but the target list is
 * short-lived by nature - it exists to power a dossier on the thing in front
 * of you, not to be a history.
 */

const MAX_TARGETS = 40
const MAX_AWAY = 500

/**
 * An away window still open after this long is not a bathroom break, it is a
 * log that ended without the closing line - the app was shut, the client
 * crashed, or the character camped. Closing it at the last line we saw is
 * better than letting it run forever and swallow a whole day.
 */
const ABANDONED_AWAY_MS = 6 * 60 * 60 * 1000

interface Persisted {
  targets: TargetSighting[]
  away: AwayWindow[]
}

const store = new Store<Persisted>({
  name: 'triune-presence',
  defaults: { targets: [], away: [] },
  clearInvalidConfig: true
})

export class Presence {
  private targets: TargetSighting[] = store.get('targets') ?? []
  private away: AwayWindow[] = store.get('away') ?? []
  private dirty = false

  constructor() {
    // A window left open by the last run is closed at its own start rather
    // than resumed: the time between then and now is the app being shut, not
    // you standing at the keyboard doing nothing.
    for (const w of this.away) {
      if (w.to === null) {
        w.to = w.from
        this.dirty = true
      }
    }
    setInterval(() => this.flush(), 20_000).unref()
  }

  observe(events: ParsedEvent[]): void {
    for (const e of events) {
      if (e.kind === 'target' && e.target) {
        this.targets = foldTarget(
          this.targets,
          { name: e.target.name, kind: e.detail ?? 'NPC', at: e.ts, assessment: null, attitude: null },
          MAX_TARGETS
        )
        this.dirty = true
        continue
      }

      if (e.kind === 'con' && e.target && e.detail) {
        attachConsider(this.targets, e.target.name, e.skill ?? '', e.detail, e.ts)
        this.dirty = true
        continue
      }

      if (e.kind === 'afk') this.awayEvent(e)
    }
  }

  private awayEvent(e: ParsedEvent): void {
    const kind = e.detail === 'idle' ? 'idle' : 'afk'
    const open = this.away.filter((w) => w.to === null && w.kind === kind).at(-1)

    if (e.away === true) {
      // Already away by this measure - the server repeating itself, not a new
      // window.
      if (open) return
      this.away.push({ from: e.ts, to: null, kind })
      if (this.away.length > MAX_AWAY) this.away.splice(0, this.away.length - MAX_AWAY)
      this.dirty = true
      return
    }

    if (!open) return
    open.to = e.ts
    this.dirty = true
  }

  data(): PresenceData {
    // Abandoned windows are closed on read as well as on load, so a session
    // that has been running for days never reports a two-day coffee break.
    const now = Date.now()
    for (const w of this.away) {
      if (w.to === null && now - w.from > ABANDONED_AWAY_MS) {
        w.to = w.from + ABANDONED_AWAY_MS
        this.dirty = true
      }
    }
    return { targets: this.targets, away: this.away }
  }

  /** The window currently open, if any - for the "you are AFK" indicator. */
  current(): AwayWindow | null {
    return isAway(this.away)
  }

  reset(): PresenceData {
    this.targets = []
    this.away = []
    this.dirty = true
    this.flush()
    return this.data()
  }

  flush(): void {
    if (!this.dirty) return
    this.dirty = false
    store.set('targets', this.targets)
    store.set('away', this.away)
  }
}
