/**
 * `npm run dev`, but safe to run from a VS Code / Cursor integrated terminal.
 *
 * Those terminals inherit ELECTRON_RUN_AS_NODE=1 from the editor's own
 * extension host. Electron honours it, boots as plain Node, and `require
 * ('electron')` hands back the binary's path string instead of the module - so
 * the app dies on `app.whenReady()` with a confusing "Cannot read properties of
 * undefined". Stripping the variable before spawning is the whole fix.
 */
import { spawn } from 'node:child_process'

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const args = process.argv.slice(2)
const child = spawn('electron-vite', args.length ? args : ['dev'], {
  env,
  stdio: 'inherit',
  shell: true
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
