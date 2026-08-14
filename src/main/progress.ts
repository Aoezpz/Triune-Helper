import Store from 'electron-store'
import type { ParsedEvent } from '@shared/parser/types'
import {
  buildKillIndex,
  detectProgress,
  summarizeProgress,
  type ProgMark,
  type ProgressState,
  type ProgressionData,
  type ProgressSummary
} from '@shared/progression'
import data from '../../data/progression.json'

/**
 * Owns flagging state.
 *
 * The definitions are bundled and static; the state is the player's and lives
 * in their config, so a reinstall keeps it and no network is required to see
 * where you are. New flags are detected from kill lines as they happen.
 */

const PROGRESSION = data as unknown as ProgressionData
const KILL_INDEX = buildKillIndex(PROGRESSION)

const store = new Store<{ progress: ProgressState }>({
  name: 'triune-progress',
  defaults: { progress: {} },
  clearInvalidConfig: true
})

export class Progress {
  private state: ProgressState = store.get('progress')

  constructor(private onFlag: (keys: string[], summary: ProgressSummary) => void) {}

  data(): ProgressionData {
    return PROGRESSION
  }

  summary(): ProgressSummary {
    return summarizeProgress(PROGRESSION, this.state)
  }

  marks(): ProgressState {
    return this.state
  }

  /** Feed merged combat events; returns the keys newly earned, if any. */
  observe(events: ParsedEvent[]): string[] {
    const fresh = detectProgress(events, KILL_INDEX, this.state)
    const keys = Object.keys(fresh)
    if (keys.length === 0) return []

    this.state = { ...this.state, ...fresh }
    this.persist()
    this.onFlag(keys, this.summary())
    return keys
  }

  /** Tick or untick by hand - for the steps no log line announces, and for
   *  correcting anything the parser got wrong. */
  set(key: string, earned: boolean): ProgressSummary {
    if (earned) {
      const mark: ProgMark = { at: Date.now(), source: 'manual' }
      this.state = { ...this.state, [key]: mark }
    } else {
      const next = { ...this.state }
      delete next[key]
      this.state = next
    }
    this.persist()
    return this.summary()
  }

  /**
   * Wipe every flag.
   *
   * Needed because flags are detected from whatever log folder is configured -
   * so pointing the app at a test folder, or at a friend's install, records
   * flags that are not yours. Without a reset the only fix would be deleting a
   * JSON file by hand.
   */
  reset(): ProgressSummary {
    this.state = {}
    this.persist()
    return this.summary()
  }

  /** Bulk apply, used by the PTDex sync. Existing log-detected marks win, so a
   *  sync can add history but never erase something you were there for. */
  merge(keys: string[], source: ProgMark['source']): ProgressSummary {
    const next = { ...this.state }
    for (const key of keys) {
      if (!next[key]) next[key] = { at: Date.now(), source }
    }
    this.state = next
    this.persist()
    return this.summary()
  }

  private persist(): void {
    store.set('progress', this.state)
  }
}
