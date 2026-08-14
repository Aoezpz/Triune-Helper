/**
 * What a hover card holds.
 *
 * Two shapes, one channel. Both are built in the main process from PTDex and
 * arrive here as plain data - never as HTML. That is deliberate: the site does
 * render a ready-made tooltip card, and pasting it into the app would have been
 * a third of the work, but it would also mean injecting a remote document into
 * the renderer and wearing the site's light-mode table styling inside a dark
 * app. The site is asked for facts; the app draws them.
 */

export interface SpellTip {
  kind: 'spell'
  name: string
  id: number
  /** Zero for an item proc, which is most of what a log names. */
  mana: number | null
  castSeconds: number | null
  recastSeconds: number | null
  /** Buff duration cap in ticks (6s each), when the spell has one. */
  durationTicks: number | null
  range: number | null
  resist: string | null
  /** "Decrease Hitpoints by 200", "Stun (3.0 sec)" - rendered by PTDex, which
   *  owns the effect formulas, and taken as text. */
  effects: string[]
  /** Which classes can cast it and from what level. Empty for a proc. */
  classes: Array<{ abbrev: string; level: number }>
}

export interface ItemTip {
  kind: 'item'
  name: string
  id: number
  /** The site's own free-text rows: "Class: ALL", "Secondary Primary Range". */
  notes: string[]
  /** "AC: 5", "HP: 35" - label and value, exactly as the site decoded them. */
  stats: Array<{ label: string; value: string }>
  /**
   * The card's trailing one-cell rows, verbatim. Augment slots are most of
   * them - "Slot 1, type 2 (Elite)" - but not all: a Helmet of Shadow also
   * lands "Skill Mod: Riposte 3% (11 max)" here. Called extras rather than augs
   * because that is what they are.
   */
  extras: string[]
}

export type Tip = SpellTip | ItemTip
export type TipKind = Tip['kind']

export interface TipResult {
  /** False means PTDex has no such name - which is a real answer, not a fault. */
  found: boolean
  tip: Tip | null
  /** Set only when the lookup could not be completed at all. */
  error: string | null
}

/**
 * Resist names, straight from EverQuest's own numbering.
 *
 * Included because it is a fixed, documented enum. Target type is NOT included,
 * for the opposite reason: its numbering runs past forty values whose meanings
 * differ between eras, and a tooltip that confidently says "Group" about a
 * single-target spell is worse than a tooltip that says nothing.
 */
export const RESIST_NAMES: Record<number, string> = {
  0: 'Unresistable',
  1: 'Magic',
  2: 'Fire',
  3: 'Cold',
  4: 'Poison',
  5: 'Disease',
  6: 'Chromatic',
  7: 'Prismatic',
  8: 'Physical',
  9: 'Corruption'
}

/**
 * Is this skill name worth asking PTDex about?
 *
 * The parser canonicalises weapon swings to their lower-case first-person verb
 * - `slash`, `kick`, `frenzy on` - while spells, procs and discs keep the
 * capitalised name the client printed. That casing difference is the whole
 * test, and it is reliable because both halves are produced by this codebase
 * rather than guessed at.
 *
 * The two synthetic labels the app invents for itself are excluded by name,
 * since neither is anything the site has ever heard of.
 */
const NOT_A_SPELL = new Set(['Heal', 'Unattributed', 'Damage Shield'])

export function isSpellName(name: string): boolean {
  if (!name || NOT_A_SPELL.has(name)) return false
  return /^[A-Z]/.test(name)
}

/** `2.5s`, or `1s` - trailing zeroes on a cast bar help nobody. */
export function seconds(s: number | null): string | null {
  if (s === null || s <= 0) return null
  return `${Number.isInteger(s) ? s : s.toFixed(1)}s`
}

/** Buff ticks are six seconds each; players think in minutes. */
export function ticksToText(ticks: number | null): string | null {
  if (!ticks || ticks <= 0) return null
  const secs = ticks * 6
  if (secs < 60) return `${secs}s`
  const mins = secs / 60
  return `${Number.isInteger(mins) ? mins : mins.toFixed(1)}m`
}
