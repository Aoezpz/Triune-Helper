import { useEffect, useState } from 'react'
import type { AlertSound } from '@shared/alerts'
import type { ManualTimer, TimersData } from '@shared/timers'
import { getAlertVolume } from '../alerts/sink'
import { playAlert, speak } from '../alerts/sound'

/**
 * Timer state, and the thing that makes the noise.
 *
 * Same shape as the alert sink and for the same reason: a countdown is only
 * useful if it goes off while you are looking at the game, so the tick cannot
 * live inside the Timers page. It runs from app start, at module scope, and
 * pages subscribe to it.
 *
 * Deliberately NOT React state at the app root. A half-second tick held in a
 * root component re-renders the entire tree twice a second, including whatever
 * hundred-row table you happen to be on. Here the tick only re-renders
 * subscribers, and the display clock on the Timers page is local to that page.
 */

const EMPTY: TimersData = { manual: [], spawns: [], tracked: [] }
const TICK_MS = 500
const POLL_MS = 3000

let data: TimersData = EMPTY
let installed = false
let primed = false
const listeners = new Set<(d: TimersData) => void>()

/**
 * Deadlines already announced.
 *
 * Keyed by deadline as well as id, so restarting a timer arms it again while a
 * finished one stays quiet - which is what makes a stopped-but-expired timer
 * safe to leave sitting on the page.
 */
const fired = new Set<string>()

function emit(next: TimersData): void {
  data = next
  for (const fn of listeners) fn(data)
}

function announce(text: string, sound: AlertSound): void {
  if (sound === 'none') return
  const volume = getAlertVolume()
  playAlert(sound, volume)
  speak(text, volume)
}

/**
 * On the first load, everything already past its deadline is marked as heard.
 *
 * Without this, opening the app after a night away fires one alarm per pinned
 * mob and one per timer that expired while it was shut - a wall of noise
 * announcing nothing that just happened.
 */
function prime(d: TimersData): void {
  const now = Date.now()
  for (const t of d.manual) {
    if (t.endsAt !== null && t.endsAt <= now) fired.add(`${t.id}@${t.endsAt}`)
  }
  for (const s of d.spawns) {
    if (s.dueAt !== null && s.dueAt <= now) fired.add(`spawn:${s.mob}@${s.dueAt}`)
  }
  primed = true
}

function tick(): void {
  if (!primed) return
  const now = Date.now()
  let changed = false

  const manual = data.manual.map((t) => {
    if (t.endsAt === null || now < t.endsAt) return t

    const key = `${t.id}@${t.endsAt}`
    if (!fired.has(key)) {
      fired.add(key)
      announce(t.label || 'Timer', t.sound)
    }

    if (!t.repeat) return t

    // Roll forward by whole periods rather than adding one. If the machine
    // slept through six cycles of a ten-minute repeat, the timer should come
    // back showing the time left on the current cycle - not six alarms deep.
    changed = true
    const period = Math.max(1, t.seconds) * 1000
    const missed = Math.floor((now - t.endsAt) / period) + 1
    return { ...t, endsAt: t.endsAt + missed * period }
  })

  for (const s of data.spawns) {
    // Only mobs you pinned are allowed to make a sound. The suggestion list is
    // a guess the app made; it does not get to interrupt you.
    if (!s.tracked || s.dueAt === null || now < s.dueAt) continue
    const key = `spawn:${s.mob}@${s.dueAt}`
    if (fired.has(key)) continue
    fired.add(key)
    announce(`${s.mob} may be up`, 'chime')
  }

  prune()
  if (changed) void save(manual)
}

/**
 * Forget deadlines that can no longer come round again.
 *
 * This set must not simply be cleared when it gets large. A finished
 * non-repeating timer keeps its past deadline for as long as it sits on the
 * page, so dropping its key re-arms it and it announces itself a second time
 * out of nowhere - which, with one repeating timer running, was reachable in
 * an evening. Only keys that no longer correspond to a live deadline go.
 */
function prune(): void {
  if (fired.size <= 200) return
  const live = new Set<string>()
  for (const t of data.manual) {
    if (t.endsAt !== null) live.add(`${t.id}@${t.endsAt}`)
  }
  for (const s of data.spawns) {
    if (s.dueAt !== null) live.add(`spawn:${s.mob}@${s.dueAt}`)
  }
  for (const key of fired) {
    if (!live.has(key)) fired.delete(key)
  }
}

/** Call once, from the app root. */
export function installTimers(): () => void {
  if (installed) return () => {}
  installed = true

  const load = (): void => {
    void window.triune.invoke('timers:get').then((d) => {
      if (!primed) prime(d)
      emit(d)
    })
  }

  load()
  const poll = window.setInterval(load, POLL_MS)
  const beat = window.setInterval(tick, TICK_MS)

  return () => {
    installed = false
    primed = false
    window.clearInterval(poll)
    window.clearInterval(beat)
  }
}

export function useTimers(): TimersData {
  const [state, setState] = useState<TimersData>(data)
  useEffect(() => {
    listeners.add(setState)
    setState(data)
    return () => {
      listeners.delete(setState)
    }
  }, [])
  return state
}

/* ---------------------------------------------------------------------------
   Mutations. Every one round-trips through main, so the store on disk and the
   store in memory can never disagree about what is running.
--------------------------------------------------------------------------- */

export async function save(manual: ManualTimer[]): Promise<void> {
  emit(await window.triune.invoke('timers:save', manual))
}

export async function track(mob: string, on: boolean): Promise<void> {
  const next = await window.triune.invoke('timers:track', { mob, on })
  // A mob pinned right now is usually long overdue; priming it here keeps the
  // act of pinning from immediately shouting at you.
  const now = Date.now()
  for (const s of next.spawns) {
    if (s.dueAt !== null && s.dueAt <= now) fired.add(`spawn:${s.mob}@${s.dueAt}`)
  }
  emit(next)
}

export function patch(id: string, changes: Partial<ManualTimer>): Promise<void> {
  return save(data.manual.map((t) => (t.id === id ? { ...t, ...changes } : t)))
}

export function remove(id: string): Promise<void> {
  return save(data.manual.filter((t) => t.id !== id))
}

export function add(timer: ManualTimer): Promise<void> {
  return save([...data.manual, timer])
}
