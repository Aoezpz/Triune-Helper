import type { ActorKind, Encounter, ParsedEvent } from './parser/types'

/**
 * Turns an encounter into the numbers the dashboard draws.
 *
 * Pure and synchronous: it runs in the main process on a throttle, and it runs
 * in tests. Nothing here reaches for a clock - `now` is passed in, so a live
 * fight and a replayed one compute identically.
 */

export interface SourceRow {
  name: string
  kind: ActorKind
  owner?: string
  damage: number
  dps: number
  hits: number
  /** Swings that did not land. Shown as a rate, since the count alone is noise. */
  misses: number
  crits: number
  /** Per-skill breakdown, biggest first. */
  skills: SkillRow[]
}

export interface SkillRow {
  name: string
  damage: number
  hits: number
  misses: number
  resists: number
  min: number
  max: number
}

export interface MobRow {
  name: string
  damage: number
  resists: number
}

export interface ProcRow {
  name: string
  /** How many times it fired. This is the observed fact; the rate is derived. */
  count: number
  /**
   * Firings per minute of active combat, or null when the fight was too short
   * for a rate to mean anything - see `MIN_SECONDS_FOR_RATE`.
   */
  perMinute: number | null
}

/**
 * How much active combat a proc rate needs before it is worth printing.
 *
 * One proc in a two-second fight is one proc. Dividing it by the fight length
 * says "30 per minute", which is arithmetically true and informationally
 * worthless - and worse, it collides with the weapon stat players already call
 * PPM, so it reads as a claim about the item rather than an observation about
 * this pull. Below this threshold the app reports the count and says nothing
 * about the rate.
 */
export const MIN_SECONDS_FOR_RATE = 30

/** A named hit modifier and what it was worth. */
export interface SpecialRow {
  name: string
  /** How many times the game announced it. */
  count: number
  /** Damage on the hits it was actually attached to. */
  damage: number
  /** The biggest single hit it landed on - the number people want. */
  best: number
}

export interface SeriesPoint {
  /** Seconds since the fight started. */
  t: number
  you: number
  pet: number
  group: number
  incoming: number
}

export interface FightSummary {
  id: string
  name: string
  zone: string | null
  start: number
  end: number
  live: boolean
  /** Wall-clock seconds, floor 1 so dps is never a division by zero. */
  durationSeconds: number
  activeSeconds: number
  totalOut: number
  totalIn: number
  totalHealed: number
  /**
   * Damage a shield stopped before it landed. Reported next to healing but
   * never added to it: prevented and repaired are different things, and a
   * combined figure would let a bard's absorbs read as a cleric's output.
   */
  totalAbsorbed: number
  /** Outgoing damage over wall clock. */
  dps: number
  /** Outgoing damage over active combat seconds - the "act dps" figure. */
  actDps: number
  sources: SourceRow[]
  incoming: SourceRow[]
  healing: SourceRow[]
  mobs: MobRow[]
  procs: ProcRow[]
  specials: SpecialRow[]
  series: SeriesPoint[]
}

const DAMAGE = new Set<ParsedEvent['kind']>(['melee', 'spell', 'dot'])

/** Is this event damage dealt BY the player's side (as opposed to taken)? */
function isOutgoing(e: ParsedEvent): boolean {
  return DAMAGE.has(e.kind) && e.target?.kind === 'mob'
}

function isIncoming(e: ParsedEvent): boolean {
  return DAMAGE.has(e.kind) && e.attacker?.kind === 'mob'
}

class RowBuilder {
  private rows = new Map<string, SourceRow>()

  add(e: ParsedEvent, key: string, kind: ActorKind, owner?: string): SourceRow {
    let row = this.rows.get(key)
    if (!row) {
      row = { name: key, kind, owner, damage: 0, dps: 0, hits: 0, misses: 0, crits: 0, skills: [] }
      this.rows.set(key, row)
    }
    if (e.amount && DAMAGE.has(e.kind)) {
      row.damage += e.amount
      row.hits += 1
      if (e.critical) row.crits += 1
    }
    if (e.kind === 'heal' && e.amount) {
      row.damage += e.amount
      row.hits += 1
    }
    if (e.kind === 'miss') row.misses += 1
    return row
  }

  /** Per-skill rows, folded in as events arrive. */
  addSkill(row: SourceRow, e: ParsedEvent): void {
    // Named for the log line it came from rather than for what it lacks. The
    // row it sits under is already called "Unattributed"; repeating that here
    // said the same thing twice and described the damage not at all.
    const name = e.skill ?? (e.kind === 'spell' ? 'non-melee' : e.kind)
    let skill = row.skills.find((s) => s.name === name)
    if (!skill) {
      skill = { name, damage: 0, hits: 0, misses: 0, resists: 0, min: Infinity, max: 0 }
      row.skills.push(skill)
    }
    if (e.kind === 'miss') skill.misses += 1
    else if (e.kind === 'resist') skill.resists += 1
    else if (e.amount) {
      skill.damage += e.amount
      skill.hits += 1
      skill.min = Math.min(skill.min, e.amount)
      skill.max = Math.max(skill.max, e.amount)
    }
  }

  finish(seconds: number): SourceRow[] {
    const out = [...this.rows.values()]
    for (const row of out) {
      row.dps = seconds > 0 ? row.damage / seconds : 0
      row.skills.sort((a, b) => b.damage - a.damage)
      for (const s of row.skills) if (s.min === Infinity) s.min = 0
    }
    return out.sort((a, b) => b.damage - a.damage)
  }
}

/**
 * The rolling DPS curve.
 *
 * One point per second of the fight, each the mean over the preceding
 * `windowSeconds`. A rolling mean rather than raw per-second damage because
 * EverQuest's one-second stamps make the raw signal a comb - every swing lands
 * on an integer second, so the unsmoothed line is all spikes and zeroes and
 * says nothing about how the fight actually went.
 */
export function buildSeries(
  enc: Encounter,
  selfNames: Set<string>,
  windowSeconds = 5
): SeriesPoint[] {
  const startSec = Math.floor(enc.start / 1000)
  const endSec = Math.floor(enc.end / 1000)
  const span = Math.max(0, endSec - startSec)

  // Bucket damage per second first, then take the rolling mean over buckets.
  const you = new Float64Array(span + 1)
  const pet = new Float64Array(span + 1)
  const group = new Float64Array(span + 1)
  const incoming = new Float64Array(span + 1)

  for (const e of enc.events) {
    if (!e.amount) continue
    const idx = Math.floor(e.ts / 1000) - startSec
    if (idx < 0 || idx > span) continue

    if (isIncoming(e)) {
      incoming[idx] += e.amount
      continue
    }
    if (!isOutgoing(e) || !e.attacker) continue

    if (e.attacker.kind === 'pet') pet[idx] += e.amount
    else if (selfNames.has(e.attacker.name)) you[idx] += e.amount
    else group[idx] += e.amount
  }

  const points: SeriesPoint[] = []
  const mean = (arr: Float64Array, i: number): number => {
    const from = Math.max(0, i - windowSeconds + 1)
    let sum = 0
    for (let j = from; j <= i; j++) sum += arr[j]
    return sum / (i - from + 1)
  }

  for (let i = 0; i <= span; i++) {
    points.push({
      t: i,
      you: mean(you, i),
      pet: mean(pet, i),
      group: mean(group, i),
      incoming: mean(incoming, i)
    })
  }
  return points
}

/**
 * Procs.
 *
 * A proc is spell damage from a source that is also swinging a weapon in this
 * fight - which is how a weapon proc is distinguishable from a cast nuke in a
 * log that labels neither. Rate is per minute of ACTIVE combat, because a proc
 * rate measured over a fight with a two-minute corpse run in the middle is a
 * meaningless number - and it is withheld entirely on a fight too short to
 * support one, for the same reason.
 */
export function buildProcs(enc: Encounter, activeSeconds: number): ProcRow[] {
  const meleeSources = new Set<string>()
  for (const e of enc.events) {
    if (e.kind === 'melee' && e.attacker) meleeSources.add(e.attacker.name)
  }

  const counts = new Map<string, number>()
  for (const e of enc.events) {
    if (e.kind !== 'spell' || !e.skill || !e.attacker) continue
    if (!meleeSources.has(e.attacker.name)) continue
    if (e.skill === 'Damage shield') continue
    counts.set(e.skill, (counts.get(e.skill) ?? 0) + 1)
  }

  const minutes = activeSeconds / 60
  const rated = activeSeconds >= MIN_SECONDS_FOR_RATE && minutes > 0
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count, perMinute: rated ? count / minutes : null }))
    .sort((a, b) => b.count - a.count)
}

/**
 * Named hit modifiers, and what they were worth.
 *
 * The count comes from the announcements and the damage from the hits they
 * were attached to, so the two can legitimately disagree: an announcement at
 * the very end of a fight has no hit to land on yet. Counting them separately
 * is the honest way round - dropping the orphan would undercount how often the
 * thing fires, and inventing damage for it would be worse.
 */
export function buildSpecials(enc: Encounter): SpecialRow[] {
  const rows = new Map<string, SpecialRow>()
  const row = (name: string): SpecialRow => {
    let r = rows.get(name)
    if (!r) {
      r = { name, count: 0, damage: 0, best: 0 }
      rows.set(name, r)
    }
    return r
  }

  for (const e of enc.events) {
    if (e.kind === 'special' && e.skill) row(e.skill).count += 1
    if (e.mods && e.amount) {
      for (const m of e.mods) {
        const r = row(m)
        r.damage += e.amount
        r.best = Math.max(r.best, e.amount)
      }
    }
  }

  return [...rows.values()].sort((a, b) => b.count - a.count)
}

export function summarize(enc: Encounter, selfNames: Set<string>): FightSummary {
  const durationSeconds = Math.max(1, Math.round((enc.end - enc.start) / 1000))
  const activeSeconds = Math.max(1, enc.activeSeconds)

  const out = new RowBuilder()
  const inc = new RowBuilder()
  const heals = new RowBuilder()
  const mobs = new Map<string, MobRow>()

  let totalOut = 0
  let totalIn = 0
  let totalHealed = 0
  let totalAbsorbed = 0

  for (const e of enc.events) {
    if (e.kind === 'heal' && e.attacker) {
      const row = heals.add(e, e.attacker.name, e.attacker.kind, e.attacker.owner)
      heals.addSkill(row, e)
      totalHealed += e.amount ?? 0
      continue
    }

    // Absorbs are totalled and go no further: they are not damage, not
    // healing, and putting them in the healing rows would make a shield buff
    // outrank an actual healer.
    if (e.kind === 'absorb') {
      totalAbsorbed += e.amount ?? 0
      continue
    }

    if (isIncoming(e) && e.attacker) {
      const row = inc.add(e, e.attacker.name, e.attacker.kind)
      inc.addSkill(row, e)
      totalIn += e.amount ?? 0
      continue
    }

    // Outgoing damage, plus the misses and resists that belong beside it.
    const towardMob = e.target?.kind === 'mob'
    if (isOutgoing(e) || ((e.kind === 'miss' || e.kind === 'resist') && towardMob)) {
      /**
       * Some damage genuinely names no source: "a War Crow was hit by non-melee
       * for 147 points of damage." is what a damage shield or an unattributed
       * proc looks like, and no amount of parsing will tell you whose it was.
       *
       * It gets its own row rather than being dropped. Dropping it was the old
       * behaviour and it was wrong twice over - the damage vanished from the
       * fight total, and the log showed a "?" for damage the meter had
       * silently discarded.
       */
      const who = e.attacker ?? { name: 'Unattributed', kind: 'unknown' as const }
      const row = out.add(e, who.name, who.kind, who.owner)
      out.addSkill(row, e)
      if (isOutgoing(e)) totalOut += e.amount ?? 0

      if (e.target) {
        let mob = mobs.get(e.target.name)
        if (!mob) {
          mob = { name: e.target.name, damage: 0, resists: 0 }
          mobs.set(e.target.name, mob)
        }
        if (isOutgoing(e)) mob.damage += e.amount ?? 0
        if (e.kind === 'resist') mob.resists += 1
      }
    }
  }

  return {
    id: enc.id,
    name: enc.name,
    zone: enc.zone,
    start: enc.start,
    end: enc.end,
    live: enc.live,
    durationSeconds,
    activeSeconds,
    totalOut,
    totalIn,
    totalHealed,
    totalAbsorbed,
    dps: totalOut / durationSeconds,
    actDps: totalOut / activeSeconds,
    sources: out.finish(durationSeconds),
    incoming: inc.finish(durationSeconds),
    healing: heals.finish(durationSeconds),
    mobs: [...mobs.values()].sort((a, b) => b.damage - a.damage),
    procs: buildProcs(enc, activeSeconds),
    specials: buildSpecials(enc),
    series: buildSeries(enc, selfNames)
  }
}

/** Compact display: 84300 -> "84.3k", 1_240_000 -> "1.24M". */
export function short(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (abs >= 10_000) return `${(n / 1000).toFixed(1)}k`
  if (abs >= 1000) return `${(n / 1000).toFixed(2)}k`
  return Math.round(n).toLocaleString()
}

/** 194 -> "3:14" */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
