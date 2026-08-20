import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import Store from 'electron-store'
import { DEFAULT_SETTINGS, type Settings } from '@shared/ipc'

const store = new Store<{ settings: Settings }>({
  name: 'triune-helper',
  defaults: { settings: DEFAULT_SETTINGS },
  // A config file that fails to parse - truncated by a crash, or saved by an
  // editor that added a BOM - must not be fatal. Without this, electron-store
  // throws during module load and the app dies before it can draw a window,
  // with no way for the user to recover short of deleting the file by hand.
  clearInvalidConfig: true
})

export function getSettings(): Settings {
  // Merge over defaults so a settings file written by an older build still
  // yields every key the current code expects.
  return { ...DEFAULT_SETTINGS, ...store.get('settings') }
}

export function setSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch }
  store.set('settings', next)
  return next
}

/**
 * Common EverQuest install locations. We only ever read from the Logs
 * subfolder - the app never writes into the game directory.
 *
 * Emulator launchers each pick their own root, so this list is a guess-list
 * rather than a spec, and being wrong is free: a candidate only wins if its
 * Logs folder actually holds a file matching the configured server shortname.
 * Adding a server's usual folder here costs one `existsSync` on a path that
 * isn't there.
 */
const CANDIDATE_ROOTS = [
  'C:\\ProjectTriune',
  'C:\\Triune',
  'C:\\THJ',
  'C:\\EverQuest',
  'C:\\EQ',
  'C:\\Games\\EverQuest',
  'C:\\Program Files (x86)\\Sony\\EverQuest',
  'C:\\Program Files\\Sony\\EverQuest',
  'D:\\EverQuest',
  'D:\\Games\\EverQuest'
]

/**
 * Look for a Logs folder that actually contains logs for our server. Returns
 * null rather than guessing, so a wrong folder never silently becomes the
 * configured one.
 */
export function autodetectLogFolder(serverShortname: string): string | null {
  const suffix = `_${serverShortname.toLowerCase()}.txt`
  for (const root of CANDIDATE_ROOTS) {
    const logs = join(root, 'Logs')
    if (!existsSync(logs)) continue
    try {
      const hit = readdirSync(logs).some(
        (f) => f.toLowerCase().startsWith('eqlog_') && f.toLowerCase().endsWith(suffix)
      )
      if (hit) return logs
    } catch {
      // Unreadable candidate (permissions, disconnected drive) - just move on.
    }
  }
  return null
}
