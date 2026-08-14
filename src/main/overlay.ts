import { join } from 'node:path'
import { BrowserWindow, screen } from 'electron'
import Store from 'electron-store'
import type { OverlayBounds, OverlayPreset, OverlayState } from '@shared/ipc'

/**
 * Always-on-top overlays.
 *
 * Two presets, each its own window so they can be placed independently: the
 * meter goes wherever your eye already is, the stream usually goes somewhere
 * it won't cover the game.
 *
 * Locking is the important part. A locked overlay calls
 * setIgnoreMouseEvents(true, { forward: true }) - clicks pass straight through
 * to the game, but the window still receives move events, so hover styling
 * keeps working and the unlock affordance stays discoverable. Unlocked, it
 * behaves like a normal window you can drag and resize.
 *
 * This needs the game in borderless windowed mode. Exclusive fullscreen owns
 * the display outright and nothing can draw above it - that is a DirectX fact,
 * not something the app can work around, and Preferences says so plainly.
 */

const isDev = !!process.env['ELECTRON_RENDERER_URL']

const DEFAULTS: Record<OverlayPreset, OverlayBounds> = {
  meter: { x: 40, y: 40, width: 320, height: 220 },
  stream: { x: 40, y: 300, width: 380, height: 260 }
}

interface Persisted {
  bounds: Partial<Record<OverlayPreset, OverlayBounds>>
  open: Partial<Record<OverlayPreset, boolean>>
}

const store = new Store<Persisted>({
  name: 'triune-overlay',
  defaults: { bounds: {}, open: {} },
  clearInvalidConfig: true
})

const windows = new Map<OverlayPreset, BrowserWindow>()

/**
 * Always start unlocked.
 *
 * A locked overlay passes every click through, so if the lock state survived a
 * restart there would be no way to unlock it except by knowing the menu in the
 * main window exists. Persisting a state that can make a window appear
 * permanently unresponsive is the wrong default; you can lock it again in one
 * click.
 */
/**
 * Overlays start LOCKED, which is to say click-through.
 *
 * They are drawn over a game somebody is playing, and an unlocked overlay is a
 * window that takes Windows focus the moment a stray click lands on it -
 * whereupon EverQuest stops receiving the keyboard, never sees the key-up for
 * whatever was held, and the character keeps running. Opening an overlay
 * should not be able to do that to you, so the safe state is the default and
 * unlocking is the deliberate act.
 */
let locked = true

/**
 * Keep a window on a display that actually exists. Unplugging the monitor an
 * overlay lived on would otherwise strand it off-screen with no way back.
 */
function clampToDisplay(bounds: OverlayBounds): OverlayBounds {
  const area = screen.getDisplayMatching(bounds).workArea
  const width = Math.min(bounds.width, area.width)
  const height = Math.min(bounds.height, area.height)
  return {
    width,
    height,
    x: Math.min(Math.max(bounds.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(bounds.y, area.y), area.y + area.height - height)
  }
}

function boundsFor(preset: OverlayPreset): OverlayBounds {
  return clampToDisplay({ ...DEFAULTS[preset], ...(store.get('bounds')[preset] ?? {}) })
}

function create(preset: OverlayPreset): BrowserWindow {
  const win = new BrowserWindow({
    ...boundsFor(preset),
    frame: false,
    transparent: true,
    resizable: true,
    minWidth: 220,
    minHeight: 120,
    skipTaskbar: true,
    // 'screen-saver' is the level that stays above a borderless-windowed game;
    // plain `true` loses to some fullscreen-window compositors.
    alwaysOnTop: true,
    /**
     * Focusable, and it has to be.
     *
     * `focusable: false` looks like the right answer for a window drawn over a
     * game - it sets WS_EX_NOACTIVATE, so clicking would never take focus from
     * EverQuest and never strand your character mid-run with a key-up the
     * client never received. It was tried. On Windows it also stops the window
     * receiving mouse events at all: the lock and close buttons went dead and
     * the overlay could not be moved.
     *
     * So the focus problem is solved by LOCKING instead, which is what the
     * lock was always for. A locked overlay is click-through, so nothing you
     * do to the game can land on it and nothing it does can take focus. It
     * ships locked; unlock it only to reposition it, which is a thing you do
     * between fights rather than during one.
     */
    focusable: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // An overlay sits over a fullscreen game, which Chromium can treat as
      // occlusion and throttle it for. A meter that stops updating the moment
      // it is doing its job is worse than no meter.
      backgroundThrottling: false
    }
  })

  /**
   * Getting an overlay to actually stay on top takes more than the constructor
   * flag. `alwaysOnTop: true` in the options resolves to the 'floating' level,
   * which loses to a maximised window - the overlay ends up BEHIND the app
   * that opened it, which is exactly how it failed the first time it was used
   * for real. Re-asserting at 'screen-saver' after creation, and again once the
   * page has painted, is what makes it stick.
   */
  const raise = (): void => {
    if (win.isDestroyed()) return
    win.setAlwaysOnTop(true, 'screen-saver')
    win.moveTop()
  }
  raise()
  win.once('ready-to-show', raise)
  win.webContents.once('did-finish-load', raise)

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setIgnoreMouseEvents(locked, { forward: true })

  const save = (): void => {
    if (win.isDestroyed()) return
    const b = win.getBounds()
    store.set('bounds', { ...store.get('bounds'), [preset]: b })
  }
  win.on('moved', save)
  win.on('resized', save)

  win.on('closed', () => {
    windows.delete(preset)
    store.set('open', { ...store.get('open'), [preset]: false })
  })

  const query = `?preset=${preset}`
  if (isDev) void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/overlay.html${query}`)
  else void win.loadFile(join(__dirname, '../renderer/overlay.html'), { search: query })

  windows.set(preset, win)
  store.set('open', { ...store.get('open'), [preset]: true })
  return win
}

export function toggleOverlay(preset: OverlayPreset, on?: boolean): OverlayState {
  const existing = windows.get(preset)
  const want = on ?? !existing
  if (want && !existing) create(preset)
  if (!want && existing) existing.close()
  return overlayState()
}

export function setOverlayLock(next: boolean): OverlayState {
  locked = next
  for (const win of windows.values()) win.setIgnoreMouseEvents(locked, { forward: true })
  return overlayState()
}

export function overlayState(): OverlayState {
  return {
    locked,
    open: {
      meter: windows.has('meter'),
      stream: windows.has('stream')
    }
  }
}

/** Reopen whatever was open last session. */
export function restoreOverlays(): void {
  const open = store.get('open')
  for (const preset of ['meter', 'stream'] as OverlayPreset[]) {
    if (open[preset]) create(preset)
  }
}

/** Every overlay window, so pushes reach them alongside the main window. */
export function overlayWindows(): BrowserWindow[] {
  return [...windows.values()]
}

export function closeOverlays(): void {
  for (const win of [...windows.values()]) win.destroy()
  windows.clear()
}
