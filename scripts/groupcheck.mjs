/**
 * Replays a real log through the same standing-facts scan the watcher runs on
 * attach, and prints the group roster it ends up with.
 *
 *   node scripts/groupcheck.mjs "<path to eqlog>"
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { register, createRequire } from 'node:module'

const require = createRequire(import.meta.url)
require('typescript')

register(
  'data:text/javascript,' +
    encodeURIComponent(`
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
const { applyGroupEvent } = await import('../src/shared/roster.ts')

const file = process.argv[2]
const self = /^eqlog_(.+?)_/.exec(basename(file))?.[1] ?? 'You'
const ctx = { self, petOwners: new Map(), players: new Set([self]) }

const text = readFileSync(file, 'utf8')
const isStandingFact = (l) =>
  l.includes('group') || l.includes('party') || l.includes('My leader is')

const interesting = text.split('\n').filter(isStandingFact)
console.log(`${interesting.length} candidate lines out of ${text.split('\n').length}`)

const { lines } = tokenizeChunk(interesting.join('\n'), self, 0)
console.log(`${lines.length} tokenized\n`)

const members = new Set()
for (const line of lines) {
  const ev = parseLine(line, ctx)
  if (ev.group === undefined) continue
  const before = [...members].join(',')
  applyGroupEvent(members, ev, self)
  console.log(
    `${ev.group.padEnd(8)} ${(ev.target?.name ?? '-').padEnd(14)} [${before}] -> [${[...members].join(',')}]`
  )
}

console.log(`\nfinal group for ${self}: [${[...members].join(', ')}]`)
console.log(`players learned: [${[...ctx.players].join(', ')}]`)
