import { useEffect, useState } from 'react'
import type { AlertHit } from '@shared/alerts'
import { playAlert, speak } from './sound'

/**
 * The alert sink.
 *
 * Alerts have to fire whatever page you are on - the whole point is that you
 * are looking at the game, not at this app - so the listener cannot live in
 * the Alerts page component. It is installed once, at app start, and keeps its
 * own rolling history that any page can read.
 */

const HISTORY = 60

let recent: AlertHit[] = []
let volume = 1
let installed = false
const listeners = new Set<(hits: AlertHit[]) => void>()

function emit(): void {
  for (const fn of listeners) fn(recent)
}

/** Call once, from the app root. */
export function installAlertSink(): () => void {
  if (installed) return () => {}
  installed = true

  const off = window.triune.on('alerts:fired', (hit) => {
    recent = [hit, ...recent].slice(0, HISTORY)
    playAlert(hit.rule.sound, volume)
    if (hit.speech) speak(hit.speech, volume)
    emit()
  })

  return () => {
    installed = false
    off()
  }
}

export function setAlertVolume(next: number): void {
  volume = Math.max(0, Math.min(1, next))
}

export function getAlertVolume(): number {
  return volume
}

/** Subscribe a component to the rolling history. */
export function useAlertHistory(): AlertHit[] {
  const [hits, setHits] = useState<AlertHit[]>(recent)
  useEffect(() => {
    listeners.add(setHits)
    setHits(recent)
    return () => {
      listeners.delete(setHits)
    }
  }, [])
  return hits
}
