import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { rebuildHistory, type RebuildSinks } from '../src/main/history'
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/ipc'
import type { Encounter, ParsedEvent } from '../src/shared/parser/types'

/**
 * Replaying a Logs folder.
 *
 * The case that shapes the whole design: a Logs folder is not one session. It
 * is every session you have ever played, including characters who were never
 * online together. The trio merge rule assumes everyone was present at once, so
 * applying it across the whole folder deletes the combat of anyone who was not
 * the chosen owner - which is why the replay splits into play sessions first
 * and picks an owner per session.
 */

let dir: string

const stamp = (h: number, m: number, s: number): string => {
  const t = String(h).padStart(2, '0')
  return `[Wed Aug 12 ${t}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} 2026]`
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'triune-history-'))

  // Session one, 01:00 - Hexzo solo. A mob hits back, which is the line that
  // only survives if Hexzo owns third-party events in this session.
  writeFileSync(
    join(dir, 'eqlog_Hexzo_multiclass.txt'),
    [
      `${stamp(1, 0, 0)} You have entered Drunder, the Fortress of Zek.`,
      `${stamp(1, 0, 1)} You hit Diaku Guardian for 1000 points of damage.`,
      `${stamp(1, 0, 2)} Diaku Guardian hits YOU for 200 points of damage.`,
      `${stamp(1, 0, 3)} You have slain Diaku Guardian!`,
      `${stamp(1, 0, 4)} You gain experience!!`,
      `${stamp(1, 0, 5)} You receive 2 gold, 7 silver, 3 copper.`,
      ''
    ].join('\r\n')
  )

  // Session two, FOUR HOURS LATER - a different character entirely. Under a
  // single-primary replay this character's combat would be discarded, because
  // the owner picked for the folder was not present for any of it.
  writeFileSync(
    join(dir, 'eqlog_Confucius_multiclass.txt'),
    [
      `${stamp(5, 0, 0)} You have entered The Bazaar.`,
      `${stamp(5, 0, 1)} You hit a Gladiator for 500 points of damage.`,
      `${stamp(5, 0, 2)} a Gladiator hits YOU for 50 points of damage.`,
      `${stamp(5, 0, 3)} You have slain a Gladiator!`,
      `${stamp(5, 0, 4)} You gain experience!!`,
      `${stamp(5, 0, 5)} [NMS] Sunshard Ore sold for 5 silver.`,
      ''
    ].join('\r\n')
  )
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

const settings = (): Settings => ({ ...DEFAULT_SETTINGS, logFolder: dir })

function collect(): { sinks: RebuildSinks; events: ParsedEvent[]; fights: Encounter[]; resets: number } {
  const events: ParsedEvent[] = []
  const fights: Encounter[] = []
  const box = { resets: 0 }
  return {
    events,
    fights,
    get resets() {
      return box.resets
    },
    sinks: {
      reset: () => {
        box.resets += 1
      },
      events: (batch) => events.push(...batch),
      fight: (enc) => fights.push(enc)
    }
  }
}

describe('rebuildHistory', () => {
  it('reads every log in the folder, however old', () => {
    const c = collect()
    return rebuildHistory(settings(), c.sinks).then((r) => {
      expect(r.files).toBe(2)
      expect(r.lines).toBeGreaterThan(0)
      expect(r.truncated).toEqual([])
    })
  })

  it('splits the folder into play sessions on the gaps', async () => {
    // Four hours apart, so two sessions rather than one long one.
    const r = await rebuildHistory(settings(), collect().sinks)
    expect(r.sessions).toBe(2)
  })

  /**
   * The whole point. Both characters played alone, hours apart; both must keep
   * their combat. A folder-wide primary would keep one and bin the other.
   */
  it('keeps the combat of every character, not just one', async () => {
    const c = collect()
    await rebuildHistory(settings(), c.sinks)

    const slain = c.events.filter((e) => e.kind === 'death').map((e) => e.target?.name)
    expect(slain).toContain('Diaku Guardian')
    expect(slain).toContain('a Gladiator')

    // And the incoming hits, which are third-party events and so the ones the
    // merge rule would have dropped.
    const incoming = c.events.filter((e) => e.attacker?.kind === 'mob')
    expect(incoming.map((e) => e.attacker?.name).sort()).toEqual(['Diaku Guardian', 'a Gladiator'])
  })

  it('closes a fight in each session', async () => {
    const c = collect()
    await rebuildHistory(settings(), c.sinks)
    expect(c.fights.map((f) => f.name).sort()).toEqual(['Diaku Guardian', 'a Gladiator'])
  })

  it('clears the ledgers exactly once, so a rebuild is idempotent', async () => {
    const c = collect()
    await rebuildHistory(settings(), c.sinks)
    expect(c.resets).toBe(1)
  })

  it('reports the span it covered', async () => {
    const r = await rebuildHistory(settings(), collect().sinks)
    expect(r.from).not.toBeNull()
    expect(r.to).not.toBeNull()
    expect((r.to as number) - (r.from as number)).toBeGreaterThan(3 * 60 * 60 * 1000)
  })

  it('does nothing gracefully when the folder is empty', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'triune-empty-'))
    try {
      const c = collect()
      const r = await rebuildHistory({ ...DEFAULT_SETTINGS, logFolder: empty }, c.sinks)
      expect(r.files).toBe(0)
      // Nothing was cleared, because nothing was going to replace it.
      expect(c.resets).toBe(0)
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })

  it('honours an explicit character list', async () => {
    const c = collect()
    const r = await rebuildHistory(
      { ...DEFAULT_SETTINGS, logFolder: dir, watchedCharacters: ['Hexzo'] },
      c.sinks
    )
    expect(r.files).toBe(1)
    expect(c.events.some((e) => e.target?.name === 'a Gladiator')).toBe(false)
  })
})
