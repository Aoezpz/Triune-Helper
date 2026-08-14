import { useEffect, useState } from 'react'
import { EMPTY_ROSTER, type RosterState } from '@shared/roster'

/**
 * Who everyone is.
 *
 * Pushed rather than polled, because lookups finish at whatever pace the site
 * answers - a name resolved ten seconds into a fight should light up then,
 * not on the next render that happens to ask.
 */
export function useRoster(): RosterState {
  const [state, setState] = useState<RosterState>(EMPTY_ROSTER)

  useEffect(() => {
    void window.triune.invoke('roster:get').then(setState)
    return window.triune.on('roster:changed', setState)
  }, [])

  return state
}
