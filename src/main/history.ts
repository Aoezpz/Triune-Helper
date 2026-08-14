import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Settings } from '@shared/ipc'
import { EncounterTracker } from '@shared/parser/encounter'
import { mergeEvents, type MergeConfig } from '@shared/parser/merge'
import { parseLine, type ParseContext } from '@shared/parser/patterns'
import { tokenizeChunk } from '@shared/parser/tokenize'
import type { Encounter, ParsedEvent } from '@shared/parser/types'
import { readRange } from './readrange'

/**
 * Rebuild the lifetime ledgers from every log on disk.
 *
 * The live watcher only ever sees what is written while it runs, so a folder
 * with a year of history in it starts the app at zero. This replays the lot.
 *
 * ---------------------------------------------------------------------------
 * The hard part is NOT reading the files. It is that a Logs folder is not one
 * session - it is every session you have ever played, including the trio you
 * retired in March and the alt you levelled on a different account last week.
 *
 * The trio merge rule assumes everyone was present at once: one log owns the
 * third-party events, everyone else's copy is a duplicate. Apply that across
 * characters who were never online together and it deletes their combat
 * outright, because the owner was not there to see it.
 *
 * So the replay splits the timeline into play sessions first - runs of activity
 * with no gap longer than half an hour - and picks an owner PER SESSION, being
 * whichever character wrote the most lines in it. Within a session that rule is
 * exactly the live one. Across sessions, each stands alone.
 * ---------------------------------------------------------------------------
 */

/** Gap that separates one play session from the next. */
const SESSION_GAP_MS = 30 * 60 * 1000

/**
 * Per file. A year of heavy play is a few hundred megabytes and holding all of
 * it as parsed objects would be worse than useless, so the oldest part of an
 * enormous log is skipped and the result says so.
 */
const MAX_BYTES_PER_FILE = 64 * 1024 * 1024

export interface RebuildProgress {
  phase: 'reading' | 'replaying'
  /** The file being read, during `reading`. */
  file?: string
  done: number
  total: number
}

export interface RebuildResult {
  files: number
  lines: number
  sessions: number
  /** Files whose oldest lines were skipped for size, if any. */
  truncated: string[]
  from: number | null
  to: number | null
}

export interface RebuildSinks {
  /** Wipe whatever the ledgers hold, so a rebuild is idempotent. */
  reset: () => void
  events: (events: ParsedEvent[]) => void
  fight: (enc: Encounter, selfNames: Set<string>) => void
}

export async function rebuildHistory(
  settings: Settings,
  sinks: RebuildSinks,
  onProgress?: (p: RebuildProgress) => void
): Promise<RebuildResult> {
  const empty: RebuildResult = {
    files: 0,
    lines: 0,
    sessions: 0,
    truncated: [],
    from: null,
    to: null
  }
  if (!settings.logFolder) return empty

  const server = settings.serverShortname.toLowerCase()
  const wanted = settings.watchedCharacters

  let names: string[]
  try {
    names = readdirSync(settings.logFolder)
  } catch {
    return empty
  }

  // Staleness is deliberately NOT applied here. A retired character's log is
  // exactly what this is for.
  const files: Array<{ character: string; path: string; size: number }> = []
  for (const file of names) {
    const m = /^eqlog_(.+)_(.+)\.txt$/i.exec(file)
    if (!m || m[2].toLowerCase() !== server) continue
    if (wanted.length > 0 && !wanted.includes(m[1])) continue
    try {
      files.push({ character: m[1], path: join(settings.logFolder, file), size: statSync(join(settings.logFolder, file)).size })
    } catch {
      // Unreadable file: skipped rather than aborting the whole rebuild.
    }
  }
  if (files.length === 0) return empty

  // Shared across every log, exactly as the live watcher shares them: a pet
  // learned in one file is a pet in all of them.
  const petOwners = new Map<string, string>()
  const players = new Set<string>(files.map((f) => f.character))
  const contexts = new Map<string, ParseContext>(
    files.map((f) => [f.character, { self: f.character, petOwners, players }])
  )

  const truncated: string[] = []
  let all: ParsedEvent[] = []

  for (const [i, f] of files.entries()) {
    onProgress?.({ phase: 'reading', file: f.character, done: i, total: files.length })

    const from = Math.max(0, f.size - MAX_BYTES_PER_FILE)
    if (from > 0) truncated.push(f.character)

    let text: string
    try {
      text = await readRange(f.path, from, f.size)
    } catch {
      continue
    }

    // A truncated read almost certainly starts mid-line; drop that fragment
    // rather than let the tokeniser reject it noisily.
    const usable = from > 0 ? text.slice(text.indexOf('\n') + 1) : text
    const { lines } = tokenizeChunk(usable, f.character, 0)
    const ctx = contexts.get(f.character) as ParseContext
    for (const line of lines) all.push(parseLine(line, ctx))
  }

  if (all.length === 0) return { ...empty, files: files.length }

  // One timeline. Ordering across files is by timestamp, then by the per-file
  // sequence, which is the same rule the live poller uses for a single batch.
  all.sort((a, b) => a.ts - b.ts || a.source.localeCompare(b.source) || a.seq - b.seq)

  sinks.reset()

  const sessions = splitSessions(all)
  let lines = 0

  for (const [i, session] of sessions.entries()) {
    onProgress?.({ phase: 'replaying', done: i, total: sessions.length })
    lines += session.length
    replaySession(session, settings, sinks)
  }

  return {
    files: files.length,
    lines,
    sessions: sessions.length,
    truncated,
    from: all[0]?.ts ?? null,
    to: all[all.length - 1]?.ts ?? null
  }
}

/** Runs of activity with no gap longer than half an hour. */
function splitSessions(events: ParsedEvent[]): ParsedEvent[][] {
  const out: ParsedEvent[][] = []
  let current: ParsedEvent[] = []

  for (const e of events) {
    const last = current[current.length - 1]
    if (last && e.ts - last.ts > SESSION_GAP_MS) {
      out.push(current)
      current = []
    }
    current.push(e)
  }
  if (current.length > 0) out.push(current)
  return out
}

/**
 * Replay one session under its own merge config.
 *
 * The owner is whoever wrote the most lines in this session - a better proxy
 * than "first alphabetically" for who was actually at the keyboard, and the
 * only one available after the fact.
 */
function replaySession(events: ParsedEvent[], settings: Settings, sinks: RebuildSinks): void {
  const counts = new Map<string, number>()
  for (const e of events) counts.set(e.source, (counts.get(e.source) ?? 0) + 1)

  const present = [...counts.keys()]
  const configured = settings.primaryCharacter
  const primary =
    configured && counts.has(configured)
      ? configured
      : [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]

  const cfg: MergeConfig = {
    selfBySource: new Map(present.map((c) => [c, c])),
    primarySource: primary,
    petOwners: new Map()
  }

  const selfNames = new Set(present)
  const tracker = new EncounterTracker({
    timeoutSeconds: settings.fightTimeoutSeconds,
    onClose: (enc) => sinks.fight(enc, selfNames)
  })

  const merged = mergeEvents(events, cfg)

  // Fed in chunks so the encounter tracker's idle timer gets a chance to close
  // fights as the replayed clock advances, rather than treating a whole night
  // as one enormous encounter.
  const CHUNK = 500
  for (let i = 0; i < merged.length; i += CHUNK) {
    const batch = merged.slice(i, i + CHUNK)
    sinks.events(tracker.feed(batch))
    tracker.tick(batch[batch.length - 1].ts)
  }

  // Close whatever was still open when the session ended.
  const last = merged[merged.length - 1]
  if (last) tracker.tick(last.ts + settings.fightTimeoutSeconds * 1000 + 1000)
}
