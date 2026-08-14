import { randomUUID } from 'node:crypto'
import Store from 'electron-store'
import { spawnRows, type ManualTimer, type TimersData } from '@shared/timers'
import type { Mobs } from './mobs'

/**
 * Manual countdowns, and the mobs you have pinned a spawn window to.
 *
 * Only two things are persisted, because only two things are state: the
 * countdowns themselves and the list of pinned mob names. Every spawn number
 * on the page is derived from the mob ledger on read, so a rebuild of history
 * silently improves the estimates without this file knowing anything happened.
 *
 * A running countdown is stored as the epoch millisecond it ends rather than
 * as a remaining count. That is what makes it survive a restart: reopening the
 * app ten minutes into a thirty-minute timer shows twenty minutes left, not
 * thirty, and a timer that expired while the app was shut shows as done.
 */

interface Persisted {
  manual: ManualTimer[]
  tracked: string[]
}

const store = new Store<Persisted>({
  name: 'triune-timers',
  defaults: { manual: [], tracked: [] },
  clearInvalidConfig: true
})

const MAX_MANUAL = 24
const MAX_TRACKED = 40

export class Timers {
  private manual: ManualTimer[] = store.get('manual') ?? []
  private tracked: string[] = store.get('tracked') ?? []

  constructor(private mobs: Mobs) {}

  data(): TimersData {
    return {
      manual: this.manual,
      tracked: this.tracked,
      spawns: spawnRows(this.mobs.data().totals, this.tracked)
    }
  }

  /**
   * Replace the whole list.
   *
   * The renderer owns the editing - adding, renaming, starting, stopping - and
   * hands back the result, which keeps the deadline arithmetic in one place
   * instead of split across an IPC boundary. Fields are rebuilt rather than
   * spread so a stale or hand-edited config can't inject shapes the rest of
   * the app doesn't expect.
   */
  save(next: ManualTimer[]): TimersData {
    this.manual = next.slice(0, MAX_MANUAL).map((t) => ({
      id: t.id || randomUUID(),
      label: String(t.label ?? '').slice(0, 40),
      seconds: clampSeconds(t.seconds),
      endsAt: typeof t.endsAt === 'number' && Number.isFinite(t.endsAt) ? t.endsAt : null,
      repeat: t.repeat === true,
      sound: t.sound ?? 'chime'
    }))
    store.set('manual', this.manual)
    return this.data()
  }

  /** Pin or unpin a mob. Pinned mobs are listed whether or not they qualify. */
  track(mob: string, on: boolean): TimersData {
    const without = this.tracked.filter((m) => m !== mob)
    this.tracked = on ? [mob, ...without].slice(0, MAX_TRACKED) : without
    store.set('tracked', this.tracked)
    return this.data()
  }
}

/** One second to twelve hours. Anything outside that is a typo, not a timer. */
function clampSeconds(n: number): number {
  const s = Math.round(Number(n))
  if (!Number.isFinite(s)) return 60
  return Math.max(1, Math.min(12 * 60 * 60, s))
}
