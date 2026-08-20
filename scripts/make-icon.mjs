/**
 * Renders the app icon from the same mark the UI draws, using Electron itself.
 *
 * No image toolchain, no design asset to keep in sync: the icon IS the mark,
 * rendered offscreen at 1024px and written to build/icon.png.
 *
 * It also writes build/icon.ico, and that one is not a convenience. Embedding
 * an icon into the executable needs an .ico, and the electron-builder step
 * that would produce one first extracts a cache archive full of macOS
 * symlinks - which needs a Windows privilege a normal account does not have,
 * so it fails and the exe ships with Electron's generic atom. Writing the .ico
 * here sidesteps that entirely: the format is a header, a table and a run of
 * PNGs, and Windows has read PNG-in-ICO since Vista.
 *
 * TWO artworks are rendered, not one. Downscaling the full mark to 16px turns
 * the two outer bars into a smear either side of the centre one, so the small
 * entries come from a reduced drawing - ring plus spire, thicker stroke. That
 * is the same threshold the React component uses (Crest.tsx, REDUCE_BELOW).
 *
 *   node scripts/make-icon.mjs
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'build', 'icon.png')
mkdirSync(dirname(out), { recursive: true })

/**
 * The plate. A transparent icon disappears on a dark taskbar, and the mark's
 * own halo is far too faint to carry it.
 *
 * The ring is lighter here than in the app (#7d6fa0 against #5b5170). On screen
 * it sits on a panel and only has to suggest an edge; on a taskbar it is
 * competing with whatever wallpaper is behind the bar, and the app-side value
 * simply disappears there.
 */
const CHROME = `
  <defs>
    <radialGradient id="plate" cx="50%" cy="34%" r="76%">
      <stop offset="0" stop-color="#241d38"/><stop offset="1" stop-color="#0b0812"/>
    </radialGradient>
    <radialGradient id="halo">
      <stop offset=".34" stop-color="#a855f7" stop-opacity="0"/>
      <stop offset=".66" stop-color="#c9a2ff" stop-opacity=".34"/>
      <stop offset="1" stop-color="#c9a2ff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="1.5" y="1.5" width="45" height="45" rx="10.5" fill="url(#plate)"/>
  <circle cx="24" cy="24" r="21.5" fill="url(#halo)"/>`

/** The mark is inset so the ring never runs into the plate's rounded corner. */
const INSET = `translate(24,24) scale(0.84) translate(-24,-24)`

const FULL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="1024" height="1024">
  ${CHROME}
  <g transform="${INSET}" fill="none">
    <path d="M11.14 8.68A20 20 0 1 1 11.14 39.32" stroke="#7d6fa0" stroke-width="3.6" stroke-linecap="round"/>
    <rect x="14.5" y="25" width="4.6" height="9"  rx="1.6" fill="#a855f7" opacity="0.6"/>
    <path d="M21.7 34V19.5L24 14.5L26.3 19.5V34Z" fill="#c9a2ff"/>
    <rect x="28.9" y="22" width="4.6" height="12" rx="1.6" fill="#a855f7" opacity="0.85"/>
  </g>
</svg>`

const REDUCED = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="1024" height="1024">
  ${CHROME}
  <g transform="${INSET}" fill="none">
    <path d="M11.14 8.68A20 20 0 1 1 11.14 39.32" stroke="#8e7fb5" stroke-width="6.5" stroke-linecap="round"/>
    <path d="M20 35V19L24 12L28 19V35Z" fill="#c9a2ff"/>
  </g>
</svg>`

// overflow:hidden matters: without it the transparent window renders its
// scrollbars and they end up baked into the corner of the icon.
const page = (svg) => `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}
svg{display:block}</style>${svg}`

/**
 * Sizes baked into the .ico.
 *
 * Windows picks per context - 16 in the title bar and Explorer's detail view,
 * 32 on the desktop, 48 in the taskbar's jump list, 256 in the large-icon
 * view. Shipping only the big one leaves Windows to downscale, and a
 * hairline-heavy mark like this one turns to mush when it does.
 */
const SIZES = [32, 48, 64, 128, 256]
/** Below this the outer bars stop resolving - see the header. */
const SMALL_SIZES = [16, 24]

// A tiny Electron main script: load each artwork, capture it, print base64.
// The full mark is also the source for build/icon.png.
const MAIN = `
const { app, BrowserWindow } = require('electron')
app.disableHardwareAcceleration()

async function shoot(win, html) {
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  // One frame is not always enough for gradients to be composited.
  await new Promise((r) => setTimeout(r, 600))
  return win.webContents.capturePage()
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024, height: 1024, show: false, frame: false, transparent: true,
    webPreferences: { offscreen: false }
  })

  const full = await shoot(win, ${JSON.stringify(page(FULL))})
  process.stdout.write('ICON:' + full.toPNG().toString('base64') + '\\n')
  for (const size of ${JSON.stringify(SIZES)}) {
    const small = full.resize({ width: size, height: size, quality: 'best' })
    process.stdout.write('SIZE:' + size + ':' + small.toPNG().toString('base64') + '\\n')
  }

  const reduced = await shoot(win, ${JSON.stringify(page(REDUCED))})
  for (const size of ${JSON.stringify(SMALL_SIZES)}) {
    const small = reduced.resize({ width: size, height: size, quality: 'best' })
    process.stdout.write('SIZE:' + size + ':' + small.toPNG().toString('base64') + '\\n')
  }

  app.quit()
})
`

/**
 * Pack PNGs into an .ico.
 *
 * A six-byte header, then one sixteen-byte entry per image, then the images.
 * Width and height are single bytes, so 256 is written as 0 - the one piece of
 * the format that surprises people.
 */
function buildIco(images) {
  const HEADER = 6
  const ENTRY = 16
  const header = Buffer.alloc(HEADER)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // 1 = icon
  header.writeUInt16LE(images.length, 4)

  const entries = Buffer.alloc(ENTRY * images.length)
  let offset = HEADER + ENTRY * images.length

  images.forEach((img, i) => {
    const at = i * ENTRY
    entries.writeUInt8(img.size >= 256 ? 0 : img.size, at)
    entries.writeUInt8(img.size >= 256 ? 0 : img.size, at + 1)
    entries.writeUInt8(0, at + 2) // palette size, 0 for truecolour
    entries.writeUInt8(0, at + 3) // reserved
    entries.writeUInt16LE(1, at + 4) // colour planes
    entries.writeUInt16LE(32, at + 6) // bits per pixel
    entries.writeUInt32LE(img.data.length, at + 8)
    entries.writeUInt32LE(offset, at + 12)
    offset += img.data.length
  })

  return Buffer.concat([header, entries, ...images.map((i) => i.data)])
}

const tmp = join(root, 'build', '_icon-main.cjs')
writeFileSync(tmp, MAIN)

// Strip ELECTRON_RUN_AS_NODE for the same reason scripts/dev.mjs does.
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const child = spawn(electron, [tmp], { env })

let buffer = ''
child.stdout.on('data', (d) => {
  buffer += d.toString()
})
child.stderr.on('data', (d) => process.stderr.write(d))

child.on('exit', () => {
  const match = /ICON:([A-Za-z0-9+/=]+)/.exec(buffer)
  if (!match) {
    console.error('icon render produced no image')
    process.exit(1)
  }
  writeFileSync(out, Buffer.from(match[1], 'base64'))
  console.log(`wrote ${out}`)

  const images = []
  for (const line of buffer.split('\n')) {
    const m = /^SIZE:(\d+):([A-Za-z0-9+/=]+)$/.exec(line.trim())
    if (m) images.push({ size: Number(m[1]), data: Buffer.from(m[2], 'base64') })
  }

  const want = SIZES.length + SMALL_SIZES.length
  if (images.length !== want) {
    console.error(`expected ${want} resized images, got ${images.length}; .ico not written`)
    process.exit(1)
  }

  // Largest first is what most tools expect to find at the top of the table.
  images.sort((a, b) => b.size - a.size)
  const ico = join(root, 'build', 'icon.ico')
  writeFileSync(ico, buildIco(images))
  console.log(`wrote ${ico} (${images.map((i) => i.size).join(', ')})`)
})
