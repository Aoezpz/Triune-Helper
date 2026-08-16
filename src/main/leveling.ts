import Store from 'electron-store'
import type { AaMark, LevelingData, LevelMark, XpTick } from '@shared/leveling'
import type { ParsedEvent } from '@shared/parser/types'

/**
 * Progression over time, per character.
 *
 * A blunt honesty note that shapes this whole file: EverQuest logs record
 * THAT you gained experience, never how much. There is no percentage in the
 * log, no "you are 43% through level 52". So nothing here reports one.
 *
 * What the log does give, reliably:
 *   * every level you ding, with the new level number
 *   * every ability point, with the running unspent total
 *   * an "You gain experience!!" line per kill you got credit for
 *   * "You gain bonus AA experience! (5087/18850)" - the one place this server
 *     prints real numbers, and the reason the AA half of the page is measured
 *     rather than inferred
 *
 * From those, honest derivatives are: levels over time, AA over time, rates
 * (kills/hour, AA/hour, time between dings), and a genuine AA progress bar. A
 * fabricated regular-XP bar would look better and mean nothing, so there
 * still isn't one.
 */

const MAX_TICKS = 20_000

interface Persisted {
  levels: LevelMark[]
  aa: LevelMark[]
  aaxp: AaMark[]
  ticks: XpTick[]
}

const store = new Store<Persisted>({
  name: 'triune-leveling',
  defaults: { levels: [], aa: [], aaxp: [], ticks: [] },
  clearInvalidConfig: true
})

/** First occurrence of each key wins; order is preserved. */
function uniqueBy<T>(rows: T[], key: (row: T) => string): T[] {
  const seen = new Set<string>()
  return rows.filter((r) => {
    const k = key(r)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export class Leveling {
  private levels: LevelMark[] = store.get('levels')
  private aa: LevelMark[] = store.get('aa')
  // Defaulted rather than trusted: a store written before this field existed
  // has no `aaxp` key, and an undefined here would crash the page on load.
  private aaxp: AaMark[] = store.get('aaxp') ?? []
  private ticks: XpTick[] = store.get('ticks')
  private dirty = false

  /**
   * The newest line already recorded, per character.
   *
   * This ledger is persisted and the watcher rewinds 64 KB on every attach, so
   * each restart re-delivers lines that are already in here. The old guards
   * compared a new event only against the LAST row for that character, which
   * catches an immediate repeat and nothing else: a replay arrives oldest-first,
   * so "41" is compared against the stored "48", looks new, and the whole
   * sequence is appended a second time. Two restarts, three copies of every AA
   * point - and the session counters read off them were inflated to match.
   *
   * A high-water mark per character fixes all four lists at once and is the
   * right shape for the problem: the log is read in time order, so anything at
   * or before the newest row we already hold has been seen.
   */
  private newest = new Map<string, number>()

  constructor() {
    // Stores written before the guard above exists already hold the duplicates,
    // and they inflate every session counter read off them. Cleaned once on
    // load rather than left for the user to notice and clear by hand.
    //
    // A pair of xp messages genuinely inside the same second collapses to one
    // here, which nudges the messages-per-hour rate down a fraction. Worth it
    // against a rate that doubled on every restart.
    const before = this.levels.length + this.aa.length + this.aaxp.length + this.ticks.length
    this.levels = uniqueBy(this.levels, (l) => `${l.character}|${l.at}|${l.value}|${l.via ?? ''}`)
    this.aa = uniqueBy(this.aa, (l) => `${l.character}|${l.at}|${l.value}`)
    this.aaxp = uniqueBy(this.aaxp, (a) => `${a.character}|${a.at}|${a.earned}`)
    this.ticks = uniqueBy(this.ticks, (t) => `${t.character}|${t.at}`)
    const after = this.levels.length + this.aa.length + this.aaxp.length + this.ticks.length
    if (after !== before) this.dirty = true

    for (const row of [...this.levels, ...this.aa, ...this.aaxp, ...this.ticks]) {
      this.mark(row.character, row.at)
    }
    // Writing on every xp message would hammer the disk during a grind, so
    // changes are batched onto a slow timer and flushed on quit.
    setInterval(() => this.flush(), 20_000).unref()
  }

  private mark(character: string, at: number): void {
    if (at > (this.newest.get(character) ?? 0)) this.newest.set(character, at)
  }

  /**
   * Have we already read past this line?
   *
   * Strictly older is certainly a replay. The same second is not - a fast kill
   * can produce two xp messages inside one second, and EverQuest timestamps
   * only to the second - so those are still let through and the per-list checks
   * below decide.
   */
  private alreadyRead(character: string, at: number): boolean {
    return at < (this.newest.get(character) ?? 0)
  }

  observe(events: ParsedEvent[]): void {
    for (const e of events) {
      // The character is the log the line came from: these are first-person
      // messages, and merge.ts keeps them per-source for exactly this reason.
      const character = e.source

      // Everything below is appended to a persisted list, so a replayed line
      // must not be appended twice.
      if (this.alreadyRead(character, e.ts)) continue

      if (e.kind === 'level' && e.amount !== undefined) {
        const last = this.levels.filter((l) => l.character === character).at(-1)
        // Re-reading the tail of a log on restart can replay a ding; the same
        // level at the same second is the same event.
        if (last && last.value === e.amount && Math.abs(last.at - e.ts) < 2000) continue
        this.levels.push({ character, at: e.ts, value: e.amount })
        this.mark(character, e.ts)
        this.dirty = true
      }

      if (e.kind === 'aa' && e.amount !== undefined) {
        const last = this.aa.filter((l) => l.character === character).at(-1)
        if (last && last.value === e.amount) continue
        this.aa.push({ character, at: e.ts, value: e.amount })
        this.mark(character, e.ts)
        this.dirty = true
      }

      if (e.kind === 'xp') {
        this.ticks.push({ character, at: e.ts })
        this.mark(character, e.ts)
        this.dirty = true
      }

      // The counter is printed on most kills and moves on few of them, so only
      // changes are stored. Keeping every reading would be thousands of
      // identical rows an evening, and the rate is computed from the
      // difference between readings, which repeats do not help.
      if (e.kind === 'aaxp' && e.amount !== undefined && e.outOf !== undefined) {
        const last = this.aaxp.filter((a) => a.character === character).at(-1)
        if (!last || last.earned !== e.amount || last.available !== e.outOf) {
          this.aaxp.push({ character, at: e.ts, earned: e.amount, available: e.outOf })
          this.mark(character, e.ts)
          this.dirty = true
        }
      }

      // A /who states the level outright. Without this, a character who has
      // not levelled since the app was installed reads "level unknown"
      // forever - which is what it did on the first real log it ever saw.
      //
      // Only the line about THIS log's own character counts: a zone-wide /who
      // lists everyone present, and recording those would fill the page with
      // strangers who happened to be standing nearby.
      if (e.kind === 'who' && e.amount !== undefined && e.target?.name === character) {
        const last = this.levels.filter((l) => l.character === character).at(-1)
        if (!last || last.value !== e.amount) {
          // Marked `who` so it sets the current level without being counted as
          // a level GAINED this session - you did not ding by typing /who.
          this.levels.push({ character, at: e.ts, value: e.amount, via: 'who' })
          this.mark(character, e.ts)
          this.dirty = true
        }
      }
    }

    if (this.ticks.length > MAX_TICKS) this.ticks.splice(0, this.ticks.length - MAX_TICKS)
  }

  /**
   * Record a level learned from PTDex rather than from a ding. Marked as an
   * observation, so it sets the current level without counting as a level
   * gained this session.
   */
  setLevel(character: string, value: number): void {
    const last = this.levels.filter((l) => l.character === character).at(-1)
    if (last && last.value === value) return
    this.levels.push({ character, at: Date.now(), value, via: 'who' })
    this.dirty = true
    this.flush()
  }

  data(): LevelingData {
    return { levels: this.levels, aa: this.aa, aaxp: this.aaxp, ticks: this.ticks }
  }

  reset(character?: string): LevelingData {
    if (character) {
      this.levels = this.levels.filter((l) => l.character !== character)
      this.aa = this.aa.filter((l) => l.character !== character)
      this.aaxp = this.aaxp.filter((l) => l.character !== character)
      this.ticks = this.ticks.filter((t) => t.character !== character)
    } else {
      this.levels = []
      this.aa = []
      this.aaxp = []
      this.ticks = []
    }
    this.dirty = true
    this.flush()
    return this.data()
  }

  flush(): void {
    if (!this.dirty) return
    this.dirty = false
    store.set('levels', this.levels)
    store.set('aa', this.aa)
    store.set('aaxp', this.aaxp)
    store.set('ticks', this.ticks)
  }
}
