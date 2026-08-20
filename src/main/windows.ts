import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, shell } from 'electron'

const isDev = !!process.env['ELECTRON_RENDERER_URL']

/** Dev serves the renderer from vite; production loads the built html. */
function loadRenderer(win: BrowserWindow, entry: 'index' | 'overlay'): void {
  if (isDev) {
    const base = process.env['ELECTRON_RENDERER_URL']!
    void win.loadURL(entry === 'index' ? base : `${base}/${entry}.html`)
  } else {
    void win.loadFile(join(__dirname, `../renderer/${entry}.html`))
  }
}

/**
 * The window icon.
 *
 * Set explicitly rather than relying on the executable's embedded icon,
 * because packaging skips the rcedit step that would embed one (see the note
 * in electron-builder.yml). This way the taskbar and Alt-Tab show the real
 * mark whether or not the exe carries it.
 */
function iconPath(): string | undefined {
  const candidates = [
    join(__dirname, '../../build/icon.png'), // dev, from out/main
    join(process.resourcesPath ?? '', 'build', 'icon.png'),
    join(__dirname, '../../../build/icon.png')
  ]
  return candidates.find((p) => existsSync(p))
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false,
    icon: iconPath(),
    // Paint the shell colour immediately so launching doesn't flash white.
    backgroundColor: '#0f1319',
    title: 'Nexus Reader',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      /**
       * Chromium throttles timers in a window that isn't visible - to once a
       * minute, and harder after a few minutes of that. For an ordinary app
       * that is a battery saving. For this one it breaks the feature that
       * matters most: a countdown exists precisely so it can go off while you
       * are looking at the game with this window minimised, and a throttled
       * tick makes it fire late or not at all.
       */
      backgroundThrottling: false
    }
  })

  win.on('ready-to-show', () => win.show())
  win.on('maximize', () => win.webContents.send('window:maximized', true))
  win.on('unmaximize', () => win.webContents.send('window:maximized', false))

  // Anything that isn't us opens in the user's browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  loadRenderer(win, 'index')
  return win
}
