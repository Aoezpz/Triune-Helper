import { copyFileSync, constants, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * Carry a Triune-Helper install's data forward into Nexus Reader.
 *
 * `app.getPath('userData')` is derived from the app's name, so renaming the app
 * moves it. Every store lives there - settings, alert rules, flag progress, and
 * the zone, mob, loot and levelling ledgers, which are lifetime totals that
 * cannot be rebuilt beyond whatever the log files still hold. Without this, a
 * 0.1.x user opens 0.2.0 to a first-run app and a month of data sitting on disk
 * a folder away, invisible, with nothing on screen to suggest it is still
 * there. That is exactly the kind of quiet loss this app exists to be better
 * than.
 *
 * This module must be imported BEFORE any module that constructs a Store -
 * they all build theirs at module load, and by then the path is already
 * resolved. See the import order in index.ts, where it sits above ./alerts.
 *
 * The old folder is never deleted. It costs a few hundred kilobytes and it is
 * the user's own rollback if anything here went wrong.
 */

/**
 * Both spellings, because dev ran under package.json's `name` and the packaged
 * build under electron-builder's `productName`. Windows resolves them to the
 * same directory; another platform would not, and checking both costs nothing.
 */
const LEGACY_NAMES = ['triune-helper', 'Triune-Helper']

/** Written once the carry-forward has finished, so a failed run can retry. */
const SENTINEL = '.migrated-from-triune-helper'

/**
 * Ours, and only ours. The old folder also holds Chromium's own state - `Local
 * State`, `Preferences`, the caches - which is per-install scaffolding that
 * regenerates, and copying a stale cache into a renamed app is a way to import
 * a bug rather than a setting.
 */
function isOurs(name: string): boolean {
  return (name.startsWith('triune-') && name.endsWith('.json')) || name === '.updaterId'
}

function legacyDir(): string | null {
  const parent = app.getPath('appData')
  for (const name of LEGACY_NAMES) {
    const dir = join(parent, name)
    if (existsSync(dir)) return dir
  }
  return null
}

export function migrateUserData(): void {
  const dest = app.getPath('userData')
  const marker = join(dest, SENTINEL)
  if (existsSync(marker)) return

  const from = legacyDir()

  // Nothing to carry - a clean install. Still stamp it, so this never runs
  // again and a Triune-Helper installed LATER (someone reinstalling the old
  // build alongside) can never reach in and overwrite settings made here.
  if (!from || from === dest) {
    try {
      mkdirSync(dest, { recursive: true })
      writeFileSync(marker, 'no legacy install found\n')
    } catch {
      // A userData we cannot write to is a much larger problem than this, and
      // it will surface on the first setting change with a real error.
    }
    return
  }

  let copied = 0
  let failed = 0
  try {
    mkdirSync(dest, { recursive: true })
    for (const name of readdirSync(from)) {
      if (!isOurs(name)) continue
      try {
        // COPYFILE_EXCL: never overwrite. If a previous run half-finished, this
        // fills the gaps and leaves anything already written here alone.
        copyFileSync(join(from, name), join(dest, name), constants.COPYFILE_EXCL)
        copied++
      } catch (err) {
        // EEXIST is the expected, harmless case on a retry.
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') failed++
      }
    }
  } catch (err) {
    console.error('[migrate] could not read the previous install:', err)
    return
  }

  // Only stamp it done if nothing failed. A partial carry-forward should try
  // again next launch rather than declare itself finished.
  if (failed > 0) {
    console.error(`[migrate] ${failed} file(s) failed to copy; will retry on next launch`)
    return
  }

  try {
    writeFileSync(marker, `carried forward from ${from}\n`)
  } catch {
    // Worst case it runs again next launch and copies nothing, because
    // COPYFILE_EXCL refuses every file. Harmless.
  }

  if (copied > 0) console.log(`[migrate] carried ${copied} file(s) forward from ${from}`)
}

migrateUserData()
