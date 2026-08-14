import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_SETTINGS, type Settings, type WatcherStatus } from '@shared/ipc'

/**
 * Settings live in main (electron-store owns the file). The renderer keeps a
 * mirror and writes through - main's reply is the authority, so a rejected or
 * normalised value corrects the UI rather than the UI drifting from disk.
 */
export function useSettings(): {
  settings: Settings
  loaded: boolean
  update: (patch: Partial<Settings>) => Promise<void>
} {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    void window.triune.invoke('settings:get').then((s) => {
      if (alive) {
        setSettings(s)
        setLoaded(true)
      }
    })
    return () => {
      alive = false
    }
  }, [])

  const update = useCallback(async (patch: Partial<Settings>) => {
    setSettings(await window.triune.invoke('settings:set', patch))
  }, [])

  return { settings, loaded, update }
}

/** Live watcher status, refreshed by main's pushes. */
export function useWatcherStatus(): WatcherStatus | null {
  const [status, setStatus] = useState<WatcherStatus | null>(null)

  useEffect(() => {
    void window.triune.invoke('logs:status').then(setStatus)
    return window.triune.on('watcher:status', setStatus)
  }, [])

  return status
}
