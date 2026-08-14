import { describe, expect, it } from 'vitest'
import { parseLine, type ParseContext } from '../src/shared/parser/patterns'
import { tokenize, tokenizeChunk } from '../src/shared/parser/tokenize'
import type { ParsedEvent } from '../src/shared/parser/types'

function ctx(self = 'Braxus'): ParseContext {
  return { self, petOwners: new Map() }
}

/** Parse one body line as if it were logged by `self`. */
function parse(body: string, c: ParseContext = ctx()): ParsedEvent {
  const line = tokenize(`[Wed Aug 11 19:44:02 2026] ${body}`, 'Braxus', 0)
  expect(line, `tokenize failed for: ${body}`).not.toBeNull()
  return parseLine(line!, c)
}

describe('tokenize', () => {
  it('splits the timestamp from the body', () => {
    const t = tokenize('[Wed Aug 11 19:44:02 2026] You have entered Plane of Fear.', 'Braxus', 3)
    expect(t).not.toBeNull()
    expect(t!.body).toBe('You have entered Plane of Fear.')
    expect(t!.seq).toBe(3)
    expect(new Date(t!.ts).getFullYear()).toBe(2026)
    expect(new Date(t!.ts).getHours()).toBe(19)
  })

  it('handles the single-space day padding EverQuest uses below the 10th', () => {
    const t = tokenize('[Sun Aug  3 04:05:06 2026] You gain experience!!', 'Braxus', 0)
    expect(t).not.toBeNull()
    expect(new Date(t!.ts).getDate()).toBe(3)
  })

  it('rejects lines without a timestamp instead of guessing', () => {
    expect(tokenize('You slash a gnoll for 45 points of damage.', 'Braxus', 0)).toBeNull()
    expect(tokenize('', 'Braxus', 0)).toBeNull()
  })

  it('keeps sequence running across chunk boundaries', () => {
    const a = tokenizeChunk('[Wed Aug 11 19:44:02 2026] You gain experience!!\n', 'Braxus', 0)
    const b = tokenizeChunk('[Wed Aug 11 19:44:02 2026] You gain experience!!\n', 'Braxus', a.nextSeq)
    expect(a.lines[0].seq).toBe(0)
    expect(b.lines[0].seq).toBe(1)
  })
})

describe('melee', () => {
  it('parses a first-person swing and resolves You to the log owner', () => {
    const e = parse('You slash a gnoll for 45 points of damage.')
    expect(e.kind).toBe('melee')
    expect(e.attacker).toEqual({ name: 'Braxus', kind: 'self' })
    expect(e.target).toEqual({ name: 'a gnoll', kind: 'mob' })
    expect(e.skill).toBe('slash')
    expect(e.amount).toBe(45)
  })

  it('parses a third-person swing and canonicalises the verb', () => {
    const e = parse('Vexthar slashes a gnoll for 45 points of damage.')
    expect(e.kind).toBe('melee')
    expect(e.attacker!.name).toBe('Vexthar')
    // "slashes" and "slash" must aggregate to one row, not two
    expect(e.skill).toBe('slash')
  })

  it('does not let a short verb swallow a compound one', () => {
    const e = parse('Vexthar round kicks a gnoll for 60 points of damage.')
    expect(e.skill).toBe('round kick')
  })

  it('parses a mob swinging at a player', () => {
    const e = parse('a gnoll hits Braxus for 12 points of damage.')
    expect(e.attacker!.kind).toBe('mob')
    expect(e.target!.name).toBe('Braxus')
    expect(e.amount).toBe(12)
  })

  it('handles the singular "1 point of damage"', () => {
    expect(parse('You kick a gnoll for 1 point of damage.').amount).toBe(1)
  })
})

describe('avoided swings', () => {
  it('records a plain miss', () => {
    const e = parse('You try to slash a gnoll, but miss!')
    expect(e.kind).toBe('miss')
    expect(e.avoidance).toBe('miss')
    expect(e.skill).toBe('slash')
  })

  it('distinguishes how the swing was avoided', () => {
    expect(parse('a gnoll tries to hit Braxus, but Braxus dodges!').avoidance).toBe('dodge')
    expect(parse('a gnoll tries to hit Braxus, but Braxus parries!').avoidance).toBe('parry')
    expect(parse('a gnoll tries to hit Braxus, but Braxus ripostes!').avoidance).toBe('riposte')
    expect(parse('a gnoll tries to hit Braxus, but Braxus blocks!').avoidance).toBe('block')
    expect(parse('You try to slash a gnoll, but a gnoll is INVULNERABLE!').avoidance).toBe('invulnerable')
  })
})

describe('spell and shield damage', () => {
  it('parses an untargeted non-melee hit, leaving the attacker unresolved', () => {
    const e = parse('a gnoll was hit by non-melee for 300 points of damage.')
    expect(e.kind).toBe('spell')
    expect(e.amount).toBe(300)
    expect(e.target!.name).toBe('a gnoll')
    // The log genuinely does not name the caster on this line.
    expect(e.attacker).toBeUndefined()
  })

  it('attributes a damage shield to the wearer, not the attacker', () => {
    const e = parse('a gnoll is pierced by YOUR thorns for 12 points of non-melee damage.')
    expect(e.attacker!.name).toBe('Braxus')
    expect(e.target!.name).toBe('a gnoll')
    expect(e.skill).toBe('Damage shield')
    expect(e.amount).toBe(12)
  })

  it('parses both DoT tick wordings', () => {
    const mine = parse('a gnoll has taken 45 damage from your Flame of Light.')
    expect(mine.kind).toBe('dot')
    expect(mine.attacker!.name).toBe('Braxus')
    expect(mine.skill).toBe('Flame of Light')

    const theirs = parse('a gnoll has taken 45 damage from Flame of Light by Vexthar.')
    expect(theirs.kind).toBe('dot')
    expect(theirs.attacker!.name).toBe('Vexthar')
    expect(theirs.skill).toBe('Flame of Light')
  })
})

describe('crits, heals and resists', () => {
  it('reads a crit annotation as its own event', () => {
    const e = parse('You deliver a critical blow! (450)')
    expect(e.kind).toBe('crit')
    expect(e.amount).toBe(450)
  })

  it('parses both heal wordings', () => {
    const a = parse('Vexthar healed Braxus for 100 hit points by Superior Healing.')
    expect(a.kind).toBe('heal')
    expect(a.skill).toBe('Superior Healing')
    expect(a.amount).toBe(100)

    const b = parse('Vexthar has healed Braxus for 100 points of damage.')
    expect(b.kind).toBe('heal')
    expect(b.amount).toBe(100)
  })

  it('parses resists', () => {
    expect(parse('Your target resisted the Flame of Light spell.').skill).toBe('Flame of Light')
    expect(parse('a gnoll resisted your Flame of Light!').kind).toBe('resist')
  })
})

describe('deaths, zoning and progression', () => {
  it('parses every death phrasing', () => {
    expect(parse('You have slain a gnoll!').target!.name).toBe('a gnoll')
    expect(parse('a gnoll has been slain by Vexthar!').attacker!.name).toBe('Vexthar')
    const mine = parse('You have been slain by a gnoll!')
    expect(mine.target!.name).toBe('Braxus')
  })

  it('parses zoning', () => {
    expect(parse('You have entered Plane of Fear.').detail).toBe('Plane of Fear')
  })

  it('parses levels and ability points but never invents an XP amount', () => {
    expect(parse('You have gained a level! Welcome to level 52!').amount).toBe(52)
    expect(parse('You have gained an ability point!  You now have 12 ability points.').amount).toBe(12)
    const xp = parse('You gain experience!!')
    expect(xp.kind).toBe('xp')
    expect(xp.amount).toBeUndefined()
  })
})

describe('pets', () => {
  it('learns pet ownership and applies it to later lines', () => {
    const c = ctx()
    const claim = parse("Gark says, 'My leader is Braxus.'", c)
    expect(claim.kind).toBe('chat')

    const swing = parse('Gark bites a gnoll for 30 points of damage.', c)
    expect(swing.attacker).toEqual({ name: 'Gark', kind: 'pet', owner: 'Braxus' })
  })
})

/**
 * Every line in this block was copied out of a real
 * eqlog_Hexzo_multiclass.txt from Project Triune. They are here because the
 * synthetic fixtures were subtly wrong in ways that mattered - most of all
 * about mob names.
 */
describe('real Project Triune log lines', () => {
  it('treats a proper-noun mob as a mob, not an unknown', () => {
    // THE bug: this server names mobs "Gindan Flayer", not "a gnoll". An
    // article-based test left them unclassified, and since a fight only opens
    // on damage involving a mob, real fights never started.
    const e = parse('You hit Gindan Flayer for 20147 points of damage.')
    expect(e.kind).toBe('melee')
    expect(e.target).toEqual({ name: 'Gindan Flayer', kind: 'mob' })
    expect(e.amount).toBe(20147)
  })

  it('does not mistake a boxed character for a mob', () => {
    const c: ParseContext = { self: 'Hexzo', petOwners: new Map(), players: new Set(['Grianne']) }
    const e = parse('Gindan Flayer hits Grianne for 813 points of damage.', c)
    expect(e.attacker!.kind).toBe('mob')
    expect(e.target).toEqual({ name: 'Grianne', kind: 'player' })
  })

  it('parses attributed spell damage, with the spell named', () => {
    const e = parse('Hexzo hit Gindan Flayer for 21110 points of non-melee damage. (Cry of Thunder Strike)')
    expect(e.kind).toBe('spell')
    expect(e.attacker!.name).toBe('Hexzo')
    expect(e.target!.name).toBe('Gindan Flayer')
    expect(e.amount).toBe(21110)
    // Named outright, so no last-cast guessing is needed for these.
    expect(e.skill).toBe('Cry of Thunder Strike')
  })

  it('parses the first-person form of the same message', () => {
    const e = parse('You hit Diaku Elite Guard for 7511 points of non-melee damage. (Time Rend)')
    expect(e.kind).toBe('spell')
    expect(e.attacker!.name).toBe('Braxus')
    expect(e.skill).toBe('Time Rend')
    expect(e.amount).toBe(7511)
  })

  it('parses a spell crit, which names the spell, and a melee crit, which does not', () => {
    const spell = parse('You deliver a critical blast! (44210) (Flames of Kesh`yk Effect III)')
    expect(spell.kind).toBe('crit')
    expect(spell.amount).toBe(44210)
    expect(spell.skill).toBe('Flames of Kesh`yk Effect III')

    const melee = parse('Hexzo scores a critical hit! (2263)')
    expect(melee.kind).toBe('crit')
    expect(melee.amount).toBe(2263)
    expect(melee.skill).toBeUndefined()
  })

  it('parses the real melee verbs against a proper-noun mob', () => {
    expect(parse('You slash Gindan Flayer for 2263 points of damage.').skill).toBe('slash')
    expect(parse('You bash Gindan Flayer for 383 points of damage.').skill).toBe('bash')
    expect(parse('You kick Gindan Flayer for 1244 points of damage.').skill).toBe('kick')
  })

  it('parses a kill and a zone with proper nouns', () => {
    expect(parse('You have slain Diaku Elite Guard!').target!.name).toBe('Diaku Elite Guard')
    expect(parse('You have entered Drunder, the Fortress of Zek.').detail).toBe(
      'Drunder, the Fortress of Zek'
    )
  })

  it('reads the level out of a /who line', () => {
    // The only reliable source of a current level short of dinging.
    const e = parse('[65 Warlord] Hexzo (Human) <Sanctum of Shadows>')
    expect(e.kind).toBe('who')
    expect(e.amount).toBe(65)
    expect(e.skill).toBe('Warlord')
    expect(e.target!.name).toBe('Hexzo')
  })

  it('leaves an anonymous /who alone rather than inventing a level', () => {
    expect(parse('[ANONYMOUS] Hexzo').kind).toBe('unparsed')
  })

  it('parses the ability point line with its double space', () => {
    expect(parse('You have gained an ability point!  You now have 34 ability points.').amount).toBe(34)
  })
})

describe('unmatched lines', () => {
  it('keeps them rather than dropping them', () => {
    const e = parse('Braxus tells you, ' + "'pull in 5'")
    expect(e.kind).toBe('unparsed')
    expect(e.raw).toContain('pull in 5')
  })
})
