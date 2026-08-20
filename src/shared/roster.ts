/**
 * Who the names in your combat log actually are.
 *
 * A log line says "Hexzo hits Zelrin Morlock for 412 points of damage" and
 * nothing else. It never says what Hexzo IS. On a multiclass server where every
 * character is a trio of classes, that missing half is most of the information:
 * a row reading 22.8k means one thing for a War/Rng/Brd and quite another for a
 * Wiz/Mag/Nec, and you cannot tell which you are looking at.
 *
 * PTDex knows, because the game server tells it. So identity is looked up by
 * name and cached here, and every name the app can honestly call a player - your
 * own boxes, and anyone the log has placed in your group - gets a class line
 * next to it.
 *
 * The cache is deliberately name-keyed rather than id-keyed: names are what the
 * log gives us, and on one server they are unique.
 */

import type { ParsedEvent } from './parser/types'

/**
 * Fold one group message into a roster.
 *
 * Lives here rather than in the watcher so it can be tested without a
 * filesystem, and because both the live tail and the on-attach history scan
 * need to apply the same rules in the same order - a group is the sum of its
 * joins and leaves, and applying them out of order leaves somebody in the party
 * who left an hour ago.
 *
 * Note what is absent: the log's own character. A client never writes "you have
 * joined your own group", so adding yourself here would be inventing a line.
 * The character is known to be in its own group by virtue of being tailed at
 * all, and `groupUnion` puts it back at display time.
 */
export function applyGroupEvent(members: Set<string>, ev: ParsedEvent, self: string): void {
  const who = ev.target?.name
  switch (ev.group) {
    case 'join':
      // A join naming the log's own character is "You have joined the group" -
      // it says a group now exists, not who else is in it.
      if (who && who !== self) members.add(who)
      break
    case 'leave':
      if (who) members.delete(who)
      break
    case 'form':
    case 'disband':
      // Forming a group makes it just you; disbanding leaves nobody. Both start
      // the roster over.
      members.clear()
      break
  }
}

/**
 * The sixteen classes in EverQuest's own numbering, 1-16.
 *
 * The order is not cosmetic: the spell table stores a required level per class
 * in columns named `classes1` through `classes16`, and this array is what turns
 * `classes4 = 62` back into "Ranger, level 62".
 */
export const CLASS_ORDER = [
  'War', 'Clr', 'Pal', 'Rng', 'SK', 'Dru', 'Mnk', 'Brd',
  'Rog', 'Shm', 'Nec', 'Wiz', 'Mag', 'Enc', 'Bst', 'Ber'
] as const

/** Class abbreviations exactly as PTDex writes them in a character row. */
export const CLASS_NAMES: Record<string, string> = {
  War: 'Warrior',
  Clr: 'Cleric',
  Pal: 'Paladin',
  Rng: 'Ranger',
  SK: 'Shadow Knight',
  Dru: 'Druid',
  Mnk: 'Monk',
  Brd: 'Bard',
  Rog: 'Rogue',
  Shm: 'Shaman',
  Nec: 'Necromancer',
  Wiz: 'Wizard',
  Mag: 'Magician',
  Enc: 'Enchanter',
  Bst: 'Beastlord',
  Ber: 'Berserker'
}

/**
 * A color per class - sixteen of them, not four by role.
 *
 * Role tinting was the first attempt and it was wrong for this server. On a
 * multiclass server nobody is "the healer": a character is three classes at
 * once, so a chip colored by role would paint two thirds of every trio the
 * same and tell you nothing about which classes those actually are. The class
 * is the identity, so the class gets the color.
 *
 * Built in OKLCH so the sixteen are perceptually spread rather than evenly
 * spread in a color space nobody's eyes use, then checked against the panel
 * surface: every one clears 4.9:1 contrast, which small bold text needs, and
 * the closest pair in normal vision is Ber/Mag at ΔE 8.4.
 *
 * That ΔE is below the 15 a chart series would have to clear, and deliberately
 * so - the rule there exists because a chart's only label IS its color.
 * Here the chip has the class written on it in three letters. The color is a
 * mnemonic on top of a label, never the thing carrying the meaning, which is
 * also why red/green pairs are acceptable: a deuteranope reads "Rng" and "War"
 * exactly as fast as anyone else.
 *
 * Families follow what players already half-expect - warriors red, wizards
 * blue, druids green - with lightness separating classes that share a family,
 * so the three greens are a pale lime, a bright forest and a dark murk rather
 * than three shades of the same argument.
 */
export const CLASS_COLOR: Record<string, string> = {
  War: '#ef5d66', // blood red
  Clr: '#fbf1b2', // near-white gold
  Pal: '#ffacc5', // rose
  Rng: '#5bc663', // forest
  SK: '#b07be6', // violet
  Dru: '#c7ef7b', // pale lime
  Mnk: '#ffcf77', // wheat
  Brd: '#f27fea', // magenta
  Rog: '#6e8bc9', // steel indigo
  Shm: '#00c3cb', // deep teal
  Nec: '#5d9669', // murky green
  Wiz: '#50b0ff', // arcane blue
  Mag: '#e2832d', // burnt amber
  Enc: '#c9c6ff', // lavender
  Bst: '#76f1d3', // jade
  Ber: '#ff966a' // salmon
}

/** The chip color, or a neutral for a class abbreviation we don't know. */
export function classColor(abbrev: string): string {
  return CLASS_COLOR[abbrev] ?? 'var(--muted)'
}

/** What PTDex knows about one character. */
export interface Identity {
  name: string
  id: number | null
  level: number | null
  race: string | null
  /** `['War', 'Rng', 'Brd']`, in the order the site lists them. */
  classes: string[]
  guild: string | null
  /** PTDex's own player score, and where it puts them. */
  score: number | null
  /** Rank among characters running this exact trio, and how many that is. */
  trioRank: number | null
  trioOf: number | null
  overallRank: number | null
  /** Epoch ms of the lookup that produced this. */
  fetchedAt: number
  /**
   * False when PTDex has no character by that exact name. Cached too, and on a
   * shorter clock - a name that isn't on the site should not be re-requested
   * every fight, but it should be retried eventually because new characters
   * appear.
   */
  found: boolean
}

export interface RosterState {
  /** Everyone we have looked up, keyed by the name as the log writes it. */
  known: Record<string, Identity>
  /**
   * Group members per log, as that log reported them. Kept per character
   * because each of your boxes only ever sees its own group messages, and
   * because they are not necessarily all in the same group.
   */
  groups: Record<string, string[]>
  /** True while at least one lookup is in flight, so the UI can say so. */
  busy: boolean
}

export const EMPTY_ROSTER: RosterState = { known: {}, groups: {}, busy: false }

/** `War/Rng/Brd`, or null when we have nothing to show. */
export function classLine(id: Identity | undefined | null): string | null {
  if (!id || id.classes.length === 0) return null
  return id.classes.join('/')
}

/** Full names for a tooltip: `Warrior · Ranger · Bard`. */
export function classTitle(id: Identity | undefined | null): string | null {
  if (!id || id.classes.length === 0) return null
  return id.classes.map((c) => CLASS_NAMES[c] ?? c).join(' · ')
}

export interface PartyView {
  /** The group the focus character is in. Contains the focus even when alone. */
  members: string[]
  /** Logs being tailed that are NOT in that group - boxed, but playing apart. */
  alsoOnline: string[]
  /** Whose group this is. Null when nothing is being tailed at all. */
  focus: string | null
}

/**
 * Who you are actually grouped with.
 *
 * A party is a property of a character, not of the app. Reading two logs is not
 * evidence that the two characters are grouped - people box alts that are
 * nowhere near each other, run a second account for a different camp, or leave
 * a mule parked in the Bazaar. Seeding the party with "every log I happen to be
 * reading" claimed a group that did not exist, so it is done from the group
 * events instead, anchored on one character.
 *
 * The graph is treated as undirected. Each log records who it saw join, never
 * itself, so "Hexzo's log saw Braxus join" and "Braxus's log saw Hexzo join"
 * are the same fact reported from two ends - and either end alone is enough.
 * That matters when a log was started mid-session and so missed the joins that
 * the others caught.
 *
 * Everyone else being tailed comes back under `alsoOnline`, because they are
 * still worth showing - just not as your group.
 */
export function partyOf(
  state: RosterState,
  characters: string[],
  focus?: string | null
): PartyView {
  const anchor = focus && characters.includes(focus) ? focus : (characters[0] ?? null)
  if (!anchor) return { members: [], alsoOnline: [], focus: null }

  const adjacent = new Map<string, Set<string>>()
  const link = (a: string, b: string): void => {
    if (!adjacent.has(a)) adjacent.set(a, new Set())
    adjacent.get(a)?.add(b)
  }
  for (const [log, members] of Object.entries(state.groups)) {
    for (const m of members) {
      link(log, m)
      link(m, log)
    }
  }

  // The connected component containing the anchor, which is the group.
  const members = new Set<string>([anchor])
  const queue = [anchor]
  while (queue.length > 0) {
    const who = queue.shift() as string
    for (const m of adjacent.get(who) ?? []) {
      if (members.has(m)) continue
      members.add(m)
      queue.push(m)
    }
  }

  const rank = (name: string): number => {
    if (name === anchor) return -1
    const i = characters.indexOf(name)
    // Your own characters after the anchor, in their configured order, then
    // guests - who are the people whose names you are least sure of.
    return i < 0 ? 99 : i
  }

  return {
    members: [...members].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)),
    alsoOnline: characters.filter((c) => !members.has(c)),
    focus: anchor
  }
}
