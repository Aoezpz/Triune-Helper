/** Everything the parser produces. No Electron, no DOM - this file runs in vitest. */

/** One log line, split into its timestamp and its body. */
export interface RawLine {
  /** Epoch ms. EverQuest stamps to the second, so many lines share a value. */
  ts: number
  /** The line with the `[timestamp]` prefix removed. */
  body: string
  /** The complete original line, kept so the UI can show unparsed text verbatim. */
  raw: string
  /** Which log this came from, so trio merging can attribute it. */
  source: string
  /** Monotonic counter within a source, restoring order inside a shared second. */
  seq: number
}

export type EventKind =
  | 'melee' // a landed weapon swing
  | 'miss' // a swing that did not land (miss, dodge, parry, riposte, block, invulnerable)
  | 'spell' // direct spell/proc/damage-shield damage
  | 'dot' // a damage-over-time tick
  | 'heal'
  | 'absorb' // damage a shield stopped - prevented, not healed
  | 'resist'
  | 'crit' // a critical annotation; damage arrives on its own line
  | 'special' // a named hit modifier - finishing blow, fatal bow shot - same shape as a crit
  | 'cast' // began casting
  | 'death' // something died
  | 'zone'
  | 'level'
  | 'aa' // an ability point was earned; amount is the running UNSPENT total
  | 'aaxp' // the AA counter, "(5087/18850)" - amount earned out of `outOf`
  | 'xp'
  | 'who' // a /who line, which is how we learn a character's current level
  | 'group' // someone joined or left this log owner's group
  | 'loot' // an item changed hands, or was announced to the server
  | 'coin' // money in: off a corpse, or from the server auto-selling an item
  | 'chat'
  /** A server-wide buff was switched on or extended. `detail` names it. */
  | 'blessing'
  /** A server broadcast about somebody else: a first login, a ding, a race won. */
  | 'census'
  /** You went away from keyboard, or came back. */
  | 'afk'
  /** You changed target. */
  | 'target'
  /** A consider - the game's coarse read on whether you can win. */
  | 'con'
  | 'unparsed'

/** Whether a combatant is the log's owner, another player, a pet, or a mob. */
export type ActorKind = 'self' | 'player' | 'pet' | 'mob' | 'unknown'

export interface Actor {
  /** Display name. 'You' is normalised to the owning character's name. */
  name: string
  kind: ActorKind
  /** For pets, the owner's name once known. */
  owner?: string
}

export interface ParsedEvent {
  kind: EventKind
  ts: number
  seq: number
  source: string
  raw: string

  attacker?: Actor
  target?: Actor
  /** Skill, spell or proc name: 'slash', 'Flame of Light', 'Damage Shield'. */
  skill?: string
  amount?: number
  /** Melee swings that did not land carry why. */
  avoidance?: 'miss' | 'dodge' | 'parry' | 'riposte' | 'block' | 'absorb' | 'invulnerable'
  /** True when the preceding crit line applies to this damage. */
  critical?: boolean
  /**
   * Named modifiers the preceding annotation lines applied to this hit -
   * "Finishing Blow", "Double bow shot". Crits keep their own boolean because
   * the UI has treated them specially since before this existed.
   */
  mods?: string[]
  /** Zone name for `zone`, new level for `level`, spell name for `cast`/`resist`. */
  detail?: string
  /**
   * For `group`: what happened to the group belonging to THIS log's character.
   * `target` carries who it happened to; for `form` and `disband` that is the
   * log's own character, because those messages name nobody.
   */
  group?: 'join' | 'leave' | 'form' | 'disband'
  /** For `loot`: the item's name, which is what a tooltip is looked up by. */
  item?: string
  /**
   * For `loot`: the rarity a discovery broadcast carries ("Enchanted",
   * "Legendary"), and the flag that says this was a server-wide announcement
   * about a stranger rather than something your group picked up.
   */
  tier?: string
  broadcast?: boolean
  /** For `aaxp`: the denominator of the pair the game printed. */
  outOf?: number
  /** For `census`: which kind of broadcast this was. */
  census?: 'login' | 'level' | 'first'
  /**
   * For `afk`: true when going away, false when coming back. Kept as a
   * separate field rather than two kinds because everything downstream cares
   * about the transition, not the wording.
   */
  away?: boolean
  /**
   * For `chat`: which channel carried it - `auction`, `ooc`, `shout`, `say`.
   * The channel is the whole point of an auction watcher, and folding it into
   * the text would mean re-parsing what the rule already knew.
   */
  channel?: string
}

/** A single fight: one contiguous stretch of combat. */
export interface Encounter {
  id: string
  /** The mob the fight is named for - the one that took the most damage. */
  name: string
  zone: string | null
  start: number
  end: number
  /** True while the fight is still accumulating. */
  live: boolean
  /**
   * Seconds where damage actually happened, as distinct from wall-clock. The
   * meter shows both: `dps` over the whole fight and `act dps` over this.
   */
  activeSeconds: number
  events: ParsedEvent[]
}
