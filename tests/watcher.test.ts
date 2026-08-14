import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, isLive, LIVE_WINDOW_MS, type Settings } from '../src/shared/ipc'
import { LogWatcher } from '../src/main/watcher'

/**
 * Which logs the watcher decides to read.
 *
 * The rule under test is a heuristic with real consequences in both
 * directions. Attach to too many and a folder of retired alts puts strangers
 * in your party strip and hands one of them ownership of your combat; attach
 * to too few - or let go of one too eagerly - and a character you are actually
 * playing silently stops being counted.
 */

let dir: string
const HOUR = 60 * 60 * 1000

const settings = (over: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  logFolder: dir,
  ...over
})

function writeLog(character: string, ageMs = 0): string {
  const path = join(dir, `eqlog_${character}_multiclass.txt`)
  writeFileSync(path, `[Wed Aug 12 01:00:00 2026] You have entered The Bazaar.\r\n`)
  if (ageMs > 0) {
    const when = new Date(Date.now() - ageMs)
    utimesSync(path, when, when)
  }
  return path
}

function silentWatcher(): LogWatcher {
  return new LogWatcher({
    onStatus: () => {},
    onEvents: () => {},
    onEncounter: () => {},
    onEncounterClosed: () => {}
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'triune-watch-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('choosing logs to tail', () => {
  it('attaches to a log the game wrote to recently', () => {
    writeLog('Hexzo')
    const w = silentWatcher()
    try {
      const status = w.start(settings())
      expect(status.sources.map((s) => s.character)).toEqual(['Hexzo'])
    } finally {
      w.stop()
    }
  })

  /** A folder of retired alts is the normal case, not the exception. */
  it('ignores a log nothing has written to in over a day', () => {
    writeLog('Hexzo')
    writeLog('RetiredAlt', 30 * HOUR)
    const w = silentWatcher()
    try {
      expect(w.start(settings()).sources.map((s) => s.character)).toEqual(['Hexzo'])
    } finally {
      w.stop()
    }
  })

  /** An explicit list is a decision and outranks the heuristic. */
  it('honours an explicit character list however old the file is', () => {
    writeLog('RetiredAlt', 30 * HOUR)
    const w = silentWatcher()
    try {
      const status = w.start(settings({ watchedCharacters: ['RetiredAlt'] }))
      expect(status.sources.map((s) => s.character)).toEqual(['RetiredAlt'])
    } finally {
      w.stop()
    }
  })

  it('ignores logs belonging to another server', () => {
    writeFileSync(join(dir, 'eqlog_Someone_povar.txt'), 'x\r\n')
    writeLog('Hexzo')
    const w = silentWatcher()
    try {
      expect(w.start(settings()).sources.map((s) => s.character)).toEqual(['Hexzo'])
    } finally {
      w.stop()
    }
  })

  /**
   * Tails used to be added and never removed, so a character logged out at
   * lunchtime was still a source at midnight - polled, listed in the character
   * picker, and shown on the party strip as "not grouped".
   */
  it('lets go of a log once it goes stale', () => {
    const hexzo = writeLog('Hexzo')
    writeLog('Parked')
    const w = silentWatcher()
    try {
      expect(w.start(settings()).sources).toHaveLength(2)

      // Parked logs out; its file stops being written.
      const old = new Date(Date.now() - 30 * HOUR)
      utimesSync(join(dir, 'eqlog_Parked_multiclass.txt'), old, old)
      // Hexzo is still playing.
      const now = new Date()
      utimesSync(hexzo, now, now)

      w.rescan()
      expect(w.status().sources.map((s) => s.character)).toEqual(['Hexzo'])
    } finally {
      w.stop()
    }
  })

  it('lets go of a log whose file has been deleted', () => {
    writeLog('Hexzo')
    writeLog('Doomed')
    const w = silentWatcher()
    try {
      expect(w.start(settings()).sources).toHaveLength(2)
      rmSync(join(dir, 'eqlog_Doomed_multiclass.txt'))
      w.rescan()
      expect(w.status().sources.map((s) => s.character)).toEqual(['Hexzo'])
    } finally {
      w.stop()
    }
  })

  /**
   * The dangerous direction. Being wrong here means a character somebody is
   * actively playing stops being counted, so an explicit list is never
   * second-guessed.
   */
  it('never lets go of an explicitly listed character', () => {
    writeLog('Hexzo')
    const w = silentWatcher()
    try {
      w.start(settings({ watchedCharacters: ['Hexzo'] }))
      const old = new Date(Date.now() - 30 * HOUR)
      utimesSync(join(dir, 'eqlog_Hexzo_multiclass.txt'), old, old)
      w.rescan()
      expect(w.status().sources.map((s) => s.character)).toEqual(['Hexzo'])
    } finally {
      w.stop()
    }
  })

  it('reports the folder it was pointed at and no error', () => {
    writeLog('Hexzo')
    const w = silentWatcher()
    try {
      const status = w.start(settings())
      expect(status.folder).toBe(dir)
      expect(status.error).toBeNull()
      expect(status.watching).toBe(true)
    } finally {
      w.stop()
    }
  })

  it('says so plainly when the folder does not exist', () => {
    const w = silentWatcher()
    try {
      const status = w.start(settings({ logFolder: join(dir, 'nope') }))
      expect(status.error).toMatch(/not found/i)
      expect(status.sources).toEqual([])
    } finally {
      w.stop()
    }
  })
})

/**
 * Whether a character is actually online.
 *
 * Attaching to a log and the character being logged in are different facts,
 * and the Overview badge claims the second. The only evidence in the file is
 * when the game last wrote to it - which is the timestamp on the last line,
 * not the moment we happened to read it. Reading is what we control; writing
 * is what the player did.
 */
describe('liveness', () => {
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  /** A log whose newest line is `ageMs` old, with an mtime to match. */
  function writeAged(character: string, ageMs: number): void {
    const at = new Date(Date.now() - ageMs)
    const p = (n: number): string => String(n).padStart(2, '0')
    const stamp = `[Sun ${MON[at.getMonth()]} ${p(at.getDate())} ${p(at.getHours())}:${p(at.getMinutes())}:${p(at.getSeconds())} ${at.getFullYear()}]`
    const path = join(dir, `eqlog_${character}_multiclass.txt`)
    writeFileSync(path, `${stamp} You have entered The Bazaar.\r\n`)
    utimesSync(path, at, at)
  }

  it('calls a character live when the game has just written for them', async () => {
    writeAged('Hexzo', 5_000)
    const w = silentWatcher()
    try {
      w.start(settings())
      await w.drain()
      expect(w.status().sources[0].active).toBe(true)
    } finally {
      w.stop()
    }
  })

  /**
   * The regression this exists for. On attach the watcher rewinds 64KB and
   * reads forward, so the first poll consumes lines that may be hours old.
   * Stamping those with the wall clock made every attached log - including a
   * character logged out since lunchtime - read as live for two minutes after
   * every launch.
   */
  it('does not call a character live because we have only just read their old lines', async () => {
    writeAged('Confucius', 3 * HOUR)
    const w = silentWatcher()
    try {
      w.start(settings())
      await w.drain()
      const [source] = w.status().sources
      expect(source.character).toBe('Confucius')
      expect(source.active).toBe(false)
      // And the reported time is the line's, so the UI can say how long ago.
      expect(Date.now() - (source.lastLineAt as number)).toBeGreaterThan(2 * HOUR)
    } finally {
      w.stop()
    }
  })
})


/**
 * Liveness has to decay on its own.
 *
 * `LogSource.active` is computed when main builds a status, and main pushes a
 * status when something CHANGES. A character logging out changes nothing main
 * can observe - the file simply stops growing - so the pushed flag stayed true
 * and the Overview showed a camped character as LIVE indefinitely. The renderer
 * recomputes from `lastLineAt` against a ticking clock instead.
 */
describe('isLive', () => {
  const NOW = 1_700_000_000_000

  it('is true just inside the window and false just outside it', () => {
    expect(isLive(NOW - (LIVE_WINDOW_MS - 1000), NOW)).toBe(true)
    expect(isLive(NOW - (LIVE_WINDOW_MS + 1000), NOW)).toBe(false)
  })

  /** The bug, stated directly: same data, later clock, different answer. */
  it('goes quiet as time passes with no new status push', () => {
    const lastLine = NOW
    expect(isLive(lastLine, NOW + 30_000)).toBe(true)
    expect(isLive(lastLine, NOW + 5 * 60_000)).toBe(false)
  })

  it('is false for a log that has produced nothing yet', () => {
    expect(isLive(null, NOW)).toBe(false)
  })
})