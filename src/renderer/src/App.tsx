import { useEffect, useMemo, useState } from 'react'
import { installAlertSink, setAlertVolume } from './alerts/sink'
import { setVoicePersona } from './alerts/sound'
import { applyTheme } from '@shared/themes'
import { PAGE_IDS, Sidebar, type PageId } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { useSettings, useWatcherStatus } from './hooks/useSettings'
import { Alerts } from './pages/Alerts'
import { Combat, type View } from './pages/Combat'
import { Leveling } from './pages/Leveling'
import { Loot } from './pages/Loot'
import { Zones } from './pages/Zones'
import { Mobs } from './pages/Mobs'
import { Overview } from './pages/Overview'
import { Preferences } from './pages/Preferences'
import { Leaderboards } from './pages/Leaderboards'
import { Progression } from './pages/Progression'
import { Timers } from './pages/Timers'
import { Server, type ServerView } from './pages/Server'
import { installTimers } from './timers/store'

/** Injected from package.json at build time - see electron.vite.config.ts. */
declare const __APP_VERSION__: string
const VERSION = __APP_VERSION__


export default function App(): JSX.Element {
  const [page, setPage] = useState<PageId>('overview')
  const { settings, loaded, update } = useSettings()
  const status = useWatcherStatus()

  // Alerts must sound whatever page you're on, so the listener lives here at
  // the root rather than inside the Alerts page.
  useEffect(installAlertSink, [])

  // Same reasoning for countdowns: a timer that only ticks while its own page
  // is open is a timer you will miss.
  useEffect(installTimers, [])

  // Voice and volume live in settings, so they survive a restart and apply
  // wherever a sound is played from.
  useEffect(() => {
    if (!loaded) return
    setVoicePersona(settings.voice)
    setAlertVolume(settings.alertVolume)
  }, [loaded, settings.voice, settings.alertVolume])

  // The scheme is one attribute on <html>; every colour in the app is a token
  // under it, so nothing here has to know which colours exist.
  useEffect(() => {
    if (loaded) applyTheme(settings.theme, document.documentElement)
  }, [loaded, settings.theme])


  // Restore the last section once settings arrive, then persist every move, so
  // relaunching lands where you left off rather than back at the splash.
  const [restored, setRestored] = useState(false)
  useEffect(() => {
    if (!loaded || restored) return
    setRestored(true)
    if (PAGE_IDS.includes(settings.lastPage as PageId)) setPage(settings.lastPage as PageId)
  }, [loaded, restored, settings.lastPage])

  const navigate = (id: PageId): void => {
    setPage(id)
    void update({ lastPage: id })
  }

  // Characters come from whatever the watcher actually found on disk, not from
  // a stored list, so a renamed or deleted log never leaves a ghost entry.
  const characters = useMemo(() => (status?.sources ?? []).map((s) => s.character), [status])

  /**
   * Which character you are playing.
   *
   * Persisted, because it decides whose group the party strip describes - a
   * boxed pair who are not grouped have no party at all until the app knows
   * which of them is "you".
   *
   * The fallback is the log written to most recently, NOT the first one. The
   * source list is sorted by name so the trio slot colours stay put, and
   * taking its first entry meant the app opened by declaring whichever
   * character sorts earliest to be you - an alt parked in the Bazaar, or in at
   * least one real folder a GM account that never fights.
   */
  const current = useMemo(() => {
    const stored = settings.activeCharacter
    if (stored && characters.includes(stored)) return stored
    const busiest = [...(status?.sources ?? [])]
      .filter((s) => s.lastLineAt !== null)
      .sort((a, b) => (b.lastLineAt as number) - (a.lastLineAt as number))[0]
    return busiest?.character ?? characters[0] ?? null
  }, [settings.activeCharacter, characters, status])

  return (
    <div className="app">
      <TitleBar
        characters={characters}
        active={current}
        onSelect={(name) => void update({ activeCharacter: name })}
        server={settings.serverShortname}
        live={!!status?.watching}
      />
      <Sidebar page={page} onNavigate={navigate} version={VERSION} />
      <main className="main">
        {page === 'overview' && (
          <Overview
            status={status}
            active={current}
            onGoToPreferences={() => navigate('preferences')}
            onNavigate={navigate}
          />
        )}
        {page === 'combat' && (
          <Combat
            characters={characters}
            active={current}
            view={(settings.combatView as View) ?? 'dashboard'}
            onView={(v) => void update({ combatView: v })}
          />
        )}
        {page === 'progression' && <Progression />}
        {page === 'leaderboards' && <Leaderboards />}
        {page === 'alerts' && <Alerts />}
        {page === 'leveling' && <Leveling characters={characters} />}
        {page === 'loot' && <Loot />}
        {page === 'zones' && <Zones />}
        {page === 'mobs' && <Mobs />}
        {page === 'timers' && <Timers />}
        {page === 'server' && (
          <Server
            view={(settings.serverView as ServerView) ?? 'blessings'}
            onView={(v) => void update({ serverView: v })}
          />
        )}
        {page === 'preferences' && <Preferences settings={settings} update={update} status={status} />}
      </main>
    </div>
  )
}
