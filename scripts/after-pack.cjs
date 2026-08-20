/**
 * Stamp the packaged executable with our icon and version metadata.
 *
 * electron-builder does this itself under `signAndEditExecutable`, but that
 * flag also drags in the winCodeSign cache, whose archive contains macOS
 * symlinks. Extracting those needs the "Create symbolic links" privilege,
 * which a normal Windows account does not have - so the packaging run fails on
 * an ordinary machine, and turning the flag off left the exe carrying
 * Electron's generic atom. The window and taskbar looked right because the
 * BrowserWindow sets its own icon at runtime; File Explorer, the Start Menu
 * shortcut and a pinned taskbar button all read the EXE, and those looked
 * wrong.
 *
 * Pre-extracting the cache does not help - electron-builder extracts to a
 * freshly named directory on every run.
 *
 * So the resource edit is done here instead, with a vendored rcedit and an
 * .ico written by scripts/make-icon.mjs. No privilege, no download, no
 * signing - and it runs before the installer is built, so NSIS packs the
 * stamped exe.
 *
 * This does NOT sign anything. There is no certificate, so SmartScreen still
 * warns on first run until the installer builds reputation.
 */
const { execFileSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { join } = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return

  const root = join(__dirname, '..')
  const rcedit = join(root, 'build', 'rcedit-x64.exe')
  const icon = join(root, 'build', 'icon.ico')
  const exe = join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`)

  for (const [what, path] of [
    ['rcedit', rcedit],
    ['icon.ico', icon],
    ['the packaged exe', exe]
  ]) {
    if (!existsSync(path)) {
      // Loud, not fatal: a build that silently ships the wrong icon is the
      // thing this file exists to stop happening again.
      console.warn(`\n  ! afterPack: ${what} not found at ${path} — exe left unstamped\n`)
      return
    }
  }

  const version = context.packager.appInfo.version

  execFileSync(
    rcedit,
    [
      exe,
      '--set-icon', icon,
      '--set-file-version', version,
      '--set-product-version', version,
      '--set-version-string', 'ProductName', 'Nexus Reader',
      '--set-version-string', 'FileDescription', 'Nexus Reader',
      '--set-version-string', 'CompanyName', 'Aoezpz',
      '--set-version-string', 'LegalCopyright', 'Aoezpz',
      '--set-version-string', 'OriginalFilename', 'Nexus Reader.exe',
      '--set-version-string', 'InternalName', 'Nexus Reader'
    ],
    { stdio: 'inherit' }
  )

  console.log(`  • stamped ${exe} with build/icon.ico`)
}
