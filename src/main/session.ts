import type { CombatState, Settings, WatcherStatus } from '@shared/ipc'
import type { Encounter, ParsedEvent } from '@shared/parser/types'
import { summarize } from '@shared/stats'
import { LogWatcher } from './watcher'

/**
 * Owns the live picture: the watcher, the fights it produces, and the throttle
 * that decides how often the renderer hears about it.
 *
 * The throttle matters. A busy trio pull writes a few hundred lines a second,
 * and re-summarising and re-serialising the whole fight per line would spend
 * more time on IPC than on parsing. Recomputing at a fixed 5 Hz is well under
 * what the eye resolves on a bar chart and keeps the cost flat regardless of
 * how hard the log is being written.
 */

const PUSH_HZ = 5
const HISTORY_LIMIT = 40
const LINE_BUFFER = 500

export class Session {
  private watcher: LogWatcher
  private live: Encounter | null = null
  private closed: Encounter[] = []
  private lines: ParsedEvent[] = []
  private pendingLines: ParsedEvent[] = []
  private dirty = false
  private timer: NodeJS.Timeout | null = null

  constructor(
    private push: {
      status: (s: WatcherStatus) => void
      state: (s: CombatState) => void
      lines: (l: ParsedEvent[]) => void
    },
    /** Anything else that wants the merged stream - flagging, alerts. */
    private onEvents?: (events: ParsedEvent[]) => void,
    /**
     * Facts read out of the log's past on attach. Only for state that is
     * replaced rather than accumulated - see WatcherEvents.onStandingFacts.
     */
    private onStandingFacts?: (events: ParsedEvent[]) => void,
    /**
     * Called once per fight, when it closes. Separate from the event stream
     * because per-fight facts - how long a mob took to kill - cannot be
     * derived from events one at a time.
     */
    private onFightClosed?: (enc: Encounter, selfNames: Set<string>) => void
  ) {
    this.watcher = new LogWatcher({
      onStatus: (s) => this.push.status(s),
      onStandingFacts: (events) => this.onStandingFacts?.(events),
      onEvents: (events) => {
        // Group messages are kept per-log on purpose (see merge.ts), which
        // means a trio in one group writes the same "X has joined the group"
        // three times. That is right for state and wrong for a ticker, so the
        // stream doesn't carry them - the group strip on Combat is their home.
        const shown = events.filter((e) => e.kind !== 'group')
        this.pendingLines.push(...shown)
        this.lines.push(...shown)
        if (this.lines.length > LINE_BUFFER) this.lines.splice(0, this.lines.length - LINE_BUFFER)
        // Flagging rides on the same merged stream the meter uses, so a boss
        // killed by any character in the trio counts exactly once.
        this.onEvents?.(events)
      },
      onEncounter: (enc) => {
        this.live = enc
        this.dirty = true
      },
      onEncounterClosed: (enc) => {
        this.closed.unshift(enc)
        if (this.closed.length > HISTORY_LIMIT) this.closed.pop()
        this.live = null
        this.dirty = true
        // Fired here rather than on the history cap, so a long night's fights
        // are all recorded even though only the last forty are kept in memory.
        this.onFightClosed?.(enc, new Set(this.watcher.status().sources.map((s) => s.character)))
      }
    })
  }

  start(settings: Settings, opts: { fromEnd?: boolean } = {}): WatcherStatus {
    const status = this.watcher.start(settings, opts)
    if (!this.timer) {
      this.timer = setInterval(() => this.flush(), 1000 / PUSH_HZ)
      this.timer.unref()
    }
    return status
  }

  stop(): void {
    this.watcher.stop()
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  status(): WatcherStatus {
    return this.watcher.status()
  }

  /** Clear the session's fights - "Overall" starts from here. */
  reset(): void {
    this.closed = []
    this.live = null
    this.lines = []
    this.dirty = true
  }

  state(): CombatState {
    const selfNames = new Set(this.watcher.status().sources.map((s) => s.character))
    return {
      live: this.live ? summarize(this.live, selfNames) : null,
      history: this.closed.map((e) => summarize(e, selfNames)),
      overall: this.buildOverall(selfNames)
    }
  }

  /**
   * Every event in one fight, for the timeline.
   *
   * Deliberately pull-only rather than part of the 5 Hz state push: a long
   * fight is thousands of events, and serialising all of them five times a
   * second to feed a view that is usually closed would dominate the app's cost.
   */
  eventsFor(fightId: string): ParsedEvent[] {
    if (fightId === 'overall') {
      const all = this.live ? [this.live, ...this.closed] : this.closed
      return all.flatMap((e) => e.events)
    }
    if (this.live?.id === fightId) return this.live.events
    return this.closed.find((e) => e.id === fightId)?.events ?? []
  }

  recentLines(limit = LINE_BUFFER, includeUnparsed = false): ParsedEvent[] {
    const rows = includeUnparsed ? this.lines : this.lines.filter((l) => l.kind !== 'unparsed')
    return rows.slice(-limit)
  }

  /**
   * "Overall" is every fight this session stitched into one synthetic
   * encounter. Its duration is the sum of the fights, NOT the wall clock from
   * the first to the last: an hour of grinding with ten minutes of fighting in
   * it should report the dps you actually did, not a tenth of it.
   */
  private buildOverall(selfNames: Set<string>): CombatState['overall'] {
    const all = this.live ? [this.live, ...this.closed] : this.closed
    if (all.length === 0) return null

    const events = all.flatMap((e) => e.events)
    if (events.length === 0) return null

    const start = Math.min(...all.map((e) => e.start))
    const end = Math.max(...all.map((e) => e.end))
    const activeSeconds = all.reduce((s, e) => s + e.activeSeconds, 0)

    const merged: Encounter = {
      id: 'overall',
      name: all.length === 1 ? all[0].name : `${all.length} fights`,
      zone: all[0].zone,
      start,
      end,
      live: this.live !== null,
      activeSeconds,
      events
    }

    const summary = summarize(merged, selfNames)
    // Recompute the headline against fight time rather than the calendar.
    const fightSeconds = Math.max(
      1,
      all.reduce((s, e) => s + Math.max(1, Math.round((e.end - e.start) / 1000)), 0)
    )
    summary.durationSeconds = fightSeconds
    summary.dps = summary.totalOut / fightSeconds
    return summary
  }

  private flush(): void {
    if (this.pendingLines.length > 0) {
      const batch = this.pendingLines
      this.pendingLines = []
      this.push.lines(batch)
    }
    // A live fight is always dirty: its duration - and so its dps - moves even
    // in a second where nothing landed.
    if (this.dirty || this.live) {
      this.dirty = false
      this.push.state(this.state())
    }
  }
}
