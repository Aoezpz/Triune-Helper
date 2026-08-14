/**
 * Writes synthetic EverQuest logs in real time, so the app can be driven
 * without the game running.
 *
 * It emits a full trio: three characters each writing their own log, with
 * every third-party line duplicated across all three exactly the way the real
 * client duplicates it. That duplication is the point - it is what the merge
 * rule exists to handle, and a replay that skipped it would prove nothing.
 *
 *   node scripts/replay.mjs --out "C:\\temp\\Logs"        # real-time fight loop
 *   node scripts/replay.mjs --out "..." --speed 4         # 4x faster
 *   node scripts/replay.mjs --out "..." --fights 2        # stop after 2 kills
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1])
}

const OUT = args.get('out') ?? join(process.cwd(), '.replay-logs')
const SERVER = args.get('server') ?? 'multiclass'
const SPEED = Number(args.get('speed') ?? 1)
const MAX_FIGHTS = Number(args.get('fights') ?? Infinity)

const TRIO = [
  { name: 'Braxus', verb: 'slash', min: 80, max: 140 },
  { name: 'Vexthar', verb: 'crush', min: 40, max: 90 },
  { name: 'Solene', verb: 'pierce', min: 25, max: 60 }
]
const PET = { name: 'Gark', owner: 'Vexthar', verb: 'bite', min: 20, max: 45 }
// Two of these are real Expansion Gate bosses, so a replay also exercises
// flag detection on the Progression page.
const MOBS = ['a zol ghoul knight', 'Lord Nagafen', 'an essence tamer', 'Lady Vox']
const ZONE = 'Plane of Fear'

mkdirSync(OUT, { recursive: true })
const paths = new Map(TRIO.map((c) => [c.name, join(OUT, `eqlog_${c.name}_${SERVER}.txt`)]))
for (const p of paths.values()) writeFileSync(p, '')

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function stamp(d) {
  const p = (n) => String(n).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, ' ')
  return `[${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${day} ${p(d.getHours())}:${p(d.getMinutes())}:${p(
    d.getSeconds()
  )} ${d.getFullYear()}]`
}

/** Write one line to one character's log. */
function write(character, body) {
  appendFileSync(paths.get(character), `${stamp(new Date())} ${body}\n`)
}

/**
 * Emit an event the way the client would: first person in the actor's own log,
 * third person in everyone else's.
 */
function emit(actor, first, third) {
  for (const c of TRIO) {
    write(c.name, c.name === actor ? first : third)
  }
}

/** Something nobody in the trio did - identical in all three logs. */
function emitAll(body) {
  for (const c of TRIO) write(c.name, body)
}

/** Running level and AA per character, so dings climb instead of repeating. */
const state = { level: {}, aa: {} }

const rand = (min, max) => Math.floor(min + Math.random() * (max - min + 1))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms / SPEED))

async function fight(mob) {
  console.log(`  pull: ${mob}`)
  const rounds = rand(14, 26)

  for (let r = 0; r < rounds; r++) {
    for (const c of TRIO) {
      if (Math.random() < 0.16) {
        emit(c.name, `You try to ${c.verb} ${mob}, but miss!`, `${c.name} tries to ${c.verb} ${mob}, but misses!`)
      } else {
        const dmg = rand(c.min, c.max)
        const crit = Math.random() < 0.08
        if (crit) {
          emit(c.name, `You deliver a critical blow! (${dmg * 2})`, `${c.name} scores a critical hit! (${dmg * 2})`)
        }
        const amount = crit ? dmg * 2 : dmg
        emit(
          c.name,
          `You ${c.verb} ${mob} for ${amount} points of damage.`,
          `${c.name} ${c.verb}${c.verb.endsWith('h') ? 'es' : 's'} ${mob} for ${amount} points of damage.`
        )
      }
    }

    // The pet is third-person in every log, including its owner's.
    if (Math.random() < 0.8) {
      emitAll(`${PET.name} ${PET.verb}s ${mob} for ${rand(PET.min, PET.max)} points of damage.`)
    }

    // A nuke, and the untargeted damage line that follows it.
    if (r % 5 === 2) {
      emit('Solene', 'You begin casting Ancient Breath.', 'Solene begins to cast a spell.')
      await sleep(300)
      emitAll(`${mob} was hit by non-melee for ${rand(300, 620)} points of damage.`)
    }

    // A weapon proc.
    if (Math.random() < 0.25) {
      emit('Braxus', 'You begin casting Smiting Strike.', 'Braxus begins to cast a spell.')
      emitAll(`${mob} was hit by non-melee for ${rand(60, 120)} points of damage.`)
    }

    // The mob swings back.
    if (Math.random() < 0.7) {
      const victim = TRIO[rand(0, 2)].name
      emitAll(`${mob} hits ${victim} for ${rand(30, 110)} points of damage.`)
    }

    // A heal.
    if (Math.random() < 0.3) {
      const target = TRIO[rand(0, 2)].name
      emitAll(`Solene healed ${target} for ${rand(150, 400)} hit points by Superior Healing.`)
    }

    await sleep(1000)
  }

  // The killer's own log says "You have slain", everyone else's names them.
  // Getting this right matters: it is what lets the merge rule attribute the
  // kill to exactly one log instead of dropping or triplicating it.
  emit('Braxus', `You have slain ${mob}!`, `${mob} has been slain by Braxus!`)
  // Everyone who was there gets credit, in their own log.
  for (const c of TRIO) write(c.name, 'You gain experience!!')

  // Occasional dings, so the Leveling page has something real to chart.
  for (const c of TRIO) {
    if (Math.random() < 0.35) {
      state.aa[c.name] = (state.aa[c.name] ?? 0) + 1
      write(c.name, `You have gained an ability point!  You now have ${state.aa[c.name]} ability points.`)
    }
    if (Math.random() < 0.18) {
      state.level[c.name] = (state.level[c.name] ?? 50) + 1
      write(c.name, `You have gained a level! Welcome to level ${state.level[c.name]}!`)
    }
  }
  console.log(`  down: ${mob}`)
}

async function main() {
  console.log(`replaying into ${OUT} (speed ${SPEED}x)`)
  for (const c of TRIO) write(c.name, `You have entered ${ZONE}.`)
  emitAll(`${PET.name} says, 'My leader is ${PET.owner}.'`)

  let n = 0
  while (n < MAX_FIGHTS) {
    await fight(MOBS[n % MOBS.length])
    n += 1
    await sleep(6000) // long enough for the fight to close on the timeout
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
