/**
 * What is currently on you.
 *
 * EverQuest never states this. There is no "you have X" line and no duration
 * anywhere in the log, so the whole board is built from two events per spell:
 * the message it prints when it lands, and the one it prints when it fades.
 * Both come from the client's own spells_us.txt via scripts/export-buffs.mjs,
 * and only messages that identify exactly one spell are used - "Your
 * protection fades." belongs to 26 spells and is therefore useless.
 *
 * THE HONEST SHAPE OF THIS: the app knows when a buff started and when it
 * ended. It does not know how long it was supposed to last, so there is no
 * countdown here and there never can be one from a log file. What it can show
 * is what is up, how long it has been up, and - for songs, which are re-sung
 * every few seconds - whether it is still pulsing or has gone quiet.
 */

export interface BuffState {
  name: string
  /** Whose log said so. */
  character: string
  /** Last time the landing message appeared. */
  lastOn: number
  /** Last time the fade message appeared, or 0. */
  lastOff: number
  /** How many times it has landed - a song pulses, a buff does not. */
  pulses: number
}

export interface BuffRow extends BuffState {
  active: boolean
  /** Since the most recent landing. */
  heldMs: number
  /**
   * Re-applied often enough to be a song rather than a buff, judged from its
   * own history rather than from any list of what songs are.
   */
  song: boolean
  /**
   * A song that has not pulsed recently. Not proof it dropped - the fade
   * message may simply be one of the ambiguous ones that got thrown away - so
   * it is shown as uncertain rather than as gone.
   */
  quiet: boolean
}

/**
 * A song re-sings itself every few seconds. Anything landing again within this
 * gap, repeatedly, is being maintained rather than cast once.
 */
export const SONG_PULSE_MS = 30_000

/** Pulses needed before calling something a song. One repeat is a re-buff. */
export const SONG_MIN_PULSES = 4

export function buffRows(states: readonly BuffState[], now: number): BuffRow[] {
  return states
    .map((s): BuffRow => {
      const active = s.lastOn > s.lastOff
      const song = s.pulses >= SONG_MIN_PULSES
      return {
        ...s,
        active,
        heldMs: Math.max(0, now - s.lastOn),
        song,
        quiet: active && song && now - s.lastOn > SONG_PULSE_MS
      }
    })
    .filter((r) => r.active)
    .sort((a, b) => {
      // Anything that has gone quiet floats to the top - it is the only thing
      // on this board that might need doing something about.
      if (a.quiet !== b.quiet) return a.quiet ? -1 : 1
      return b.lastOn - a.lastOn
    })
}

export interface BuffsData {
  states: BuffState[]
}
