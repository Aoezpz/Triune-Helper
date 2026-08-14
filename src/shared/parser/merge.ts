import type { ParsedEvent } from './types'

/**
 * The trio problem.
 *
 * When you box three characters, all three clients write a log, and a line
 * about anything other than your own swings appears in ALL THREE. Summing the
 * three logs triples the mob's damage, triples your group-mates' damage, and
 * produces a meter that is confidently wrong.
 *
 * The rule here is ownership: every event is counted from exactly one log.
 *
 *   * An event whose attacker is a log's own character is owned by that log.
 *     (Braxus's swings are counted from Braxus's log, where they are logged in
 *     the first person and are never truncated by distance.)
 *   * An event whose attacker is a log's own pet is owned by that log, for the
 *     same reason - and because this server allows one pet per pet-class in
 *     the trio, so pets are common and their damage is not small.
 *   * An event whose TARGET is a log's own character is owned by that log.
 *     "a Gladiator hits YOU" is written in the second person and therefore
 *     exists in the victim's log alone; every other log says "hits Braxus".
 *   * Everything else - mobs swinging at mobs, other players, unattributed
 *     non-melee - is owned by the PRIMARY log only.
 *
 * That third rule is not a refinement, it is a correctness fix for boxing more
 * than one account. Two characters at different camps are not in one group and
 * do not appear in each other's logs at all, so there is no duplicate to guard
 * against - and routing their incoming damage through a single primary log
 * threw away everything that happened to the other one. Ownership by target
 * costs nothing in the grouped case (exactly one log still counts each hit)
 * and is the whole answer in the ungrouped one.
 *
 * Order matters between the two. The attacker is asked first, because a heal
 * from one box to another is BOTH "attacker is another box" and "target is
 * me", and only the caster's log may count it.
 *
 * The result is exact rather than heuristic: no de-duplication by timestamp
 * and amount, which would wrongly collapse two identical simultaneous hits
 * (a real and frequent occurrence when two characters swing the same weapon
 * at the same mob in the same second).
 */

export interface MergeConfig {
  /** Log source id -> the character that log belongs to. */
  selfBySource: Map<string, string>
  /** The source that owns third-party events. */
  primarySource: string
  /** Pet name -> owner character, learned by the parser. */
  petOwners: Map<string, string>
}

/**
 * Should this event be counted, given which log it came from?
 *
 * Called once per event. Events that return false are still kept for display
 * in that character's own combat log - they are just not summed into totals.
 */
/**
 * Lines that are first-person statements about the character whose log they
 * are in. "You have gained a level!" is written to Vexthar's log about
 * Vexthar, and carries no attacker for the ownership rule to key on - so
 * without this they would all be attributed to the primary log and the other
 * two characters would appear never to level at all.
 */
const OWN_LOG_KINDS = new Set<ParsedEvent['kind']>([
  'level',
  'aa',
  'aaxp',
  'xp',
  // Money is written to the log of whoever received it, in the first person.
  'coin',
  'who',
  'group'
])

export function ownsEvent(ev: ParsedEvent, cfg: MergeConfig): boolean {
  const self = cfg.selfBySource.get(ev.source)
  if (self === undefined) return false

  if (OWN_LOG_KINDS.has(ev.kind)) return true

  const boxed = new Set(cfg.selfBySource.values())
  const { attacker, target } = ev

  /* Claim by attacker, first, so a heal between two boxes belongs to the
     caster's log and is not also claimed by the target's. */
  if (attacker) {
    if (attacker.kind === 'self') return true

    if (attacker.kind === 'pet') {
      const owner = attacker.owner ?? cfg.petOwners.get(attacker.name)
      if (owner === self) return true
      // A boxed character's pet is already counted from its owner's log, so
      // this copy is a duplicate even on the primary log.
      if (owner !== undefined && boxed.has(owner)) return false
      // Someone else's pet falls through to the target rules below - it may
      // still be hitting one of ours.
    } else if (boxed.has(attacker.name)) {
      // A boxed character seen from another box's log: that character's OWN
      // log owns those events, so this copy is a duplicate. Dropped whichever
      // log we are looking at, including the primary.
      //
      // Matched on the name rather than the kind on purpose: a boxed character
      // who is not in this log's `players` set parses as a mob, and dropping
      // the duplicate matters more than what it was labelled.
      return false
    }
  }

  /* Nothing above claimed it, so this is a mob or a stranger acting. Ask who
     it happened TO. */
  if (target) {
    if (target.kind === 'self') return true

    if (target.kind === 'pet') {
      const owner = target.owner ?? cfg.petOwners.get(target.name)
      // Damage to a boxed pet is counted once, from its owner's log.
      if (owner !== undefined && boxed.has(owner)) return owner === self
    } else if (boxed.has(target.name)) {
      // The third-person copy of a line that the victim's own log already
      // holds in the second person.
      return false
    }
  }

  // Mob on mob, stranger on stranger, or a line with no actors at all: no log
  // has a better claim, so the primary breaks the tie.
  return ev.source === cfg.primarySource
}

/** Filter a batch. Order is preserved. */
export function mergeEvents(events: ParsedEvent[], cfg: MergeConfig): ParsedEvent[] {
  return events.filter((e) => ownsEvent(e, cfg))
}
