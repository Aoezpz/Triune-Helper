import type { ParsedEvent } from './parser/types'

/**
 * Plane of Time flagging.
 *
 * The structure is bundled (see scripts/export-progression.mjs, which lifts it
 * from PTDex). The STATE is the app's own: a step is earned the moment its
 * boss dies in your log, which is what makes this live rather than a page you
 * refresh after a raid.
 *
 * Not every step is a kill. "Plead Mavuin's case" and "Passage to the Halls of
 * Honor" are things you do, and no log line reliably marks them - those are
 * ticked by hand, and the UI says so rather than pretending it detected them.
 */

export interface ProgStep {
  name: string
  /** "2 stages" and similar, straight from the page. */
  badge: string | null
  stages: number
  npcId: number | null
  zone: string | null
  zoneId: number | null
  zoneShort: string | null
  level: number | null
  /** How to get it, for the steps that aren't just "kill this". */
  how: string | null
}

export interface ProgGroup {
  plane: string | null
  planeShort: string | null
  steps: ProgStep[]
}

export interface ProgChapter {
  id: string
  title: string
  era: string | null
  blurb: string | null
  opens: string | null
  rows: number
  stages: number
  badgeCount: number | null
  groups: ProgGroup[]
}

export interface ProgSection {
  id: string
  name: string
  detail: string
  chapters: ProgChapter[]
}

export interface ProgressionData {
  source: string
  extractedAt: string
  note: string
  sections: ProgSection[]
}

/** How a step came to be marked done. */
export type ProgSource = 'log' | 'manual' | 'ptdex'

export interface ProgMark {
  at: number
  source: ProgSource
  /** Which character's log saw it, when we know. */
  by?: string
}

/** stepKey -> mark. Flat, because flags are account-wide on this server. */
export type ProgressState = Record<string, ProgMark>

/** Stable id for a step: chapter + name, so renaming a chapter is visible. */
export function stepKey(chapterId: string, step: ProgStep): string {
  return `${chapterId}/${step.name.toLowerCase()}`
}

/**
 * Steps that no log line announces. Detected by shape rather than a hardcoded
 * list: a step with no NPC behind it is something you do, not something you
 * kill, so it can only be ticked by hand.
 */
export function isManualStep(step: ProgStep): boolean {
  return step.npcId === null
}

/** Every step, flattened, with the chapter it belongs to. */
export function allSteps(data: ProgressionData): Array<{
  section: ProgSection
  chapter: ProgChapter
  group: ProgGroup
  step: ProgStep
  key: string
}> {
  const out: Array<{
    section: ProgSection
    chapter: ProgChapter
    group: ProgGroup
    step: ProgStep
    key: string
  }> = []
  for (const section of data.sections) {
    for (const chapter of section.chapters) {
      for (const group of chapter.groups) {
        for (const step of group.steps) {
          out.push({ section, chapter, group, step, key: stepKey(chapter.id, step) })
        }
      }
    }
  }
  return out
}

/**
 * Index of killable step names, lowercased, for O(1) lookup against every
 * death event. Built once and reused - a linear scan of 56 steps per kill line
 * would be fine, but this also collapses the "which chapter was that" question
 * into the same lookup.
 */
export function buildKillIndex(data: ProgressionData): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const { step, key } of allSteps(data)) {
    if (isManualStep(step)) continue
    const name = step.name.toLowerCase()
    const keys = index.get(name)
    if (keys) keys.push(key)
    else index.set(name, [key])
  }
  return index
}

/**
 * Scan events for kills that complete a step.
 *
 * Returns only NEW marks, so the caller can tell the difference between "you
 * just flagged" - which is worth announcing - and "you killed Nagafen again".
 */
export function detectProgress(
  events: ParsedEvent[],
  index: Map<string, string[]>,
  current: ProgressState
): Record<string, ProgMark> {
  const fresh: Record<string, ProgMark> = {}

  for (const e of events) {
    if (e.kind !== 'death') continue
    const target = e.target?.name
    if (!target) continue
    // A player dying is not a flag, however much it feels like one.
    if (e.target?.kind === 'self') continue

    const keys = index.get(target.toLowerCase())
    if (!keys) continue

    for (const key of keys) {
      if (current[key] || fresh[key]) continue
      fresh[key] = { at: e.ts, source: 'log', by: e.attacker?.name }
    }
  }

  return fresh
}

export interface ProgressSummary {
  earned: number
  total: number
  /** Per-section and per-chapter tallies, for the headline and the rails. */
  sections: Array<{
    id: string
    name: string
    earned: number
    total: number
    chapters: Array<{ id: string; title: string; earned: number; total: number }>
  }>
  /** The next few unfinished steps, nearest chapter first. */
  next: Array<{ key: string; step: ProgStep; chapter: string; plane: string | null }>
}

export function summarizeProgress(
  data: ProgressionData,
  state: ProgressState,
  nextLimit = 6
): ProgressSummary {
  const sections = data.sections.map((section) => {
    const chapters = section.chapters.map((chapter) => {
      let earned = 0
      let total = 0
      for (const group of chapter.groups) {
        for (const step of group.steps) {
          total += 1
          if (state[stepKey(chapter.id, step)]) earned += 1
        }
      }
      return { id: chapter.id, title: chapter.title, earned, total }
    })
    return {
      id: section.id,
      name: section.name,
      earned: chapters.reduce((n, c) => n + c.earned, 0),
      total: chapters.reduce((n, c) => n + c.total, 0),
      chapters
    }
  })

  const next: ProgressSummary['next'] = []
  for (const { chapter, group, step, key } of allSteps(data)) {
    if (next.length >= nextLimit) break
    if (state[key]) continue
    next.push({ key, step, chapter: chapter.title, plane: group.plane })
  }

  return {
    earned: sections.reduce((n, s) => n + s.earned, 0),
    total: sections.reduce((n, s) => n + s.total, 0),
    sections,
    next
  }
}
