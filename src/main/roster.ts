import Store from 'electron-store'
import type { ParsedEvent } from '@shared/parser/types'
import type { Identity, RosterState } from '@shared/roster'
import { findCharacter } from './ptdex'

/**
 * The identity cache.
 *
 * Every name the app is willing to call a player gets looked up on PTDex once,
 * and what comes back - level, the three classes, guild, score, rank - is kept
 * so it never has to be asked again this week.
 *
 * Three rules keep this from turning into a scraper:
 *
 *   * **Only players.** `actor()` calls unknown names mobs, so the only names
 *     that reach here are your own boxes and people the log put in your group.
 *     A zone full of NPCs generates no traffic at all.
 *   * **One request at a time, spaced out.** A pull that names four new people
 *     produces four requests over a second and a bit, not four at once.
 *   * **Everything is cached, including "no such character".** A name the site
 *     has never heard of is remembered as absent rather than re-asked on every
 *     swing - just for a shorter time, because new characters do appear.
 */

const FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MISSING_TTL_MS = 12 * 60 * 60 * 1000
/** After a network failure, wait this long before trying that name again. */
const FAILURE_COOLDOWN_MS = 5 * 60 * 1000
/** Gap between requests, so a busy pull trickles rather than bursts. */
const REQUEST_GAP_MS = 300
const MAX_QUEUE = 40

/**
 * EverQuest names are letters only. This is a guard, not a nicety: it is the
 * one thing standing between a mis-parsed line and the app POSTing arbitrary
 * text at somebody else's website.
 */
const NAME_RE = /^[A-Za-z]{3,20}$/

interface Persisted {
  known: Record<string, Identity>
}

const store = new Store<Persisted>({
  name: 'triune-roster',
  defaults: { known: {} },
  clearInvalidConfig: true
})

export class Roster {
  private known = new Map<string, Identity>(Object.entries(store.get('known') ?? {}))
  private groups: Record<string, string[]> = {}
  private queue: string[] = []
  private queued = new Set<string>()
  private cooldown = new Map<string, number>()
  private working = false

  constructor(
    private opts: {
      /** Read lazily, because the user can change it in Preferences. */
      base: () => string
      onChange: (state: RosterState) => void
    }
  ) {}

  /** Watch the merged event stream for names worth resolving. */
  observe(events: ParsedEvent[]): void {
    for (const e of events) {
      // `self` matters as much as `player`: your own boxes are the names most
      // likely to be on screen, and they are the ones you most want labelled.
      if (e.attacker && (e.attacker.kind === 'player' || e.attacker.kind === 'self')) {
        this.want(e.attacker.name)
      }
      if (e.target && (e.target.kind === 'player' || e.target.kind === 'self')) {
        this.want(e.target.name)
      }
    }
  }

  /**
   * Take the group rosters the watcher assembled.
   *
   * Everyone in them is looked up, whether or not they have swung at anything:
   * a healer who spends a fight healing never appears in the damage roster, and
   * "who is in my group" should not depend on who happens to be hitting things.
   */
  setGroups(groups: Record<string, string[]>): void {
    const before = JSON.stringify(this.groups)
    this.groups = groups
    for (const members of Object.values(groups)) for (const m of members) this.want(m)
    if (JSON.stringify(groups) !== before) this.opts.onChange(this.state())
  }

  /** Queue a name if we don't already have a fresh answer for it. */
  want(name: string): void {
    if (!NAME_RE.test(name)) return
    if (this.queued.has(name)) return
    if (this.isFresh(this.known.get(name))) return

    const cool = this.cooldown.get(name)
    if (cool !== undefined && Date.now() - cool < FAILURE_COOLDOWN_MS) return
    if (this.queue.length >= MAX_QUEUE) return

    this.queue.push(name)
    this.queued.add(name)
    void this.drain()
  }

  /**
   * Look these names up again regardless of how fresh the cache is - what the
   * Sync button calls after a level or a class change.
   */
  async refresh(names: string[]): Promise<RosterState> {
    for (const name of names) {
      if (!NAME_RE.test(name)) continue
      this.known.delete(name)
      this.cooldown.delete(name)
      if (this.queued.has(name)) continue
      this.queue.push(name)
      this.queued.add(name)
    }
    await this.drain()
    return this.state()
  }

  /**
   * Record a lookup somebody else already paid for.
   *
   * The Progression page's sync fetches the same character rows on its way to
   * the flag pages, so handing them over here means pressing Sync also
   * refreshes the class lines without a second round of requests.
   */
  put(found: {
    name: string
    id: number
    level: number | null
    race: string | null
    classes: string[]
    guild: string | null
    score: number | null
    trioRank: number | null
    trioOf: number | null
    overallRank: number | null
  }): void {
    this.known.set(found.name, { ...found, fetchedAt: Date.now(), found: true })
    this.cooldown.delete(found.name)
    this.persist()
    this.opts.onChange(this.state())
  }

  state(): RosterState {
    return {
      known: Object.fromEntries(this.known),
      groups: this.groups,
      busy: this.queue.length > 0 || this.working
    }
  }

  private isFresh(id: Identity | undefined): boolean {
    if (!id) return false
    const ttl = id.found ? FOUND_TTL_MS : MISSING_TTL_MS
    return Date.now() - id.fetchedAt < ttl
  }

  private async drain(): Promise<void> {
    if (this.working) return
    this.working = true
    try {
      while (this.queue.length > 0) {
        const base = this.opts.base()
        if (!base) {
          // No site configured: drop the backlog rather than spin on it. The
          // app is fully usable offline, just without class lines.
          this.queue.length = 0
          this.queued.clear()
          break
        }

        const name = this.queue.shift() as string
        this.queued.delete(name)

        try {
          const found = await findCharacter(base, name)
          this.known.set(name, {
            name,
            id: found?.id ?? null,
            level: found?.level ?? null,
            race: found?.race ?? null,
            classes: found?.classes ?? [],
            guild: found?.guild ?? null,
            score: found?.score ?? null,
            trioRank: found?.trioRank ?? null,
            trioOf: found?.trioOf ?? null,
            overallRank: found?.overallRank ?? null,
            fetchedAt: Date.now(),
            found: found !== null
          })
          this.persist()
          this.opts.onChange(this.state())
        } catch {
          // A failure is the site being unreachable, not the character being
          // absent - so it is NOT cached as "not found". It goes on a cooldown
          // instead, and the name will be re-wanted the next time it appears.
          this.cooldown.set(name, Date.now())
        }

        if (this.queue.length > 0) await sleep(REQUEST_GAP_MS)
      }
    } finally {
      this.working = false
      this.opts.onChange(this.state())
    }
  }

  private persist(): void {
    store.set('known', Object.fromEntries(this.known))
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
