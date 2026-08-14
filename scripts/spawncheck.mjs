/**
 * What the Timers page would say about a real log.
 *
 * Replays a log, collects every kill with its timestamp, and runs the same
 * spawnRows() the app runs. The point is to see whether the "looks like it is
 * on a timer" heuristic actually separates named from trash on this server's
 * data, rather than trusting that an eight-minute threshold sounds right.
 *
 *   node scripts/spawncheck.mjs "<path to eqlog>" [more logs...]
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { register, createRequire } from 'node:module'

const require = createRequire(import.meta.url)
require('typescript')

register(
  'data:text/javascript,' +
    encodeURIComponent(`
    // TypeScript source omits the extension on relative imports; Node's ESM
    // resolver requires one. Try the .ts sibling before giving up.
    export async function resolve(spec, ctx, next) {
      if (spec.startsWith('.') && !/\\.[a-z]+$/.test(spec)) {
        try { return await next(spec + '.ts', ctx) } catch {}
      }
      return next(spec, ctx)
    }
    export async function load(url, ctx, next) {
      if (!url.endsWith('.ts')) return next(url, ctx)
      const { readFileSync } = await import('node:fs')
      const { fileURLToPath } = await import('node:url')
      const { createRequire } = await import('node:module')
      const ts = createRequire(url)('typescript')
      const src = readFileSync(fileURLToPath(url), 'utf8')
      const out = ts.transpileModule(src, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
      }).outputText
      return { format: 'module', shortCircuit: true, source: out }
    }`)
)

const { tokenizeChunk } = await import('../src/shared/parser/tokenize.ts')
const { parseLine } = await import('../src/shared/parser/patterns.ts')
const { blankMob, MAX_KILL_TIMES } = await import('../src/shared/mobs.ts')
const { spawnRows, duration, MIN_SPAWN_MS } = await import('../src/shared/timers.ts')

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('usage: node scripts/spawncheck.mjs "<path to eqlog>" [...]')
  process.exit(1)
}

const totals = {}
let kills = 0

for (const file of files) {
  const self = /^eqlog_(.+?)_/.exec(basename(file))?.[1] ?? 'You'
  const ctx = { self, petOwners: new Map(), players: new Set([self]) }
  const { lines } = tokenizeChunk(readFileSync(file, 'utf8'), 0)

  for (const line of lines) {
    const event = parseLine(line, ctx)
    if (event?.kind !== 'death' || event.target?.kind !== 'mob') continue
    const name = event.target.name
    const t = (totals[name] ??= blankMob(name, line.ts))
    t.kills += 1
    t.lastSeen = line.ts
    t.killTimes = [...t.killTimes, line.ts].slice(-MAX_KILL_TIMES)
    kills += 1
  }
}

const rows = spawnRows(totals, [])
const distinct = Object.keys(totals).length

console.log(`${kills} kills, ${distinct} distinct mobs, across ${files.length} log(s)`)
console.log(`${rows.length} of them look like they are on a timer (gap >= ${duration(MIN_SPAWN_MS)})\n`)

const pad = (s, n) => String(s).padEnd(n)
console.log(`${pad('mob', 34)}${pad('kills', 7)}${pad('gaps', 6)}${pad('soonest', 10)}${pad('typical', 10)}longest`)
for (const r of rows.slice(0, 30)) {
  console.log(
    pad(r.mob, 34) +
      pad(r.kills, 7) +
      pad(r.samples, 6) +
      pad(r.shortestMs === null ? '-' : duration(r.shortestMs), 10) +
      pad(r.medianMs === null ? '-' : duration(r.medianMs), 10) +
      (r.longestMs === null ? '-' : duration(r.longestMs))
  )
}

// The other half of the check: what got filtered out, and whether that was
// right. Anything here was killed twice or more but always came back too fast
// to be on a timer - which should be trash, and nothing else.
const excluded = Object.values(totals)
  .filter((t) => t.kills >= 2 && !rows.some((r) => r.mob === t.mob))
  .sort((a, b) => b.kills - a.kills)
console.log(`\nfiltered out as trash (${excluded.length}):`)
for (const t of excluded.slice(0, 15)) console.log(`  ${pad(t.mob, 34)}${t.kills} kills`)
