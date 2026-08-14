import { coinToCopper } from '../loot'
import type { Actor, ParsedEvent, RawLine } from './types'

/**
 * The pattern table.
 *
 * Ordered: the first rule that matches wins, so specific forms sit above
 * general ones. Anything that matches nothing becomes `unparsed` and is kept -
 * that is what the combat log's "show unparsed" toggle reveals, and it is how
 * an alert rule can fire on a line the parser has no opinion about.
 *
 * ------------------------------------------------------------------------
 * A note on certainty. The formats below are the canonical Titanium/SoF-era
 * lines that EQEmu servers emit, and both first- and third-person variants are
 * covered because a trio reads three logs at once. Where a message changed
 * between client eras (DoT ticks and heals are the two that really did) BOTH
 * forms are listed - matching a form the client never writes costs nothing,
 * while missing one silently loses damage.
 *
 * Any rule marked VERIFY is one whose exact wording on Project Triune I have
 * not seen. They are written from the standard client strings; a real
 * eqlog_<Char>_multiclass.txt would confirm or correct them, and the fixtures
 * in tests/fixtures are where that confirmation gets encoded.
 * ------------------------------------------------------------------------
 */

/** Melee verbs, third-person -> first-person. Order matters: longest first, so
 *  "round kicks" is not eaten by "kicks". */
const MELEE_VERBS: Array<[third: string, first: string]> = [
  ['dragon punches', 'dragon punch'],
  ['eagle strikes', 'eagle strike'],
  ['flying kicks', 'flying kick'],
  ['round kicks', 'round kick'],
  ['tiger claws', 'tiger claw'],
  ['frenzies on', 'frenzy on'],
  ['backstabs', 'backstab'],
  ['punches', 'punch'],
  ['crushes', 'crush'],
  ['pierces', 'pierce'],
  ['slashes', 'slash'],
  ['slices', 'slice'],
  ['claws', 'claw'],
  ['bashes', 'bash'],
  ['bites', 'bite'],
  ['gores', 'gore'],
  ['kicks', 'kick'],
  ['mauls', 'maul'],
  ['hits', 'hit'],
  ['strikes', 'strike']
]

const THIRD_TO_FIRST = new Map(MELEE_VERBS)
const VERBS_THIRD = MELEE_VERBS.map(([t]) => t).join('|')
const VERBS_FIRST = MELEE_VERBS.map(([, f]) => f).join('|')

/** Canonicalise a swing verb to its first-person form, so "slashes" and
 *  "slash" aggregate into one row in the breakdown rather than two. */
function skillOf(verb: string): string {
  return THIRD_TO_FIRST.get(verb) ?? verb
}

/** Context the matcher needs to resolve "you"/"your" and pet ownership. */
export interface ParseContext {
  /** The character who owns this log - what "You" means here. */
  self: string
  /** Pet name -> owner. Learned from pet-leader lines and `/pet` messages. */
  petOwners: Map<string, string>
  /**
   * Names known to be players: the characters being boxed, plus anyone seen in
   * a /who. Shared across logs, and the reason mob detection can default the
   * other way - see `actor`.
   */
  players?: Set<string>
}

/** Names that appear in logs as the second person. */
function isSelfWord(name: string): boolean {
  const n = name.toLowerCase()
  return n === 'you' || n === 'your' || n === 'yourself'
}

/**
 * "herself", "itself" - a target that means "whoever did it".
 *
 * Kept separate from `isSelfWord` because these are third-person: they resolve
 * to the actor named earlier in the same line, not to the log's owner. Without
 * this, "Hexzo has healed herself" recorded a heal on a mob called `herself`.
 */
const REFLEXIVE = new Set(['himself', 'herself', 'itself', 'themselves', 'themself'])

/**
 * Classify a name.
 *
 * MOB IS THE DEFAULT, and that is a correction, not a shortcut. The obvious
 * rule - "NPC names start with an article" - is true of classic EverQuest and
 * false here: on Project Triune the mobs are proper nouns ("Gindan Flayer",
 * "Diaku Elite Sentry"), so an article test leaves nearly every real mob
 * unclassified. Since an encounter only opens on damage involving a mob, that
 * one wrong assumption meant real fights never registered at all, while the
 * synthetic test logs - which did use articles - worked perfectly.
 *
 * So the positive cases are enumerated instead: you, your pets, and names
 * known to be players. Anything left is a mob.
 */
function actor(name: string, ctx: ParseContext): Actor {
  if (isSelfWord(name)) return { name: ctx.self, kind: 'self' }

  // A log naming its own character IS the first person, whatever grammar the
  // line happens to use. Project Triune writes melee in the second person ("You
  // hit ...") but attributed spell and proc damage in the third ("Hexzo hit
  // Diaku Guardian for 950 points of non-melee damage. (Time Rend)") - in
  // Hexzo's own log, about Hexzo.
  //
  // Without this those lines came back as `player`, and the merge rule drops a
  // boxed character seen from somebody else's log as a duplicate. There was no
  // other log: the only copy was the one it had just discarded. The effect was
  // that every spell, proc and damage shield vanished from the meter while
  // melee, being first-person, sailed through - so the app read as working and
  // was quietly reporting melee-only totals.
  if (name === ctx.self) return { name, kind: 'self' }

  const owner = ctx.petOwners.get(name)
  if (owner) return { name, kind: 'pet', owner }

  if (ctx.players?.has(name)) return { name, kind: 'player' }

  return { name, kind: 'mob' }
}

interface Rule {
  re: RegExp
  build: (m: RegExpExecArray, line: RawLine, ctx: ParseContext) => ParsedEvent | null
}

function base(line: RawLine, kind: ParsedEvent['kind']): ParsedEvent {
  return { kind, ts: line.ts, seq: line.seq, source: line.source, raw: line.raw }
}

/**
 * A group-membership line.
 *
 * The side effect is the valuable half. `actor()` calls every unrecognised name
 * a mob, which is right on a server whose mobs are proper nouns - but it means a
 * group-mate's swings would be counted as the enemy's until something proves
 * they are a player. Being named in a group message is exactly that proof, and
 * it arrives the moment they join rather than whenever somebody remembers to
 * type /who.
 */
/**
 * A heal, or an absorb, which share a shape.
 *
 * Resolves the reflexive target here rather than in `actor()` so the rule that
 * knows who the healer is, is the rule that resolves "herself" - `actor()` sees
 * one name at a time and has nothing to resolve it against.
 */
function healEvent(
  line: RawLine,
  ctx: ParseContext,
  healer: string,
  healed: string,
  amount: number,
  skill?: string
): ParsedEvent {
  const attacker = actor(healer, ctx)
  const target = REFLEXIVE.has(healed.toLowerCase()) ? attacker : actor(healed, ctx)
  return { ...base(line, 'heal'), attacker, target, skill: skill ?? 'Heal', amount }
}

function groupEvent(
  line: RawLine,
  ctx: ParseContext,
  change: NonNullable<ParsedEvent['group']>,
  who?: string
): ParsedEvent {
  if (who === undefined || isSelfWord(who)) {
    return { ...base(line, 'group'), group: change, target: { name: ctx.self, kind: 'self' } }
  }
  ctx.players?.add(who)
  return { ...base(line, 'group'), group: change, target: { name: who, kind: 'player' } }
}

/** Chat verb as the client writes it -> the channel it belongs to. */
const CHANNELS: Record<string, string> = {
  auctions: 'auction',
  shouts: 'shout',
  says: 'say',
  'says out of character': 'ooc',
  'tells the guild': 'guild',
  'tells the raid': 'raid'
}

const RULES: Rule[] = [
  // ---- Melee, first person: "You slash a gnoll for 45 points of damage." ----
  {
    re: new RegExp(`^You (${VERBS_FIRST}) (.+?) for (\\d+) points? of damage\\.$`),
    build: (m, line, ctx) => ({
      ...base(line, 'melee'),
      attacker: actor('you', ctx),
      target: actor(m[2], ctx),
      skill: skillOf(m[1]),
      amount: Number(m[3])
    })
  },

  // ---- Melee, third person: "Braxus slashes a gnoll for 45 points of damage." ----
  {
    re: new RegExp(`^(.+?) (${VERBS_THIRD}) (.+?) for (\\d+) points? of damage\\.$`),
    build: (m, line, ctx) => ({
      ...base(line, 'melee'),
      attacker: actor(m[1], ctx),
      target: actor(m[3], ctx),
      skill: skillOf(m[2]),
      amount: Number(m[4])
    })
  },

  // ---- Avoided swings ----
  // "You try to slash a gnoll, but miss!"
  // "You try to slash a gnoll, but a gnoll parries!"
  {
    re: new RegExp(`^You try to (${VERBS_FIRST}) (.+?), but (.+)!$`),
    build: (m, line, ctx) => ({
      ...base(line, 'miss'),
      attacker: actor('you', ctx),
      target: actor(m[2], ctx),
      skill: skillOf(m[1]),
      avoidance: avoidanceOf(m[3])
    })
  },
  // "a gnoll tries to hit Braxus, but Braxus dodges!"
  {
    re: new RegExp(`^(.+?) tries to (${VERBS_FIRST}) (.+?), but (.+)!$`),
    build: (m, line, ctx) => ({
      ...base(line, 'miss'),
      attacker: actor(m[1], ctx),
      target: actor(m[3], ctx),
      skill: skillOf(m[2]),
      avoidance: avoidanceOf(m[4])
    })
  },

  // ---- Attributed spell damage, the form this server actually writes:
  //      "Hexzo hit Gindan Flayer for 20147 points of non-melee damage.
  //       (Cry of Thunder Strike)"
  //
  //      This is far better than the classic "<target> was hit by non-melee"
  //      line, because it names both the caster AND the spell - no heuristic
  //      needed. It sits above the damage-shield rule because a shield line
  //      has the same tail but a different shape. ----
  {
    re: /^(.+?) hit (.+?) for (\d+) points? of non-melee damage\.(?:\s*\((.+?)\))?$/,
    build: (m, line, ctx) => ({
      ...base(line, 'spell'),
      attacker: actor(m[1], ctx),
      target: actor(m[2], ctx),
      amount: Number(m[3]),
      skill: m[4] ?? undefined
    })
  },
  // First-person variant of the same message.
  {
    re: /^You hit (.+?) for (\d+) points? of non-melee damage\.(?:\s*\((.+?)\))?$/,
    build: (m, line, ctx) => ({
      ...base(line, 'spell'),
      attacker: actor('you', ctx),
      target: actor(m[1], ctx),
      amount: Number(m[2]),
      skill: m[3] ?? undefined
    })
  },

  // ---- Damage shield: "a gnoll is pierced by YOUR thorns for 12 points of
  //      non-melee damage." The shield belongs to the person being hit. ----
  {
    re: /^(.+?) is (?:\w+) by (YOUR|.+?'s) (.+?) for (\d+) points? of non-melee damage\.$/,
    build: (m, line, ctx) => ({
      ...base(line, 'spell'),
      attacker: actor(m[2] === 'YOUR' ? 'you' : m[2].replace(/'s$/, ''), ctx),
      target: actor(m[1], ctx),
      skill: 'Damage shield',
      amount: Number(m[4])
    })
  },

  // ---- DoT tick, SoF-era: "a gnoll has taken 45 damage from your Flame of Light." ----
  {
    re: /^(.+?) has taken (\d+) damage from your (.+?)\.$/,
    build: (m, line, ctx) => ({
      ...base(line, 'dot'),
      attacker: actor('you', ctx),
      target: actor(m[1], ctx),
      skill: m[3],
      amount: Number(m[2])
    })
  },
  // ---- DoT tick, third person: "a gnoll has taken 45 damage from Flame of
  //      Light by Braxus." VERIFY: era-dependent wording. ----
  {
    re: /^(.+?) has taken (\d+) damage from (.+?) by (.+?)\.$/,
    build: (m, line, ctx) => ({
      ...base(line, 'dot'),
      attacker: actor(m[4], ctx),
      target: actor(m[1], ctx),
      skill: m[3],
      amount: Number(m[2])
    })
  },

  // ---- Untargeted non-melee: "a gnoll was hit by non-melee for 300 points of
  //      damage." The line names no caster, which is a real limit of the log
  //      format, not an oversight here. The encounter layer attributes it to
  //      the most recent caster in this log; see encounter.ts. ----
  {
    // `were`, not just `was`. The second person conjugates: everyone else "was
    // hit by non-melee", you "were" - so the singular rule silently dropped
    // every point of untargeted spell damage that landed on your own
    // characters, which is the half a defensive player most wants to see.
    re: /^(.+?) (?:was|were) hit by non-melee for (\d+) points? of damage\.$/,
    build: (m, line, ctx) => ({
      ...base(line, 'spell'),
      target: actor(m[1], ctx),
      amount: Number(m[2])
    })
  },

  // ---- Incoming damage that names its source but no attacker:
  //      "A Barbed arrow penetrates your armor.  You have taken 302 points of
  //      damage." Two sentences, one event; the double space is the client's. ----
  {
    re: /^(.+?) penetrates your armor\. {1,2}You have taken (\d+) points? of damage\.$/,
    build: (m, line, ctx) => ({
      ...base(line, 'spell'),
      target: actor('you', ctx),
      skill: m[1].trim(),
      amount: Number(m[2])
    })
  },

  // ---- Crit annotations. The damage lands on its own separate line, so this
  //      only flags that the NEXT damage from this attacker was critical. ----
  // "You deliver a critical blow! (450)", "You deliver a critical blast! (9001)
  //  (Cry of Thunder Strike)" - spell crits name the spell, melee crits don't.
  {
    re: /^You (?:deliver a critical (?:blow|blast)|score a critical hit)! ?\((\d+)\)(?:\s*\((.+?)\))?$/,
    build: (m, line, ctx) => ({
      ...base(line, 'crit'),
      attacker: actor('you', ctx),
      amount: Number(m[1]),
      skill: m[2] ?? undefined
    })
  },
  {
    /*
     * The third-person forms, which have to mirror the first-person rule above
     * exactly. It matched "You deliver a critical blast!" but the group-mate
     * version - "Incredibaal delivers a critical blast! (2856) (Bladewhirl)" -
     * only matched "scores a critical hit", so every spell crit anybody else in
     * the trio landed was invisible while your own were counted. The
     * first-person form fires around a hundred times a day, so the two were
     * never going to be spotted by eye.
     */
    re: /^(.+?) (?:delivers a critical (?:blow|blast)|scores a critical hit)! ?\((\d+)\)(?:\s*\((.+?)\))?$/,
    build: (m, line, ctx) => ({
      ...base(line, 'crit'),
      attacker: actor(m[1], ctx),
      amount: Number(m[2]),
      skill: m[3] ?? undefined
    })
  },
  // ---- A damage-over-time crit, which the client words differently again:
  //      "Your fiery affliction rages out of control upon X! (1250) (Spell)" ----
  {
    re: /^Your (.+?) rages out of control upon (.+?)! ?\((\d+)\)(?:\s*\((.+?)\))?$/,
    build: (m, line, ctx) => ({
      ...base(line, 'crit'),
      attacker: actor('you', ctx),
      target: actor(m[2], ctx),
      amount: Number(m[3]),
      skill: m[4] ?? m[1]
    })
  },

  /**
   * ---- Heals ----
   *
   * Corrected against a real log, and it needed correcting twice over. The
   * wording this server uses is
   *
   *   "Hexzo has healed herself for 1841 points of damage. (Killing Spree)"
   *
   * - "points of damage" for a heal, and a trailing spell name. The old rule
   * anchored the line at `damage.` with `$`, so every heal on the server failed
   * to match and the Heals tab was empty for reasons that had nothing to do
   * with healing. The reflexive target was the second problem: `herself` is not
   * a self-word, so it fell through to the default and the healer was recorded
   * as healing a mob called "herself".
   *
   * Worth knowing: heal amounts are thin on this server generally. Two players
   * in this very log are in OOC complaining they cannot see healing numbers at
   * all, so an empty Heals tab is sometimes the honest answer rather than a
   * parser fault - which is exactly why the rules had to be made right, so the
   * two cases can be told apart.
   */
  {
    re: /^(.+?) healed (.+?) for (\d+) hit points?(?: by (.+?))?\.$/,
    build: (m, line, ctx) => healEvent(line, ctx, m[1], m[2], Number(m[3]), m[4])
  },
  {
    re: /^(.+?) ha(?:ve|s) healed (.+?) for (\d+) points? of damage\.(?:\s*\((.+?)\))?$/,
    build: (m, line, ctx) => healEvent(line, ctx, m[1], m[2], Number(m[3]), m[4])
  },
  // A crit heal. Names no target and no spell, but the amount is real and
  // leaving it out understates the healer.
  {
    re: /^You perform an exceptional heal! ?\((\d+)\)$/,
    build: (m, line, ctx) => ({
      ...healEvent(line, ctx, 'you', 'you', Number(m[1])),
      critical: true
    })
  },

  /**
   * ---- Absorbed damage ----
   *
   * "Hexzo has shielded herself from 214 points of damage. (Shield of Songs)"
   *
   * Not healing and not damage: damage that never landed. 150 of these in a
   * day's play against 22 heals, so on this server it is the larger half of
   * the mitigation story and it was being thrown away entirely.
   */
  {
    re: /^(.+?) ha(?:ve|s) shielded (.+?) from (\d+) points? of damage\.(?:\s*\((.+?)\))?$/,
    build: (m, line, ctx) => ({
      ...healEvent(line, ctx, m[1], m[2], Number(m[3]), m[4]),
      kind: 'absorb' as const
    })
  },

  // ---- Resists ----
  {
    re: /^Your target resisted the (.+?) spell\.$/,
    build: (m, line, ctx) => ({
      ...base(line, 'resist'),
      attacker: actor('you', ctx),
      skill: m[1],
      detail: m[1]
    })
  },
  {
    re: /^(.+?) resisted your (.+?)!$/,
    build: (m, line, ctx) => ({
      ...base(line, 'resist'),
      attacker: actor('you', ctx),
      target: actor(m[1], ctx),
      skill: m[2],
      detail: m[2]
    })
  },

  // ---- Casting. Needed for attributing the untargeted non-melee line above. ----
  {
    re: /^You begin casting (.+?)\.$/,
    build: (m, line, ctx) => ({
      ...base(line, 'cast'),
      attacker: actor('you', ctx),
      skill: m[1],
      detail: m[1]
    })
  },

  // ---- Deaths ----
  {
    re: /^You have slain (.+?)!$/,
    build: (m, line, ctx) => ({
      ...base(line, 'death'),
      attacker: actor('you', ctx),
      target: actor(m[1], ctx)
    })
  },
  {
    re: /^(.+?) has been slain by (.+?)!$/,
    build: (m, line, ctx) => ({
      ...base(line, 'death'),
      attacker: actor(m[2], ctx),
      target: actor(m[1], ctx)
    })
  },
  {
    re: /^You have been slain by (.+?)!$/,
    build: (m, line, ctx) => ({
      ...base(line, 'death'),
      attacker: actor(m[1], ctx),
      target: actor('you', ctx)
    })
  },

  // ---- Pet ownership. This is how a pet's damage reaches its owner's row. ----
  {
    re: /^(.+?) says,? ['"]My leader is (.+?)\.?['"]$/,
    build: (m, line, ctx) => {
      ctx.petOwners.set(m[1], isSelfWord(m[2]) ? ctx.self : m[2])
      return { ...base(line, 'chat'), attacker: { name: m[1], kind: 'pet', owner: m[2] } }
    }
  },

  // ---- Progression. Note what is NOT here: an XP amount. EverQuest reports
  //      that experience was gained, never how much, so the Leveling page
  //      charts levels, AA and rates rather than a fabricated percentage. ----
  {
    re: /^You have gained a level! Welcome to level (\d+)!$/,
    build: (m, line) => ({ ...base(line, 'level'), amount: Number(m[1]), detail: m[1] })
  },
  {
    re: /^You have gained an ability point!.*?(\d+) ability point/,
    build: (m, line) => ({ ...base(line, 'aa'), amount: Number(m[1]) })
  },
  {
    re: /^You gain (?:party |raid |group )?experience!!?$/,
    build: (_m, line) => base(line, 'xp')
  },
  /**
   * "You gain bonus AA experience! (5087/18850)"
   *
   * The one message on this server that carries actual numbers, and it changes
   * what the Leveling page can honestly say. Regular experience really is
   * unquantified - the game states that you gained some and never how much -
   * but this pair is right there in the log, 142 times in a single day's play.
   *
   * What the numbers are was settled by reading them rather than assuming:
   * across the whole log the first rises by exactly one each time "You have
   * gained an ability point!" appears, and the second never moves. So the pair
   * is AA points earned out of AA points available - NOT progress toward the
   * next point, which is what it looks like at a glance and what a rate built
   * on that assumption would have quietly got wrong.
   *
   * Note it is a different quantity from the `aa` event, whose amount is the
   * UNSPENT total. Hexzo reads 23 unspent and 5,087 earned; showing the first
   * as though it were the second undersells the character by two orders of
   * magnitude.
   */
  {
    re: /^You gain bonus AA experience! ?\((\d+)\/(\d+)\)$/,
    build: (m, line) => ({ ...base(line, 'aaxp'), amount: Number(m[1]), outOf: Number(m[2]) })
  },

  // ---- Loot ----
  // Strings 466 and 467, `--%1 has looted a %2.--` and `--You have looted a
  // %1.--`, dashes and all. The discovery line is not in the string table
  // because it is the server's own broadcast, not a client message; it was read
  // off a real log, where it is far and away the commonest way an item name
  // reaches you.
  {
    re: /^--You have looted a (.+?)\.--$/,
    build: (m, line, ctx) => ({
      ...base(line, 'loot'),
      attacker: actor('you', ctx),
      item: m[1]
    })
  },
  {
    re: /^--(.+?) has looted a (.+?)\.--$/,
    build: (m, line, ctx) => ({
      // No attacker, so the merge rule counts this from the primary log only -
      // a line about somebody else is written to all three of your logs.
      ...base(line, 'loot'),
      target: actor(m[1], ctx),
      item: m[2]
    })
  },
  {
    re: /^(.+?) has discovered: (.+?) \((.+?)\)\.$/,
    build: (m, line, ctx) => ({
      ...base(line, 'loot'),
      target: actor(m[1], ctx),
      item: m[2],
      tier: m[3],
      // Everybody on the server sees this, including about people you have
      // never met. Flagged so the stream can leave it out by default.
      broadcast: true
    })
  },
  {
    /*
     * The other discovery wording, which carries a category instead of a tier
     * and quotes the item: `X has discovered: Glamour - 'Hat of Whimsy'.`
     * Nearly as common as the tiered form and matched by none of the rules
     * above, because they all require parentheses.
     */
    re: /^(.+?) has discovered: (.+?) - '(.+?)'\.$/,
    build: (m, line, ctx) => ({
      ...base(line, 'loot'),
      target: actor(m[1], ctx),
      item: m[3],
      tier: m[2],
      broadcast: true
    })
  },

  /**
   * ---- Money ----
   *
   * Two streams, one event kind, because they are the same fact: copper
   * arrived. Whether an item name came with it is what separates a corpse from
   * the server's auto-sell, and that is one optional field rather than two
   * parallel code paths.
   *
   * The coin phrase is parsed rather than matched unit by unit - "2 gold, 7
   * silver, 3 copper", "4 gold, 1 silver" and "5 platinum" are all the same
   * message with different units present, and enumerating the combinations
   * would be sixteen rules that all mean one thing.
   */
  {
    re: /^\[NMS\] (.+?) sold for (\d+ (?:platinum|gold|silver|copper).*?)\.$/,
    build: (m, line, ctx) => {
      const copper = coinToCopper(m[2])
      if (copper === null) return null
      return { ...base(line, 'coin'), attacker: actor('you', ctx), item: m[1], amount: copper }
    }
  },
  {
    // Anchored on a digit so "You receive no coin." falls through - it is a
    // real message meaning zero, and recording it as a drop of nothing would
    // bury the actual drops in an ocean of empty rows.
    re: /^You receive (\d+ (?:platinum|gold|silver|copper).*?)\.$/,
    build: (m, line, ctx) => {
      const copper = coinToCopper(m[1])
      if (copper === null) return null
      return { ...base(line, 'coin'), attacker: actor('you', ctx), amount: copper }
    }
  },

  // ---- Zoning ----
  {
    re: /^You have entered (.+?)\.$/,
    build: (m, line) => ({ ...base(line, 'zone'), detail: m[1] })
  },

  /**
   * ---- Named hit modifiers ----
   *
   * The same shape as a critical: a line announcing that something special
   * happened, followed by the hit it happened to. They chain, too - a real
   * sequence from the log runs
   *
   *   Your bow shot did double dmg.
   *   Hexzo scores a critical hit! (13694)
   *   You hit Diaku Guardian for 13694 points of damage.
   *
   * so the encounter layer holds them until damage arrives rather than pairing
   * with the very next line. The payoff is visible: the hit after a FATAL BOW
   * SHOT in this log was 186,954, against a 13,694 ordinary crit.
   *
   * "You go on a killing spree!" is deliberately absent. It is a streak
   * announcement rather than a modifier on the next hit, and treating it as one
   * would credit an unrelated swing with something it did not do.
   */
  {
    re: /^Your bow shot did double dmg\.$/,
    build: (_m, line, ctx) => ({
      ...base(line, 'special'),
      attacker: actor('you', ctx),
      skill: 'Double bow shot'
    })
  },
  {
    re: /^You strike through your opponent's defenses!$/,
    build: (_m, line, ctx) => ({
      ...base(line, 'special'),
      attacker: actor('you', ctx),
      skill: 'Strikethrough'
    })
  },
  {
    re: /^(.+?) scores a Finishing Blow!!$/,
    build: (m, line, ctx) => ({
      ...base(line, 'special'),
      attacker: actor(m[1], ctx),
      skill: 'Finishing Blow'
    })
  },
  {
    re: /^(.+?) performs a FATAL BOW SHOT!!$/,
    build: (m, line, ctx) => ({
      ...base(line, 'special'),
      attacker: actor(m[1], ctx),
      skill: 'Fatal Bow Shot'
    })
  },

  // ---- Group membership ----
  // Not VERIFY, and unusually for this file not reconstructed from memory
  // either: every string below was read out of the client's own string table,
  // `eqstr_us.txt`, in the NMS Client folder. The ids are 1399 (joined),
  // 12001-12005 (removed / disbanded / formed / joined / left), 12283 (agree to
  // join) and 12287 (remove from party). If the client can print it, it is
  // printed in exactly this wording.
  //
  // Why bother: a log never states what class anybody is, so knowing WHO is in
  // the group is what lets the app go and ask PTDex. It also teaches the
  // parser that those names are players, which changes how their damage is
  // counted.
  {
    re: /^(.+?) has joined the group\.$/,
    build: (m, line, ctx) => groupEvent(line, ctx, 'join', m[1])
  },
  {
    re: /^(.+?) has left the group\.$/,
    build: (m, line, ctx) => groupEvent(line, ctx, 'leave', m[1])
  },
  {
    re: /^You remove (.+?) from the party\.$/,
    build: (m, line, ctx) => groupEvent(line, ctx, 'leave', m[1])
  },
  // Agreeing to an invitation puts you in THEIR group, so the person who
  // invited you is a group-mate - and this is the only line that names them.
  {
    re: /^You notify (.+?) that you agree to join the group\.$/,
    build: (m, line, ctx) => groupEvent(line, ctx, 'join', m[1])
  },
  {
    re: /^You have formed the group\.$/,
    build: (_m, line, ctx) => groupEvent(line, ctx, 'form')
  },
  {
    re: /^You have joined the group\.$/,
    build: (_m, line, ctx) => groupEvent(line, ctx, 'join')
  },
  {
    re: /^Your group has been disbanded\.$/,
    build: (_m, line, ctx) => groupEvent(line, ctx, 'disband')
  },
  {
    re: /^You have been removed from the group\.$/,
    build: (_m, line, ctx) => groupEvent(line, ctx, 'disband')
  },
  // String 1414, `%1 tells the group,%2 '%3'`. Anyone who speaks in group chat
  // is in your group by definition, and this is the recovery path for the case
  // the join lines cannot cover: the app started hours after the group formed,
  // so the join itself scrolled out of the history scan and no line will ever
  // announce it again.
  //
  // Filed as `chat` rather than `group` so the line still reads normally in the
  // stream - the membership is a side effect, not the point of the message.
  {
    re: /^(.+?) tells the group,/,
    build: (m, line, ctx) => ({ ...groupEvent(line, ctx, 'join', m[1]), kind: 'chat' })
  },

  // ---- /who ----
  // "[65 Warlord] Hexzo (Human) <Guild Name>" - and the anonymous form, which
  // carries no level.
  //
  // This matters more than it looks: a character's level is otherwise only
  // knowable from a ding, so someone who has not levelled since installing the
  // app would read "level unknown" forever. A /who is something players type
  // constantly, and it states the level outright.
  {
    re: /^\[(\d+) ([A-Za-z' ]+)\] (\S+) \((.+?)\)/,
    build: (m, line) => ({
      ...base(line, 'who'),
      target: { name: m[3], kind: 'player' },
      amount: Number(m[1]),
      skill: m[2].trim(),
      detail: m[4]
    })
  },

  /**
   * ---- Server-wide blessings ----
   *
   * The server's own broadcast, not a client string, and unusually generous:
   * it states the remaining duration outright, which almost nothing else in
   * EverQuest does.
   *
   *   A server-wide blessing of [Echo of Experience] has been
   *   activated/extended! Remaining duration: 7 hours 32 minutes.
   *
   * `amount` is that remainder in milliseconds, measured from this line's own
   * timestamp - which is what makes the countdown survive a restart.
   */
  {
    re: /^A server-wide blessing of \[(.+?)\] has been activated\/extended! Remaining duration: (?:(\d+) hours? )?(?:(\d+) minutes?)?\.?$/,
    build: (m, line) => ({
      ...base(line, 'blessing'),
      detail: m[1],
      amount: (Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60) * 1000
    })
  },
  /*
   * The two lines about YOU rather than about the world.
   *
   * These are the ones you actually see when you take world buffs, and they
   * are far commoner than the broadcast above - which only fires when somebody
   * activates or extends a blessing, possibly hours before you logged in. They
   * carry no name and no duration, so they cannot fill the blessing table;
   * what they prove is that the buffs are on you right now, which is the
   * question somebody who just clicked the NPC is actually asking.
   *
   * Marked on `skill` so the personal pair can never be mistaken for a named
   * blessing, whose name lives on `detail`.
   */
  {
    re: /^Your senses are tingling\. \(Global buffs being applied to you in (\d+) seconds?\)$/,
    build: (m, line) => ({ ...base(line, 'blessing'), skill: 'incoming', amount: Number(m[1]) * 1000 })
  },
  {
    re: /^You feel a surge of power\. \(Global buffs have been applied to you\)$/,
    build: (_m, line) => ({ ...base(line, 'blessing'), skill: 'applied' })
  },

  /**
   * ---- Server broadcasts about other people ----
   *
   * Three shapes, all server-generated. The level and server-first lines name
   * the whole trio; the first-login line names only one class, which is a real
   * limit rather than an oversight - see shared/census.ts.
   */
  {
    re: /^(.+?) \((.+?)\) has logged in for the first time\.$/,
    build: (m, line) => ({
      ...base(line, 'census'),
      census: 'login',
      target: { name: m[1], kind: 'player' },
      detail: m[2]
    })
  },
  {
    re: /^(.+?) \((.+?)\) has reached Level (\d+)\.$/,
    build: (m, line) => ({
      ...base(line, 'census'),
      census: 'level',
      target: { name: m[1], kind: 'player' },
      detail: m[2],
      amount: Number(m[3])
    })
  },
  {
    re: /^(.+?) has become the FIRST (.+?)\.$/,
    build: (m, line) => ({
      ...base(line, 'census'),
      census: 'first',
      target: { name: m[1], kind: 'player' },
      detail: m[2]
    })
  },

  /**
   * ---- Away from keyboard ----
   *
   * Both pairs are server-generated and appear in neither eqstr_us.txt nor any
   * client string table, so the wording is unversioned - if the server changes
   * it, these stop matching silently. `idle` is a connection state rather than
   * evidence anybody left, so it is recorded separately and weighted less.
   */
  {
    re: /^You are (now|no longer) AFK\.$/,
    build: (m, line) => ({ ...base(line, 'afk'), away: m[1] === 'now', detail: 'afk' })
  },
  {
    re: /^You are now idle\. Updates will be sent to you less frequently\.$/,
    build: (_m, line) => ({ ...base(line, 'afk'), away: true, detail: 'idle' })
  },
  {
    re: /^You are no longer idle\.$/,
    build: (_m, line) => ({ ...base(line, 'afk'), away: false, detail: 'idle' })
  },

  /**
   * ---- Target changes and considers ----
   *
   * `Targeted (%1): %2` is string 6780. The bracketed word is the kind of
   * thing - NPC, PC, Corpse - and a corpse carries a possessive suffix that
   * the dossier strips, because "Diaku Guardian's corpse" and "Diaku Guardian"
   * are the same bestiary entry.
   */
  {
    re: /^Targeted \((.+?)\): (.+)$/,
    build: (m, line, ctx) => ({
      ...base(line, 'target'),
      detail: m[1],
      target: actor(m[2].replace(/'s corpse$/, ''), ctx)
    })
  },
  {
    // Strings 12216/12217. Two clauses: how it feels about you, and whether you
    // can take it. The second is the useful half.
    re: /^(.+?) (regards you indifferently|scowls at you, ready to attack|glares at you threateningly|looks upon you warmly|judges you amiably|kindly considers you|looks your way apprehensively) -- (.+?)$/,
    build: (m, line, ctx) => ({
      ...base(line, 'con'),
      target: actor(m[1], ctx),
      skill: m[2],
      detail: m[3].replace(/\.$/, '')
    })
  },

  /**
   * ---- Chat, by channel ----
   *
   * Last in the table on purpose: several rules above match specific things
   * somebody said, and a general chat rule placed before them would swallow
   * every one. The channel is captured because an auction watcher cares about
   * WHERE something was said, and re-deriving that from the text later would
   * mean parsing the same line twice.
   */
  {
    re: /^(.+?) (auctions|shouts|says out of character|says|tells the guild|tells the raid), ['"](.+)['"]$/,
    build: (m, line, ctx) => ({
      ...base(line, 'chat'),
      attacker: actor(m[1], ctx),
      // The verb is conjugated - "auctions", "shouts" - and the channel is not.
      // Normalised here so downstream code compares against a channel name
      // rather than against a piece of English grammar.
      channel: CHANNELS[m[2]] ?? m[2],
      detail: m[3]
    })
  }
]

function avoidanceOf(clause: string): ParsedEvent['avoidance'] {
  const c = clause.toLowerCase()
  if (c.includes('dodge')) return 'dodge'
  if (c.includes('parr')) return 'parry'
  if (c.includes('riposte')) return 'riposte'
  if (c.includes('block') || c.includes('shield')) return 'block'
  if (c.includes('invulnerable')) return 'invulnerable'
  if (c.includes('absorb') || c.includes('magical skin')) return 'absorb'
  return 'miss'
}

/**
 * Match one tokenised line. Always returns an event: unmatched lines come back
 * as `unparsed` so nothing is silently dropped.
 */
export function parseLine(line: RawLine, ctx: ParseContext): ParsedEvent {
  for (const rule of RULES) {
    const m = rule.re.exec(line.body)
    if (!m) continue
    const ev = rule.build(m, line, ctx)
    if (ev) return ev
  }
  return base(line, 'unparsed')
}

/** Exposed for the tests, which assert the table stays ordered specific-first. */
export const RULE_COUNT = RULES.length
