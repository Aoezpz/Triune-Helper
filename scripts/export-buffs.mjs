/**
 * Build the buff message index from the client's own spell file.
 *
 * EverQuest never writes "you have Warsong of Zek on you". What it writes is
 * the effect: "You hear the war horns of Zek echo in your mind." - and when it
 * ends, "The warsong of Zek fades." Those two strings live in spells_us.txt,
 * which every client ships, so a reverse index of them turns effect text back
 * into a spell name.
 *
 * The whole difficulty is ambiguity. "Your protection fades." belongs to 26
 * different spells and " staggers." to hundreds, and a message that could mean
 * any of twenty things identifies none of them. So ONLY messages that map to
 * exactly one spell name survive. That throws away a lot, and what is left is
 * trustworthy - which is the right way round.
 *
 *   node scripts/export-buffs.mjs "<path to spells_us.txt>"
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const file = process.argv[2]
if (!file) {
  console.error('usage: node scripts/export-buffs.mjs "<path to spells_us.txt>"')
  process.exit(1)
}

/**
 * Column positions in spells_us.txt, verified against a known row rather than
 * assumed: `3374^Warsong of Zek^PLAYER_1^^^^You hear the war horns…^^The
 * warsong of Zek fades.^…`
 */
const COL = { id: 0, name: 1, castOnYou: 6, castOnOther: 7, fades: 8, buffduration: 17 }

/**
 * A message this short is a fragment, not a fingerprint - " staggers." and the
 * like, which belong to hundreds of spells and identify none.
 */
const MIN_LENGTH = 12

const lines = readFileSync(file, 'utf8').split('\n')

/** message -> set of spell names that print it */
const castByMessage = new Map()
const fadeByMessage = new Map()
let rows = 0

const add = (map, msg, name) => {
  const key = msg.trim()
  if (key.length < MIN_LENGTH) return
  if (!map.has(key)) map.set(key, new Set())
  map.get(key).add(name)
}

for (const raw of lines) {
  if (!raw.includes('^')) continue
  const f = raw.split('^')
  const name = (f[COL.name] ?? '').trim()
  if (!name) continue
  rows += 1
  add(castByMessage, f[COL.castOnYou] ?? '', name)
  add(fadeByMessage, f[COL.fades] ?? '', name)
}

/** Keep only messages that name exactly one spell. */
const unique = (map) => {
  const out = new Map()
  let dropped = 0
  for (const [msg, names] of map) {
    if (names.size === 1) out.set(msg, [...names][0])
    else dropped += 1
  }
  return { out, dropped }
}

const casts = unique(castByMessage)
const fades = unique(fadeByMessage)

console.log(`${rows} spell rows`)
console.log(`  cast-on-you : ${casts.out.size} unique, ${casts.dropped} ambiguous and dropped`)
console.log(`  fades       : ${fades.out.size} unique, ${fades.dropped} ambiguous and dropped`)

/**
 * A buff is only useful if BOTH ends are identifiable - a start with no end
 * would sit on the board forever, and an end with no start has nothing to
 * close. So the index keeps spells where each half resolves uniquely.
 */
const byName = new Map()
for (const [msg, name] of casts.out) {
  if (!byName.has(name)) byName.set(name, { name, on: msg, off: null })
  else byName.get(name).on = msg
}
for (const [msg, name] of fades.out) {
  if (!byName.has(name)) byName.set(name, { name, on: null, off: msg })
  else byName.get(name).off = msg
}

const both = [...byName.values()].filter((b) => b.on && b.off).sort((a, b) => a.name.localeCompare(b.name))
const onlyOn = [...byName.values()].filter((b) => b.on && !b.off).length

console.log(`  usable      : ${both.length} spells with both a start and an end`)
console.log(`  (${onlyOn} more have a recognisable start but an ambiguous end - dropped)`)

mkdirSync(join(root, 'data'), { recursive: true })
const out = join(root, 'data', 'buffs.json')
writeFileSync(
  out,
  JSON.stringify(
    {
      note: 'Built by scripts/export-buffs.mjs from the client spells_us.txt. Only messages that identify exactly one spell are kept; ambiguous ones are dropped rather than guessed.',
      buffs: both
    },
    null,
    2
  )
)
console.log(`\nwrote ${out}`)
