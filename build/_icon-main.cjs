
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

  const full = await shoot(win, "<!doctype html><meta charset=\"utf-8\">\n<style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}\nsvg{display:block}</style><svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 48 48\" width=\"1024\" height=\"1024\">\n  \n  <defs>\n    <radialGradient id=\"plate\" cx=\"50%\" cy=\"34%\" r=\"76%\">\n      <stop offset=\"0\" stop-color=\"#241d38\"/><stop offset=\"1\" stop-color=\"#0b0812\"/>\n    </radialGradient>\n    <radialGradient id=\"halo\">\n      <stop offset=\".34\" stop-color=\"#a855f7\" stop-opacity=\"0\"/>\n      <stop offset=\".66\" stop-color=\"#c9a2ff\" stop-opacity=\".34\"/>\n      <stop offset=\"1\" stop-color=\"#c9a2ff\" stop-opacity=\"0\"/>\n    </radialGradient>\n  </defs>\n  <rect x=\"1.5\" y=\"1.5\" width=\"45\" height=\"45\" rx=\"10.5\" fill=\"url(#plate)\"/>\n  <circle cx=\"24\" cy=\"24\" r=\"21.5\" fill=\"url(#halo)\"/>\n  <g transform=\"translate(24,24) scale(0.84) translate(-24,-24)\" fill=\"none\">\n    <path d=\"M11.14 8.68A20 20 0 1 1 11.14 39.32\" stroke=\"#7d6fa0\" stroke-width=\"3.6\" stroke-linecap=\"round\"/>\n    <rect x=\"14.5\" y=\"25\" width=\"4.6\" height=\"9\"  rx=\"1.6\" fill=\"#a855f7\" opacity=\"0.6\"/>\n    <path d=\"M21.7 34V19.5L24 14.5L26.3 19.5V34Z\" fill=\"#c9a2ff\"/>\n    <rect x=\"28.9\" y=\"22\" width=\"4.6\" height=\"12\" rx=\"1.6\" fill=\"#a855f7\" opacity=\"0.85\"/>\n  </g>\n</svg>")
  process.stdout.write('ICON:' + full.toPNG().toString('base64') + '\n')
  for (const size of [32,48,64,128,256]) {
    const small = full.resize({ width: size, height: size, quality: 'best' })
    process.stdout.write('SIZE:' + size + ':' + small.toPNG().toString('base64') + '\n')
  }

  const reduced = await shoot(win, "<!doctype html><meta charset=\"utf-8\">\n<style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}\nsvg{display:block}</style><svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 48 48\" width=\"1024\" height=\"1024\">\n  \n  <defs>\n    <radialGradient id=\"plate\" cx=\"50%\" cy=\"34%\" r=\"76%\">\n      <stop offset=\"0\" stop-color=\"#241d38\"/><stop offset=\"1\" stop-color=\"#0b0812\"/>\n    </radialGradient>\n    <radialGradient id=\"halo\">\n      <stop offset=\".34\" stop-color=\"#a855f7\" stop-opacity=\"0\"/>\n      <stop offset=\".66\" stop-color=\"#c9a2ff\" stop-opacity=\".34\"/>\n      <stop offset=\"1\" stop-color=\"#c9a2ff\" stop-opacity=\"0\"/>\n    </radialGradient>\n  </defs>\n  <rect x=\"1.5\" y=\"1.5\" width=\"45\" height=\"45\" rx=\"10.5\" fill=\"url(#plate)\"/>\n  <circle cx=\"24\" cy=\"24\" r=\"21.5\" fill=\"url(#halo)\"/>\n  <g transform=\"translate(24,24) scale(0.84) translate(-24,-24)\" fill=\"none\">\n    <path d=\"M11.14 8.68A20 20 0 1 1 11.14 39.32\" stroke=\"#8e7fb5\" stroke-width=\"6.5\" stroke-linecap=\"round\"/>\n    <path d=\"M20 35V19L24 12L28 19V35Z\" fill=\"#c9a2ff\"/>\n  </g>\n</svg>")
  for (const size of [16,24]) {
    const small = reduced.resize({ width: size, height: size, quality: 'best' })
    process.stdout.write('SIZE:' + size + ':' + small.toPNG().toString('base64') + '\n')
  }

  app.quit()
})
