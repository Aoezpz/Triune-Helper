import { readFileSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type {
  CombatState,
  OverlayPreset,
  PtdexSyncResult,
  Settings,
  WatcherStatus
} from '@shared/ipc'
import type { ParsedEvent } from '@shared/parser/types'
import { Alerts } from './alerts'
import { rebuildHistory } from './history'
import { getLeaderboard } from './leaderboard'
import { Leveling } from './leveling'
import { Loot } from './loot'
import { Mobs } from './mobs'
import { Timers } from './timers'
import { Buffs } from './buffs'
import { Presence } from './presence'
import { ServerWatch } from './server'
import {
  closeOverlays,
  overlayState,
  overlayWindows,
  restoreOverlays,
  setOverlayLock,
  toggleOverlay
} from './overlay'
import { Progress } from './progress'
import { fetchProgress, findCharacter } from './ptdex'
import { Roster } from './roster'
import { Session } from './session'
import { Zones } from './zones'
import { flushTooltips, lookupTip } from './tooltips'
import { autodetectLogFolder, getSettings, setSettings } from './settings'
import { createMainWindow } from './windows'

let mainWindow: BrowserWindow | null = null

const isDev = !app.isPackaged

/**
 * Push to every one of our windows, not just the main one - the overlays draw
 * from the same live state, so a push that only reached the main window would
 * leave them frozen the moment you minimised it.
 */
function send<T>(channel: string, payload: T): void {
  const targets = [mainWindow, ...overlayWindows()]
  for (const win of targets) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

const progress = new Progress((keys, summary) =>
  send('progress:flagged', { keys, summary, state: progress.marks() })
)

const alerts = new Alerts((hit) => send('alerts:fired', hit))
const leveling = new Leveling()
const loot = new Loot()
const zones = new Zones()
const mobs = new Mobs()
// Reads the mob ledger on demand rather than holding a copy, so a history
// rebuild improves every spawn estimate without any wiring between the two.
const timers = new Timers(mobs)
const serverWatch = new ServerWatch()
const presence = new Presence()
const buffs = new Buffs()

const roster = new Roster({
  base: () => getSettings().ptdexBase,
  onChange: (state) => send('roster:changed', state)
})

const session = new Session(
  {
    status: (s: WatcherStatus) => {
      // Group membership arrives on the status push, so this is also where the
      // app learns there is somebody new to look up.
      roster.setGroups(Object.fromEntries(s.sources.map((src) => [src.character, src.group])))
      send('watcher:status', s)
    },
    state: (s: CombatState) => send('combat:state', s),
    lines: (l: ParsedEvent[]) => send('combat:lines', l)
  },
  (events) => {
    progress.observe(events)
    alerts.observe(events)
    leveling.observe(events)
    loot.observe(events)
    zones.observe(events)
    roster.observe(events)
    serverWatch.observe(events)
    presence.observe(events)
    buffs.observe(events)
  },
  /**
   * Read out of the log's past on attach, so a world blessing announced hours
   * before the app opened still shows its countdown. Only the server watch
   * listens: its state is REPLACED by name rather than accumulated, so
   * re-reading the same broadcast on every restart is harmless. Feeding these
   * to the meter or the ledgers would double them.
   */
  (events) => serverWatch.observe(events),
  (enc, selfNames) => mobs.observe(enc, selfNames)
)

/**
 * Dev-only screenshot hook. Watch a file for a path, capture the window to it.
 *
 * Screen-scraping the window from outside is unreliable: a restored window
 * doesn't always raise above the foreground app, so the grab silently captures
 * whatever is behind it. capturePage() renders from the compositor and doesn't
 * care about z-order, focus, or which monitor the window is on.
 *
 * Guarded on !isPackaged, so it does not exist in a shipped build.
 */
function enableDevCapture(): void {
  if (!isDev) return
  ipcMain.handle('dev:capture', async (_e, file: string): Promise<string> => {
    if (!mainWindow) throw new Error('no window')
    const image = await mainWindow.webContents.capturePage()
    await writeFile(file, image.toPNG())
    return file
  })
  // Also drivable from a terminal: write a short script into
  // <userData>/capture-request.txt, one verb per line.
  //
  //   target meter          switch to an overlay window (default: main)
  //   click  640 410        a real mouse click, through the compositor
  //   hover  700 520        park the cursor somewhere and leave it there
  //   wait   600            milliseconds
  //   shot   C:\out.png     write the window to a PNG
  //
  // The click and hover verbs go through sendInputEvent rather than any test
  // hook in the renderer, so what they exercise is the same event path a hand
  // on a mouse produces - which is the only way to see a hover card, since a
  // hover card by definition has no state anything else can set.
  const request = join(app.getPath('userData'), 'capture-request.txt')

  const windowFor = (name: string): BrowserWindow | null | undefined =>
    name === 'main'
      ? mainWindow
      : overlayWindows().find((w) => w.webContents.getURL().includes(`preset=${name}`))

  let busy = false
  setInterval(() => {
    if (busy) return
    let script: string
    try {
      script = readFileSync(request, 'utf8').trim()
    } catch {
      return // no request pending, which is the normal case
    }
    rmSync(request, { force: true })
    if (!script) return

    busy = true
    void (async () => {
      // A bare path with no verb is the old one-line form: just take a shot.
      const lines = script.includes('\n') || /^(target|click|hover|wait|shot)\s/.test(script)
        ? script.split('\n')
        : [`shot ${script.includes('|') ? script.split('|')[1] : script}`]

      let target = windowFor(script.includes('|') && !script.includes('\n') ? script.split('|')[0] : 'main')

      for (const raw of lines) {
        const [verb, ...rest] = raw.trim().split(/\s+/)
        const arg = rest.join(' ')
        if (!target || target.isDestroyed()) break

        if (verb === 'target') target = windowFor(arg)
        else if (verb === 'wait') await new Promise((r) => setTimeout(r, Number(arg) || 0))
        else if (verb === 'shot') {
          const img = await target.webContents.capturePage()
          await writeFile(arg, img.toPNG())
        } else if (verb === 'click' || verb === 'hover') {
          const [x, y] = rest.map(Number)
          // Synthetic input is delivered to the focused web contents; without
          // this a script aimed at a window the user has since clicked away
          // from lands nowhere and looks like a coordinate mistake.
          target.webContents.focus()
          target.webContents.sendInputEvent({ type: 'mouseMove', x, y })
          if (verb === 'click') {
            target.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
            target.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
          }
        }
      }
      busy = false
    })()
  }, 700).unref()
}

/** Any settings change that affects tailing restarts the watcher. */
const WATCH_KEYS: Array<keyof Settings> = [
  'logFolder',
  'watchedCharacters',
  'primaryCharacter',
  'fightTimeoutSeconds',
  'serverShortname'
]

function registerIpc(): void {
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return mainWindow.isMaximized()
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)

  ipcMain.handle('settings:get', (): Settings => getSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>): Settings => {
    const before = getSettings()
    const next = setSettings(patch)

    if (WATCH_KEYS.some((k) => k in patch)) {
      // Pointing at a different folder means a different set of characters, so
      // every fight already in the session belongs to somebody else. Keeping
      // them leaves the roster showing names from the old folder while the
      // stream shows the new one, which reads as the app being broken.
      if (patch.logFolder !== undefined && patch.logFolder !== before.logFolder) {
        session.reset()
        send('combat:state', session.state())
      }
      send('watcher:status', session.start(next))
    }

    // The overlays are separate windows that never call settings:get again
    // after they open, so a scheme picked in the main window would not reach
    // them until they were reopened. Pushed to everyone instead.
    if (patch.theme !== undefined && patch.theme !== before.theme) send('settings:theme', next.theme)

    return next
  })

  ipcMain.handle('logs:pickFolder', async (): Promise<string | null> => {
    if (!mainWindow) return null
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Select your EverQuest Logs folder',
      properties: ['openDirectory'],
      defaultPath: getSettings().logFolder || undefined
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const folder = res.filePaths[0]
    if (folder !== getSettings().logFolder) session.reset()
    send('watcher:status', session.start(setSettings({ logFolder: folder })))
    send('combat:state', session.state())
    return folder
  })

  ipcMain.handle('logs:autodetect', (): string | null => {
    const found = autodetectLogFolder(getSettings().serverShortname)
    if (found) {
      if (found !== getSettings().logFolder) session.reset()
      send('watcher:status', session.start(setSettings({ logFolder: found })))
      send('combat:state', session.state())
    }
    return found
  })

  ipcMain.handle('logs:status', (): WatcherStatus => session.status())
  ipcMain.handle('logs:restart', (): WatcherStatus => {
    session.reset()
    return session.start(getSettings())
  })

  ipcMain.handle('combat:get', (): CombatState => session.state())
  ipcMain.handle('combat:events', (_e, { fightId }: { fightId: string }): ParsedEvent[] =>
    session.eventsFor(fightId)
  )

  ipcMain.handle('progress:get', () => ({
    data: progress.data(),
    state: progress.marks(),
    summary: progress.summary()
  }))
  ipcMain.handle('progress:reset', () => progress.reset())

  /**
   * Pull flags and levels off PTDex for every character being tailed.
   *
   * Per character rather than once, because each has its own page - and while
   * flags are account-wide on this server, levels are not. Failures are
   * reported per character instead of aborting the whole sync: one renamed or
   * anonymous character should not stop the other two syncing.
   */
  ipcMain.handle('ptdex:sync', async (): Promise<PtdexSyncResult> => {
    const base = getSettings().ptdexBase
    const characters = session.status().sources.map((s) => s.character)

    if (!base || characters.length === 0) {
      return {
        characters: characters.map((name) => ({
          name,
          found: false,
          id: null,
          level: null,
          earned: 0,
          error: base ? null : 'No PTDex address configured.',
          unknownSteps: []
        })),
        summary: progress.summary(),
        state: progress.marks()
      }
    }

    const results: PtdexSyncResult['characters'] = []

    for (const name of characters) {
      try {
        const found = await findCharacter(base, name)
        if (!found) {
          results.push({
            name,
            found: false,
            id: null,
            level: null,
            earned: 0,
            error: 'No character with that exact name on PTDex.',
            unknownSteps: []
          })
          continue
        }

        const prog = await fetchProgress(base, found, progress.data())
        progress.merge(prog.earned, 'ptdex')
        if (prog.character.level) leveling.setLevel(name, prog.character.level)
        // The progression page carries the race and the class chips, so this is
        // the most complete identity the app ever sees - hand it to the roster
        // rather than making it fetch the same character again.
        roster.put({ ...prog.character, name })

        results.push({
          name,
          found: true,
          id: found.id,
          level: prog.character.level,
          earned: prog.earned.length,
          error: null,
          unknownSteps: prog.unknownSteps
        })
      } catch (err) {
        results.push({
          name,
          found: false,
          id: null,
          level: null,
          earned: 0,
          error: (err as Error).message,
          unknownSteps: []
        })
      }
    }

    return { characters: results, summary: progress.summary(), state: progress.marks() }
  })
  ipcMain.handle('progress:set', (_e, { key, earned }: { key: string; earned: boolean }) =>
    progress.set(key, earned)
  )

  ipcMain.handle('roster:get', () => roster.state())
  ipcMain.handle('roster:refresh', (_e, opts: { names?: string[] } = {}) =>
    roster.refresh(
      opts?.names && opts.names.length > 0
        ? opts.names
        : // Default: everyone the app can see - your boxes and their group.
          [
            ...new Set(
              session.status().sources.flatMap((s) => [s.character, ...s.group])
            )
          ]
    )
  )

  ipcMain.handle('loot:get', () => loot.data())
  ipcMain.handle('loot:reset', () => loot.reset())
  ipcMain.handle('zones:get', () => zones.data())
  ipcMain.handle('zones:reset', () => zones.reset())
  ipcMain.handle('mobs:get', () => mobs.data())
  ipcMain.handle('mobs:reset', () => mobs.reset())

  ipcMain.handle('timers:get', () => timers.data())
  ipcMain.handle('timers:save', (_e, list) => timers.save(list))
  ipcMain.handle('timers:track', (_e, { mob, on }) => timers.track(mob, on))

  ipcMain.handle('server:get', () => serverWatch.data())
  ipcMain.handle('server:reset', () => serverWatch.reset())
  ipcMain.handle('presence:get', () => presence.data())
  ipcMain.handle('buffs:get', () => buffs.data())


  /**
   * Replay every log on disk into the lifetime ledgers.
   *
   * The watcher is stopped for the duration and restarted at END of file, not
   * with the usual backfill - the rebuild has just read those bytes, and
   * replaying the last 64 KB would double-count the most recent fight.
   */
  ipcMain.handle('history:rebuild', async () => {
    const settings = getSettings()
    session.stop()
    try {
      return await rebuildHistory(settings, {
        reset: () => {
          zones.reset()
          mobs.reset()
          loot.reset()
          leveling.reset()
        },
        events: (batch) => {
          leveling.observe(batch)
          loot.observe(batch)
          zones.observe(batch)
        },
        fight: (enc, selfNames) => mobs.observe(enc, selfNames)
      })
    } finally {
      leveling.flush()
      loot.flush()
      zones.flush()
      mobs.flush()
      send('watcher:status', session.start(settings, { fromEnd: true }))
      send('combat:state', session.state())
    }
  })

  ipcMain.handle('leveling:get', () => leveling.data())
  ipcMain.handle('leveling:reset', (_e, { character }: { character?: string }) => leveling.reset(character))

  ipcMain.handle('leaderboard:get', (_e, opts: { force?: boolean } = {}) =>
    getLeaderboard(getSettings().ptdexBase, opts?.force ?? false)
  )

  ipcMain.handle('tooltip:get', (_e, { kind, name }: { kind: 'spell' | 'item'; name: string }) =>
    lookupTip(getSettings().ptdexBase, kind, name)
  )

  // Only ever http(s), and only ever to the browser - a renderer-supplied
  // string must not be able to launch a local file or a custom protocol.
  ipcMain.handle('shell:open', (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  ipcMain.handle('alerts:list', () => alerts.list())
  ipcMain.handle('alerts:save', (_e, rules) => alerts.save(rules))
  ipcMain.handle('alerts:test', (_e, { rule, sample }) => alerts.test(rule, sample))

  ipcMain.handle('overlay:state', () => overlayState())
  ipcMain.handle('overlay:toggle', (_e, { preset, on }: { preset: OverlayPreset; on?: boolean }) => {
    const state = toggleOverlay(preset, on)
    send('overlay:changed', state)
    return state
  })
  ipcMain.handle('overlay:lock', (_e, next: boolean) => {
    const state = setOverlayLock(next)
    send('overlay:changed', state)
    return state
  })
  ipcMain.handle(
    'combat:lines',
    (_e, opts: { limit?: number; includeUnparsed?: boolean } = {}): ParsedEvent[] =>
      session.recentLines(opts.limit, opts.includeUnparsed)
  )
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.projecttriune.helper')
  registerIpc()
  mainWindow = createMainWindow()
  // Overlays are always-on-top and have no chrome of their own, so if the main
  // window went away and left them behind there would be no way to close them
  // short of Task Manager. Closing the app closes everything.
  mainWindow.on('closed', () => app.quit())
  enableDevCapture()
  session.start(getSettings())
  restoreOverlays()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
  })
})

// Closing the main window quits, even though overlays are still open - an
// always-on-top window with no way back to the app would be unclosable except
// through Task Manager.
app.on('before-quit', () => {
  session.stop()
  leveling.flush()
  loot.flush()
  zones.flush()
  mobs.flush()
  flushTooltips()
  closeOverlays()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
