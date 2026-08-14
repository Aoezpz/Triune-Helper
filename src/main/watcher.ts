import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { LogSource, Settings, WatcherStatus } from '@shared/ipc'
import { EncounterTracker } from '@shared/parser/encounter'
import { mergeEvents, type MergeConfig } from '@shared/parser/merge'
import { parseLine, type ParseContext } from '@shared/parser/patterns'
import { tokenizeChunk } from '@shared/parser/tokenize'
import type { Encounter, ParsedEvent } from '@shared/parser/types'
import { applyGroupEvent } from '@shared/roster'
import { readRange } from './readrange'

/**
 * Tails the game's log files.
 *
 * Polling rather than fs.watch. EverQuest appends to these files continuously
 * and fs.watch on Windows coalesces rapid appends into unpredictable event
 * counts, so a poll that reads from a byte offset is both simpler and steadier
 * - and it works on a network drive, which fs.watch does not.
 *
 * The files are opened read-only and never written. That is the whole promise
 * of the app: nothing is injected, no game file is touched.
 */

const POLL_MS = 400

/** How much of an existing file to read on first attach. Enough to pick up a
 *  fight already in progress, not so much that starting the app replays a
 *  month of logs. */
const BACKFILL_BYTES = 64 * 1024

/**
 * How far back to look for the standing facts - pet ownership and group
 * membership - when attaching to a log that is already running.
 */
const HISTORY_SCAN_BYTES = 6 * 1024 * 1024

/**
 * How long the owner of third-party events keeps the job after going quiet.
 *
 * Long enough to survive a corpse run or a bio break, short enough that logging
 * one trio out and another in hands the job over within a few minutes.
 */
const PRIMARY_STICKY_MS = 5 * 60 * 1000

/**
 * A log untouched for this long belongs to a character who is not playing.
 *
 * Anyone with more than one trio - or more than one account - accumulates an
 * eqlog file for every character they have ever logged in, and they all sit in
 * the same folder forever. Tailing all of them put strangers in the party
 * strip, sent their names to PTDex, and handed one of them ownership of your
 * combat. A file the game has not written to since yesterday is history, not a
 * session.
 *
 * Characters listed explicitly in Preferences bypass this: an explicit choice
 * outranks a heuristic.
 */
const STALE_LOG_MS = 24 * 60 * 60 * 1000

/** Lines worth re-parsing during that scan. Everything else is skipped without
 *  being tokenised, which is what keeps a 6 MB pass instant. */
function isStandingFact(line: string): boolean {
  return (
    line.includes('group') ||
    line.includes('party') ||
    line.includes('My leader is') ||
    // A world blessing is a standing fact in exactly the same sense: announced
    // once, true for the next several hours, and never repeated. It is also
    // the one the 64 KB attach backfill is worst at - the announcement can be
    // hours old while the blessing is still running, so without this the page
    // sits empty until somebody happens to extend one.
    line.includes('server-wide blessing')
  )
}

interface Tail {
  character: string
  path: string
  offset: number
  seq: number
  lastLineAt: number | null
  /** Guards against a slow read overlapping the next poll. */
  reading: boolean
  ctx: ParseContext
}

export interface WatcherEvents {
  onStatus: (status: WatcherStatus) => void
  onEvents: (events: ParsedEvent[]) => void
  onEncounter: (live: Encounter | null) => void
  onEncounterClosed: (enc: Encounter) => void
  /**
   * Facts read out of the log's PAST, on attach.
   *
   * Deliberately a separate channel from `onEvents`: these lines have already
   * been counted in whatever session originally saw them, so feeding them to
   * the meter, the loot ledger or the zone timer would double everything on
   * every restart. Only consumers that are idempotent - state that is replaced
   * rather than accumulated - may listen here.
   */
  onStandingFacts?: (events: ParsedEvent[]) => void
}

export class LogWatcher {
  private tails = new Map<string, Tail>()
  private timer: NodeJS.Timeout | null = null
  private rescanTimer: NodeJS.Timeout | null = null
  private error: string | null = null
  private folder = ''
  private settings: Settings | null = null
  private tracker: EncounterTracker | null = null

  /** Pet ownership is shared across all logs: whoever learns it, all benefit. */
  private petOwners = new Map<string, string>()

  /**
   * Names known to be players, shared across logs. Seeded with the characters
   * being tailed, since mobs on this server are proper nouns and cannot be
   * told from players by name alone.
   */
  private players = new Set<string>()

  /**
   * Group membership per log, NOT shared.
   *
   * Each client only ever writes its own group's messages, and there is no
   * guarantee the three boxes are in one group - somebody parked in the lobby
   * is in no group at all. Keeping a set per log says exactly what each log
   * saw; the union is a display decision made later, not a parsing one.
   */
  private groups = new Map<string, Set<string>>()

  /** Who currently owns third-party events - see `primary()`. */
  private chosenPrimary: string | null = null

  constructor(private events: WatcherEvents) {}

  /**
   * Attach at end-of-file instead of backfilling.
   *
   * Set for one restart after a history rebuild: the rebuild has just read
   * these files to the last byte, and the usual 64 KB backfill would replay
   * that tail straight back into the ledgers it just filled.
   */
  private startAtEnd = false

  start(settings: Settings, opts: { fromEnd?: boolean } = {}): WatcherStatus {
    this.stop()
    this.settings = settings
    this.folder = settings.logFolder
    this.error = null
    this.startAtEnd = opts.fromEnd === true

    this.tracker = new EncounterTracker({
      timeoutSeconds: settings.fightTimeoutSeconds,
      onChange: (enc) => this.events.onEncounter(enc),
      onClose: (enc) => this.events.onEncounterClosed(enc)
    })

    if (!this.folder) {
      this.error = null // not an error, just unconfigured
      return this.status()
    }
    if (!existsSync(this.folder)) {
      this.error = `Folder not found: ${this.folder}`
      return this.status()
    }

    this.discover()
    this.timer = setInterval(() => void this.poll(), POLL_MS)
    // New characters appear when someone logs in a third box mid-session.
    this.rescanTimer = setInterval(() => this.discover(), 5000)
    return this.status()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.rescanTimer) clearInterval(this.rescanTimer)
    this.timer = null
    this.rescanTimer = null
    this.tails.clear()
    // Group rosters belong to the logs being tailed, so pointing at a different
    // folder must not leave the old party on screen.
    this.groups.clear()
    this.chosenPrimary = null
    this.tracker = null
  }

  /**
   * Re-read the folder now instead of waiting for the next sweep.
   *
   * Exists so the attach/release rules can be tested without a test sitting
   * through the five-second rescan interval.
   */
  rescan(): void {
    this.discover()
  }

  /**
   * Read whatever is pending now instead of waiting for the next 400ms tick.
   *
   * The same seam as `rescan`, for the half of the behaviour that only appears
   * once lines have actually been consumed - liveness above all.
   */
  async drain(): Promise<void> {
    await this.poll()
  }

  status(): WatcherStatus {
    const sources: LogSource[] = [...this.tails.values()]
      .map((t) => ({
        character: t.character,
        path: t.path,
        offset: t.offset,
        // "Active" means this log produced a line in the last two minutes -
        // which is what distinguishes a boxed character who is playing from
        // one who is parked at the guild lobby.
        active: t.lastLineAt !== null && Date.now() - t.lastLineAt < 120_000,
        lastLineAt: t.lastLineAt,
        group: [...(this.groups.get(t.character) ?? [])].sort()
      }))
      .sort((a, b) => a.character.localeCompare(b.character))

    return { folder: this.folder, sources, watching: this.timer !== null, error: this.error }
  }

  /**
   * The log that owns third-party events - every mob swing, every kill.
   *
   * This used to be "first character alphabetically", which is fine for exactly
   * one situation: a Logs folder containing only the trio you are playing right
   * now. Anyone who has ever played a second set of characters has more logs
   * than that, and if one of those sorts first it becomes the owner of every
   * third-party event while producing no lines at all - so the mob damage is
   * attributed to a log that never speaks, and silently discarded. The meter
   * shows your swings and nothing hitting back.
   *
   * So: the most recently written log wins, and then it KEEPS winning until it
   * has been quiet for a while. Stickiness is the important half. Re-picking on
   * every poll would let the owner change between the poll that reads one
   * copy of a line and the poll that reads another box's copy of the same line,
   * which counts it twice or not at all.
   */
  private primary(): string {
    const configured = this.settings?.primaryCharacter
    if (configured && this.tails.has(configured)) return configured

    const held = this.chosenPrimary ? this.tails.get(this.chosenPrimary) : undefined
    if (held?.lastLineAt && Date.now() - held.lastLineAt < PRIMARY_STICKY_MS) return held.character

    const busiest = [...this.tails.values()]
      .filter((t) => t.lastLineAt !== null)
      .sort((a, b) => (b.lastLineAt as number) - (a.lastLineAt as number))[0]

    // Before any log has produced a line there is nothing to judge by, so fall
    // back to the old alphabetical rule rather than picking at random.
    this.chosenPrimary = busiest?.character ?? [...this.tails.keys()].sort()[0] ?? null
    return this.chosenPrimary ?? ''
  }

  private mergeConfig(): MergeConfig {
    return {
      selfBySource: new Map([...this.tails.values()].map((t) => [t.character, t.character])),
      primarySource: this.primary(),
      petOwners: this.petOwners
    }
  }

  /** Find eqlog_<Character>_<server>.txt files we are not already tailing. */
  private discover(): void {
    if (!this.settings || !this.folder) return
    const server = this.settings.serverShortname.toLowerCase()
    const wanted = this.settings.watchedCharacters

    let names: string[]
    try {
      names = readdirSync(this.folder)
    } catch (err) {
      this.error = `Cannot read ${this.folder}: ${(err as Error).message}`
      this.events.onStatus(this.status())
      return
    }

    let changed = this.dropDeparted(wanted)

    for (const file of names) {
      const m = /^eqlog_(.+)_(.+)\.txt$/i.exec(file)
      if (!m) continue
      if (m[2].toLowerCase() !== server) continue

      const character = m[1]
      if (wanted.length > 0 && !wanted.includes(character)) continue
      if (this.tails.has(character)) continue

      const path = join(this.folder, file)
      let size = 0
      let modified = 0
      try {
        const st = statSync(path)
        size = st.size
        modified = st.mtimeMs
      } catch {
        continue
      }

      // An explicit list is a decision; without one, ignore logs the game has
      // not written to lately. See STALE_LOG_MS - this is what keeps a folder
      // full of retired alts out of your party.
      if (wanted.length === 0 && Date.now() - modified > STALE_LOG_MS) continue

      this.players.add(character)
      const ctx: ParseContext = {
        self: character,
        petOwners: this.petOwners,
        players: this.players
      }
      this.tails.set(character, {
        character,
        path,
        offset: this.startAtEnd ? size : Math.max(0, size - BACKFILL_BYTES),
        seq: 0,
        lastLineAt: null,
        reading: false,
        ctx
      })
      void this.learnStandingFacts(character, path, size, ctx)
      changed = true
    }

    // Only the FIRST discover of a run may attach at end-of-file. That flag
    // exists for the restart after a history rebuild, which has just consumed
    // these files to the last byte; a third box logging in an hour later is an
    // ordinary attach and still wants its backfill.
    this.startAtEnd = false

    if (changed) this.events.onStatus(this.status())
  }

  /**
   * Let go of logs that are no longer being played.
   *
   * Tails were only ever added, never removed, so a character logged out at
   * lunchtime was still listed as a source at midnight - polled every 400ms,
   * shown in the title bar's character picker, and listed under "not grouped"
   * on the party strip. The same rule that keeps retired alts from being
   * picked up in the first place applies here.
   */
  private dropDeparted(wanted: string[]): boolean {
    let dropped = false
    for (const [character, tail] of this.tails) {
      // An explicit list is a decision - those logs stay attached even when
      // the character is offline.
      if (wanted.length > 0) continue

      let modified: number
      try {
        modified = statSync(tail.path).mtimeMs
      } catch (err) {
        // Only a file that is actually GONE gets released. A locked or briefly
        // unreadable file is routine on Windows while the client flushes, and
        // dropping a tail for it would lose the read offset and re-backfill.
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') continue
        this.release(character)
        dropped = true
        continue
      }

      // Windows does not always flush a directory entry's mtime while the file
      // is still open, so an actively-written log can look untouched. Bytes we
      // have actually read are the more reliable witness, so the newer of the
      // two wins - being wrong here means dropping a log somebody is playing.
      const lastActivity = Math.max(modified, tail.lastLineAt ?? 0)
      if (Date.now() - lastActivity <= STALE_LOG_MS) continue

      this.release(character)
      dropped = true
    }
    return dropped
  }

  /** Forget a log completely, including its claim on third-party events. */
  private release(character: string): void {
    this.tails.delete(character)
    this.groups.delete(character)
    // Leaving a departed character as primary would hand every mob swing to a
    // log that no longer exists, and the merge would discard all of it.
    if (this.chosenPrimary === character) this.chosenPrimary = null
  }

  /**
   * Learn the standing facts from earlier in the log: who owns which pet, and
   * who is in the group.
   *
   * Both are announced once and then never repeated. A pet states its owner
   * when it is summoned - `Gark says, 'My leader is Vexthar.'` - and a group
   * states its membership only as people join. If the app starts after that,
   * which is the normal case, the tail never sees either, so every pet's damage
   * lands in the wrong row and the group reads as empty.
   *
   * The scan replays those lines through the real pattern table rather than a
   * private set of regexes, so there is exactly one definition of what these
   * messages look like. Order is preserved, which matters: a group is the sum
   * of its joins and leaves, and applying them out of order would leave
   * somebody in the party who left an hour ago.
   *
   * Bounded to the last few megabytes: enough to cover a long play session,
   * small enough that attaching to a year-old log is still instant.
   */
  private async learnStandingFacts(
    character: string,
    path: string,
    size: number,
    ctx: ParseContext
  ): Promise<void> {
    const from = Math.max(0, size - HISTORY_SCAN_BYTES)
    try {
      const text = await readRange(path, from, size)
      const interesting = text.split('\n').filter(isStandingFact).join('\n')
      if (!interesting) return

      const { lines } = tokenizeChunk(interesting, character, 0)
      const standing: ParsedEvent[] = []
      for (const line of lines) {
        // Pet ownership is a side effect of the rule that matches it, so the
        // parse call is the whole job for pets. Group events come back and get
        // applied here.
        const ev = parseLine(line, ctx)
        if (ev.group !== undefined) this.applyGroup(character, ev)
        if (ev.kind === 'blessing') standing.push(ev)
      }
      if (standing.length > 0) this.events.onStandingFacts?.(standing)
      if (this.groups.get(character)?.size) this.events.onStatus(this.status())
    } catch {
      // Unreadable is not fatal - pets simply stay unattributed and the group
      // reads empty until the next join, which the tail will see live.
    }
  }

  private applyGroup(character: string, ev: ParsedEvent): void {
    const members = this.groups.get(character) ?? new Set<string>()
    this.groups.set(character, members)
    applyGroupEvent(members, ev, character)
  }

  private async poll(): Promise<void> {
    const batch: ParsedEvent[] = []
    let groupsChanged = false

    for (const tail of this.tails.values()) {
      if (tail.reading) continue

      let size: number
      try {
        size = statSync(tail.path).size
      } catch {
        continue // file vanished mid-session; the rescan will pick it back up
      }

      // The client rotates logs by truncating. A file that shrank is a new
      // file, so start over rather than reading from a stale offset into the
      // middle of a line.
      if (size < tail.offset) tail.offset = 0
      if (size === tail.offset) continue

      tail.reading = true
      try {
        const text = await readRange(tail.path, tail.offset, size)
        // Only consume up to the last complete line: a partial trailing line
        // means we caught the client mid-write, and it will be complete next
        // poll.
        const lastBreak = text.lastIndexOf('\n')
        if (lastBreak < 0) continue
        const usable = text.slice(0, lastBreak + 1)
        tail.offset += Buffer.byteLength(usable, 'utf8')

        const { lines, nextSeq } = tokenizeChunk(usable, tail.character, tail.seq)
        tail.seq = nextSeq
        for (const line of lines) {
          const event = parseLine(line, tail.ctx)
          if (event.kind === 'who' && event.target) this.players.add(event.target.name)
          // Keyed on `group` rather than on the kind: group chat carries a
          // membership fact while still being a chat line.
          if (event.group !== undefined) {
            this.applyGroup(tail.character, event)
            groupsChanged = true
          }
          batch.push(event)
          // The line's OWN timestamp, not the clock.
          //
          // On attach we rewind BACKFILL_BYTES and read forward, so the first
          // poll after launch consumes tens of thousands of lines that may be
          // hours old. Stamping those with `Date.now()` made every log look as
          // though it had just been written - so a character who logged out at
          // lunchtime showed as "live" for two minutes after every launch, and
          // `dropDeparted` could not tell a played log from a dead one either.
          //
          // Taking `event.ts` asks the right question: when did the game last
          // write to this file? A max rather than an assignment, because a
          // clock that ticks over mid-chunk can put lines slightly out of
          // order and liveness must never move backwards.
          if (tail.lastLineAt === null || event.ts > tail.lastLineAt) tail.lastLineAt = event.ts
        }
      } catch {
        // A locked or briefly unreadable file is normal on Windows while the
        // client flushes; the next poll retries from the same offset.
      } finally {
        tail.reading = false
      }
    }

    // The group roster rides on `watcher:status`, which is already pushed for
    // other reasons - so a join only costs a status push, not a new channel.
    if (groupsChanged) this.events.onStatus(this.status())

    if (batch.length === 0) {
      this.tracker?.tick(Date.now())
      return
    }

    // Order matters across logs: sort by timestamp, then by the per-source
    // sequence, so a second containing lines from three boxes stays coherent.
    batch.sort((a, b) => a.ts - b.ts || a.seq - b.seq)

    // The combat log shows the MERGED stream, not the raw one. Three boxes
    // means every third-party line - every mob swing, every kill - is written
    // three times, and a log that shows each of them three times is unreadable
    // and looks broken. Merge once, use it for both the display and the meter,
    // so what you read is exactly what was counted.
    const merged = mergeEvents(batch, this.mergeConfig())

    // feed() returns the enriched events, so the stream shows the same
    // attribution the meter used.
    this.events.onEvents(this.tracker?.feed(merged) ?? merged)
    this.tracker?.tick(Date.now())
  }
}

