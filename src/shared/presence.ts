/**
 * What you are doing right now: who you are pointed at, and whether you are
 * actually at the keyboard.
 *
 * Both come from lines the client writes about you and nobody else, so unlike
 * everything on the Server page these are facts about your own session rather
 * than a sample of somebody else's.
 */

export interface TargetSighting {
  name: string
  /** `NPC`, `PC`, `Corpse` - the word the game put in brackets. */
  kind: string
  at: number
  /**
   * The second clause of a consider, when one arrived: "You could probably win
   * this fight". Null until the game offers one, which it does for roughly one
   * target in six.
   */
  assessment: string | null
  /** The first clause - "regards you indifferently". */
  attitude: string | null
}

export interface AwayWindow {
  from: number
  /** Null while still away. */
  to: number | null
  /** `afk` is deliberate; `idle` is the connection noticing, which is weaker. */
  kind: 'afk' | 'idle'
}

export interface PresenceData {
  /** Most recent first, capped. */
  targets: TargetSighting[]
  away: AwayWindow[]
}

/**
 * Time flagged as away, in ms.
 *
 * A FLOOR, not a measurement, and the page says so. Only about fifteen windows
 * a day get flagged in practice - most idling is never announced at all - so
 * this can only ever say "at least this much", never "this much".
 */
export function awayMs(windows: readonly AwayWindow[], now: number, kind?: AwayWindow['kind']): number {
  return windows
    .filter((w) => kind === undefined || w.kind === kind)
    .reduce((total, w) => total + Math.max(0, (w.to ?? now) - w.from), 0)
}

/** Whether the last window is still open. */
export function isAway(windows: readonly AwayWindow[]): AwayWindow | null {
  const open = windows.filter((w) => w.to === null)
  return open.length > 0 ? open[open.length - 1] : null
}

/**
 * Fold a target sighting in.
 *
 * Re-targeting the same thing seconds later is one sighting, not two - the log
 * carries hundreds of those a day and a list that showed each would be
 * useless. A consider that arrives just after a target change is attached to
 * that target rather than filed on its own, because that is what it describes.
 */
export const RETARGET_GAP_MS = 20_000

export function foldTarget(
  into: TargetSighting[],
  sighting: TargetSighting,
  cap: number
): TargetSighting[] {
  const last = into[0]
  if (last && last.name === sighting.name && sighting.at - last.at < RETARGET_GAP_MS) {
    last.at = sighting.at
    return into
  }
  return [sighting, ...into].slice(0, cap)
}

/** Attach a consider to the target it is about, if that target is current. */
export function attachConsider(
  into: TargetSighting[],
  name: string,
  attitude: string,
  assessment: string,
  at: number
): void {
  const hit = into.find((t) => t.name === name && at - t.at < RETARGET_GAP_MS)
  if (!hit) return
  hit.attitude = attitude
  hit.assessment = assessment
}
