import { useEffect, useState } from 'react'
import type { CombatState } from '@shared/ipc'
import type { ParsedEvent } from '@shared/parser/types'

const EMPTY: CombatState = { live: null, history: [], overall: null }

/** Live combat state, pushed from main at 5 Hz. */
export function useCombat(): CombatState {
  const [state, setState] = useState<CombatState>(EMPTY)

  useEffect(() => {
    void window.triune.invoke('combat:get').then(setState)
    return window.triune.on('combat:state', setState)
  }, [])

  return state
}

/**
 * The rolling combat-log buffer.
 *
 * Main sends only the newly appended lines, so the renderer keeps its own
 * window rather than re-receiving the whole buffer five times a second.
 */
export function useCombatLines(
  limit = 400,
  includeUnparsed = false,
  /**
   * Server-wide discovery announcements. Off by default: they are the game
   * telling you what a stranger three zones away just looted, and at thirty an
   * hour they would push real combat off the top of the column.
   */
  includeBroadcasts = false
): ParsedEvent[] {
  const [lines, setLines] = useState<ParsedEvent[]>([])

  useEffect(() => {
    const wanted = (l: ParsedEvent): boolean =>
      (includeUnparsed || l.kind !== 'unparsed') && (includeBroadcasts || !l.broadcast)

    let alive = true
    void window.triune.invoke('combat:lines', { limit, includeUnparsed }).then((rows) => {
      if (alive) setLines(rows.filter(wanted))
    })

    const off = window.triune.on('combat:lines', (batch) => {
      const kept = batch.filter(wanted)
      if (kept.length === 0) return
      setLines((prev) => {
        const next = prev.concat(kept)
        return next.length > limit ? next.slice(next.length - limit) : next
      })
    })

    return () => {
      alive = false
      off()
    }
  }, [limit, includeUnparsed, includeBroadcasts])

  return lines
}
