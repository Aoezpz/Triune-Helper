/**
 * Wrap the installer and its instructions into one file to hand somebody.
 *
 * A tester needs two things and should get them together: the installer, and
 * the page that tells them Windows is about to call it dangerous. Sent on its
 * own, the .exe arrives with a SmartScreen warning and no context, which is a
 * bad first impression of an app whose entire promise is that it only reads.
 *
 *   npm run bundle
 *
 * Produces release/Triune-Helper-<version>-test.zip. Run `npm run package`
 * first - this only collects what is already built.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const installer = join(root, 'release', version, `Triune-Helper-Setup-${version}.exe`)
if (!existsSync(installer)) {
  console.error(`No installer at ${installer}\nRun \`npm run package\` first.`)
  process.exit(1)
}

/**
 * A failed NSIS run leaves a stub behind rather than nothing, and it is the
 * same filename - so "the file exists" is not evidence the build worked. This
 * has already happened once.
 */
const megabytes = statSync(installer).size / 1024 / 1024
if (megabytes < 40) {
  console.error(
    `Installer is only ${megabytes.toFixed(1)} MB, which means the last package run failed part way.\n` +
      'Re-run `npm run package` and check it finishes.'
  )
  process.exit(1)
}

/**
 * The updater's index. Without it attached to the release, electron-updater
 * asks GitHub for latest.yml, gets a 404, and every running copy of the app
 * concludes it is up to date - silently, forever. This has already happened
 * once: v0.1.0 went out with the installer alone.
 */
const manifest = join(root, 'release', version, 'latest.yml')
if (!existsSync(manifest)) {
  console.error(
    `No latest.yml at ${manifest}\n` +
      'The in-app updater cannot see a release without it. Check that\n' +
      'electron-builder.yml still has its `publish:` block and re-run `npm run package`.'
  )
  process.exit(1)
}

const stage = join(root, 'release', `Triune-Helper-${version}-test`)
rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })

copyFileSync(installer, join(stage, `Triune-Helper-Setup-${version}.exe`))
// Named README so it is the obvious thing to open, and .txt so it opens in
// Notepad for somebody who has no markdown viewer and just double-clicks.
copyFileSync(join(root, 'docs', 'TESTING.md'), join(stage, 'README.txt'))

const zip = `${stage}.zip`
rmSync(zip, { force: true })

// Compress-Archive rather than a zip dependency: it is already on every
// Windows machine, and this app does not ship anywhere else.
execFileSync(
  'powershell',
  [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zip}' -CompressionLevel Optimal`
  ],
  { stdio: 'inherit' }
)

console.log(`\n  ${zip}`)
console.log(`  ${(statSync(zip).size / 1024 / 1024).toFixed(1)} MB — installer + README.txt`)
console.log('\nSend that one file. The README tells them about the SmartScreen warning.')
console.log('\nCutting the GitHub release, attach all three:')
console.log(`  release/${version}/Triune-Helper-Setup-${version}.exe`)
console.log(`  release/${version}/latest.yml       <- without this the updater is blind`)
console.log(`  release/${version}/Triune-Helper-Setup-${version}.exe.blockmap`)
console.log(
  '\nThe blockmap is what lets an existing install download only the changed\n' +
    'bytes instead of the whole 80 MB. Miss it and updates still work, just fat.'
)
