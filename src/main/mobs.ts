import Store from 'electron-store'
import { blankMob, MAX_KILL_TIMES, type MobsData, type MobTotals } from '@shared/mobs'
import type { Encounter } from '@shared/parser/types'

/**
 * The lifetime record of everything you have fought.
 *
 * Fed one closed fight at a time rather than one event at a time, because the
 * numbers worth keeping are per-fight: a kill time, a fight's worth of damage
 * taken. An event stream cannot say how long a Diaku Guardian took to die.
 *
 * Attribution rule: a fight's damage is credited to the mob that TOOK it, and
 * the kill to the mob that died. Adds and pets wandering through a pull
 * therefore land on their own rows instead of inflating the boss's - which
 * matters, because the interesting question is usually about the boss.
 */

const MAX_ZONES_PER_MOB = 6

interface Persisted {
  totals: Record<string, MobTotals>
}

const store = new Store<Persisted>({
  name: 'triune-mobs',
  defaults: { totals: {} },
  clearInvalidConfig: true
})

export class Mobs {
  private totals: Record<string, MobTotals> = store.get('totals') ?? {}
  private dirty = false

  constructor() {
    setInterval(() => this.flush(), 20_000).unref()
  }

  observe(enc: Encounter, selfNames: Set<string>): void {
    const seconds = Math.max(0, (enc.end - enc.start) / 1000)

    // Per-mob damage in this fight, so a pull with three adds splits correctly.
    const done = new Map<string, number>()
    const taken = new Map<string, number>()
    const died = new Set<string>()
    let yourDeaths = 0

    for (const e of enc.events) {
      const amount = e.amount ?? 0

      if (e.target?.kind === 'mob' && amount > 0 && isDamage(e.kind)) {
        done.set(e.target.name, (done.get(e.target.name) ?? 0) + amount)
      }
      if (e.attacker?.kind === 'mob' && amount > 0 && isDamage(e.kind)) {
        taken.set(e.attacker.name, (taken.get(e.attacker.name) ?? 0) + amount)
      }

      if (e.kind === 'death' && e.target) {
        if (e.target.kind === 'mob') died.add(e.target.name)
        else if (e.target.kind === 'self' || selfNames.has(e.target.name)) yourDeaths += 1
      }
    }

    const involved = new Set<string>([...done.keys(), ...taken.keys(), ...died])
    if (involved.size === 0) return

    for (const mob of involved) {
      const t = this.totals[mob] ?? blankMob(mob, enc.start)
      t.fights += 1
      t.seconds += seconds
      t.damageDone += done.get(mob) ?? 0
      t.damageTaken += taken.get(mob) ?? 0
      t.lastSeen = Math.max(t.lastSeen, enc.end)
      t.firstSeen = Math.min(t.firstSeen, enc.start)

      if (died.has(mob)) {
        t.kills += 1
        // Only a fight that ended in a kill can set a kill time.
        if (t.fastestSeconds === null || seconds < t.fastestSeconds) t.fastestSeconds = seconds
        // Stamped at the end of the fight, which is when the thing actually
        // died, so the gap to the next kill is a respawn and not a respawn
        // plus however long the fight ran. Ledgers written before Timers
        // existed have no array at all, hence the fallback.
        t.killTimes = [...(t.killTimes ?? []), enc.end].slice(-MAX_KILL_TIMES)
      }

      // Deaths are recorded against every mob present, because the log does not
      // say which one landed the blow. Said plainly on the page: "your deaths
      // in fights with it", not "deaths it caused".
      t.deaths += yourDeaths

      if (enc.zone && !t.zones.includes(enc.zone)) {
        t.zones.unshift(enc.zone)
        if (t.zones.length > MAX_ZONES_PER_MOB) t.zones.pop()
      }

      this.totals[mob] = t
    }

    this.dirty = true
  }

  data(): MobsData {
    return { totals: this.totals }
  }

  reset(): MobsData {
    this.totals = {}
    this.dirty = true
    this.flush()
    return this.data()
  }

  flush(): void {
    if (!this.dirty) return
    this.dirty = false
    store.set('totals', this.totals)
  }
}

function isDamage(kind: Encounter['events'][number]['kind']): boolean {
  return kind === 'melee' || kind === 'spell' || kind === 'dot'
}
