/**
 * What the parser does not understand yet.
 *
 * Runs the real pattern table over a real log and reports the line shapes that
 * came back `unparsed`, most common first, with digits and quoted text
 * collapsed so a thousand variations of one message group into one row.
 *
 * This is the tool that turns a VERIFY comment into a rule: every shape it
 * prints is either a message worth parsing or a message worth ignoring, and
 * either way the decision is made against a line the server actually wrote.
 *
 *   node scripts/unparsed.mjs "<path to eqlog>" [--limit 40] [--kind spell]
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { register } from 'node:module'

const [, , file, ...rest] = process.argv
if (!file) {
  console.error('usage: node scripts/unparsed.mjs <eqlog path> [--limit N] [--kind K]')
  process.exit(1)
}

const arg = (name, fallback) => {
  const i = rest.indexOf(`--${name}`)
  return i >= 0 ? rest[i + 1] : fallback
}
const limit = Number(arg('limit', 40))
const wantKind = arg('kind', 'unparsed')

// The parser is TypeScript; run it through the same transpiler vitest uses.
const { createRequire } = await import('node:module')
const require = createRequire(import.meta.url)
const ts = require('typescript')

register(
  'data:text/javascript,' +
    encodeURIComponent(`
    // TypeScript source omits the extension on relative imports; Node's ESM
    // resolver requires one. Without this the whole script died on
    // patterns.ts importing coinToCopper from '../loot'.
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

const { tokenize } = await import('../src/shared/parser/tokenize.ts')
const { parseLine } = await import('../src/shared/parser/patterns.ts')

const self = /^eqlog_(.+?)_/.exec(basename(file))?.[1] ?? 'You'
const ctx = { self, petOwners: new Map(), players: new Set([self]) }

const shapes = new Map()
let total = 0
let matched = 0

for (const raw of readFileSync(file, 'utf8').split('\n')) {
  const line = tokenize(raw.replace(/\r$/, ''), self, 0)
  if (!line) continue
  total++
  const ev = parseLine(line, ctx)
  if (ev.kind !== wantKind) {
    if (ev.kind !== 'unparsed') matched++
    continue
  }
  // Collapse the variable parts so one message is one row.
  const shape = line.body
    .replace(/\d[\d,]*/g, 'N')
    .replace(/'[^']*'/g, "'…'")
    .trim()
  const seen = shapes.get(shape) ?? { count: 0, sample: line.body }
  seen.count++
  shapes.set(shape, seen)
}

const rows = [...shapes.entries()].sort((a, b) => b[1].count - a[1].count)
const unparsed = rows.reduce((s, [, v]) => s + v.count, 0)

console.log(`${basename(file)} — ${total} timestamped lines, ${matched} parsed, ${unparsed} ${wantKind}`)
console.log(`${rows.length} distinct shapes; showing ${Math.min(limit, rows.length)}\n`)
for (const [shape, v] of rows.slice(0, limit)) {
  console.log(String(v.count).padStart(6), shape)
}
