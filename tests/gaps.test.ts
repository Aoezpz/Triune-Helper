import { describe, expect, it } from 'vitest'
import { parseLine, type ParseContext } from '../src/shared/parser/patterns'
import { tokenize } from '../src/shared/parser/tokenize'

/**
 * Lines the parser used to throw away.
 *
 * Every one of these was found by counting what `scripts/unparsed.mjs` left
 * over in a real 46,000-line day, and every one was losing something real
 * while the app looked like it was working. They are grouped here because
 * that is the failure mode worth having a regression suite for: not a crash,
 * but a total that is quietly too low.
 */

const ctx: ParseContext = { self: 'Hexzo', petOwners: new Map(), players: new Set(['Incredibaal']) }
const parse = (body: string): ReturnType<typeof parseLine> =>
  parseLine(tokenize(`[Wed Aug 12 16:03:05 2026] ${body}`, 'Hexzo', 0)!, ctx)

describe('untargeted non-melee damage', () => {
  /**
   * The second person conjugates. Everyone else "was" hit; you "were" - so a
   * rule written only for `was` dropped every point of untargeted spell damage
   * landing on your own characters.
   */
  it('reads the second-person form', () => {
    const e = parse('You were hit by non-melee for 50 points of damage.')
    expect(e.kind).toBe('spell')
    expect(e.target?.kind).toBe('self')
    expect(e.amount).toBe(50)
  })

  it('still reads the third-person form', () => {
    const e = parse('a gnoll was hit by non-melee for 300 points of damage.')
    expect(e.kind).toBe('spell')
    expect(e.target?.name).toBe('a gnoll')
    expect(e.amount).toBe(300)
  })
})

describe('crits', () => {
  /**
   * The first-person rule covered "deliver a critical blast"; the third-person
   * rule covered only "scores a critical hit". So your own spell crits counted
   * and every group-mate's did not.
   */
  it('reads a third-person critical blast, with its spell', () => {
    const e = parse('Incredibaal delivers a critical blast! (2856) (Bladewhirl)')
    expect(e.kind).toBe('crit')
    expect(e.attacker?.name).toBe('Incredibaal')
    expect(e.amount).toBe(2856)
    expect(e.skill).toBe('Bladewhirl')
  })

  it('reads a third-person critical blow', () => {
    const e = parse('Incredibaal delivers a critical blow! (900)')
    expect(e.kind).toBe('crit')
    expect(e.amount).toBe(900)
  })

  it('still reads the older third-person wording', () => {
    const e = parse('Incredibaal scores a critical hit! (1500)')
    expect(e.kind).toBe('crit')
    expect(e.amount).toBe(1500)
  })

  /** A damage-over-time crit, which the client words differently again. */
  it('reads a damage-over-time crit', () => {
    const e = parse(
      "Your fiery affliction rages out of control upon Diaku Guardian! (1250) (Flames of Kesh`yk Effect III)"
    )
    expect(e.kind).toBe('crit')
    expect(e.attacker?.kind).toBe('self')
    expect(e.target?.name).toBe('Diaku Guardian')
    expect(e.amount).toBe(1250)
    expect(e.skill).toBe('Flames of Kesh`yk Effect III')
  })
})

describe('incoming damage that names a source but no attacker', () => {
  /** Two sentences, one event - and the double space is the client's own. */
  it('reads an arrow penetrating your armor', () => {
    const e = parse('A Barbed arrow penetrates your armor.  You have taken 302 points of damage.')
    expect(e.kind).toBe('spell')
    expect(e.target?.kind).toBe('self')
    expect(e.skill).toBe('A Barbed arrow')
    expect(e.amount).toBe(302)
  })

  it('copes with a single space too', () => {
    const e = parse('A Barbed arrow penetrates your armor. You have taken 10 points of damage.')
    expect(e.amount).toBe(10)
  })
})

describe('discoveries', () => {
  it('reads the tiered form', () => {
    const e = parse('Rump has discovered: Hammer of Holy Vengeance (Legendary).')
    expect(e.kind).toBe('loot')
    expect(e.item).toBe('Hammer of Holy Vengeance')
    expect(e.tier).toBe('Legendary')
    expect(e.broadcast).toBe(true)
  })

  /** The other wording, which every rule missed because it has no parentheses. */
  it('reads the quoted-category form', () => {
    const e = parse("Rump has discovered: Glamour - 'Hat of Whimsy'.")
    expect(e.kind).toBe('loot')
    expect(e.item).toBe('Hat of Whimsy')
    expect(e.tier).toBe('Glamour')
    expect(e.broadcast).toBe(true)
  })
})
