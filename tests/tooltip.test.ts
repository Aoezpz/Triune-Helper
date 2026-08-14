import { describe, expect, it } from 'vitest'
import { parseLine, type ParseContext } from '../src/shared/parser/patterns'
import { tokenize } from '../src/shared/parser/tokenize'
import type { ParsedEvent } from '../src/shared/parser/types'
import { isSpellName, seconds, ticksToText } from '../src/shared/tooltip'
import { parseItemCard } from '../src/main/tooltips'
import type { ItemTip } from '../src/shared/tooltip'

function ctx(self = 'Hexzo'): ParseContext {
  return { self, petOwners: new Map(), players: new Set([self]) }
}

function parse(body: string, c: ParseContext = ctx()): ParsedEvent {
  const line = tokenize(`[Wed Aug 12 03:12:50 2026] ${body}`, c.self, 0)
  expect(line, `tokenize failed for: ${body}`).not.toBeNull()
  return parseLine(line!, c)
}

describe('loot lines', () => {
  it('reads your own loot in the first person', () => {
    const ev = parse('--You have looted a Cord of Potameid Braids.--')
    expect(ev.kind).toBe('loot')
    expect(ev.item).toBe('Cord of Potameid Braids')
    expect(ev.attacker).toEqual({ name: 'Hexzo', kind: 'self' })
    expect(ev.broadcast).toBeUndefined()
  })

  it("reads somebody else's loot without claiming it", () => {
    const ev = parse('--Braxus has looted a Golden Rod.--')
    expect(ev.item).toBe('Golden Rod')
    expect(ev.target?.name).toBe('Braxus')
    // No attacker, so the merge rule counts it from the primary log only.
    expect(ev.attacker).toBeUndefined()
  })

  it('reads a discovery broadcast, tier and all', () => {
    // A real line, verbatim from a real log - this is the commonest way an item
    // name reaches the app on this server.
    const ev = parse('Wrexkz has discovered: Cord of Potameid Braids (Enchanted).')
    expect(ev.kind).toBe('loot')
    expect(ev.item).toBe('Cord of Potameid Braids')
    expect(ev.tier).toBe('Enchanted')
    expect(ev.target?.name).toBe('Wrexkz')
    // Flagged, because thirty of these an hour would bury the stream.
    expect(ev.broadcast).toBe(true)
  })

  it('keeps a comma-and-parenthesis item name in one piece', () => {
    const ev = parse('Yeger has discovered: Urmiir, Sword of Beast Slaying (Legendary).')
    expect(ev.item).toBe('Urmiir, Sword of Beast Slaying')
    expect(ev.tier).toBe('Legendary')
  })
})

describe('isSpellName', () => {
  /**
   * The test is casing, and it works because both halves are produced by this
   * codebase: the parser lower-cases weapon verbs when it canonicalises them,
   * and leaves spell names as the client printed them.
   */
  it('takes capitalised names as spells', () => {
    for (const s of ['Time Rend', 'Cry of Thunder Strike', 'Flames of Kesh`yk Effect III']) {
      expect(isSpellName(s), s).toBe(true)
    }
  })

  it('leaves weapon skills alone', () => {
    for (const s of ['slash', 'kick', 'crush', 'backstab', 'frenzy on']) {
      expect(isSpellName(s), s).toBe(false)
    }
  })

  it("does not ask the site about labels the app invented", () => {
    expect(isSpellName('Heal')).toBe(false)
    expect(isSpellName('Unattributed')).toBe(false)
    expect(isSpellName('Damage Shield')).toBe(false)
    expect(isSpellName('')).toBe(false)
  })
})

describe('parseItemCard', () => {
  /** Trimmed from the real response for /tooltip/8980. */
  const CARD = `
    <table class='item-card'><tbody>
      <tr><td colspan='3'><table>
        <tr><td rowspan="5"><span class="item-icon"></span></td></tr>
        <tr><td></td><td>Cord of Potameid Braids</td></tr>
      </table></td></tr>
      <tr></tr>
      <tr><td colspan='3'><table><tr>
        Class: ALL
      </tr></table></td></tr>
      <tr><td colspan='3'><table><tr>
        Secondary Primary Range
      </tr></table></td></tr>
      <tr><td><table><tr></tr></table></td>
        <td><table>
          <tr><td>AC:</td><td colspan="2" align="right">5</td></tr>
          <tr><td>HP:</td><td align="right">35</td></tr>
          <tr><td>Mana:</td><td align="right">35</td></tr>
          <tr><td>End:</td><td align="right">35</td></tr>
        </table></td>
        <td><table><tr><td>Cold:</td><td align="right">5</td></tr></table></td>
      </tr>
      <tr><td nowrap="1" colspan='3'>Slot 1, type 2 (Elite)</td></tr>
      <tr><td nowrap="1" colspan='3'>Slot 2, type 4 (Weapon)</td></tr>
    </tbody></table>`

  const blank = (): ItemTip => ({
    kind: 'item',
    name: 'Cord of Potameid Braids',
    id: 8980,
    notes: [],
    stats: [],
    extras: []
  })

  it('pulls the stats out as label and value', () => {
    const tip = parseItemCard(CARD, blank())
    expect(tip.stats).toEqual([
      { label: 'AC', value: '5' },
      { label: 'HP', value: '35' },
      { label: 'Mana', value: '35' },
      { label: 'End', value: '35' },
      { label: 'Cold', value: '5' }
    ])
  })

  it('keeps the free-text rows the site writes without cells', () => {
    // These carry the decoded bitmasks - who can wear it and where - which is
    // exactly the part not worth re-deriving from `classes = 65535`.
    expect(parseItemCard(CARD, blank()).notes).toEqual(['Class: ALL', 'Secondary Primary Range'])
  })

  it('collects the augment slots', () => {
    expect(parseItemCard(CARD, blank()).extras).toEqual([
      'Slot 1, type 2 (Elite)',
      'Slot 2, type 4 (Weapon)'
    ])
  })

  it('does not repeat the item name back as a note', () => {
    expect(parseItemCard(CARD, blank()).notes).not.toContain('Cord of Potameid Braids')
  })

  it('survives markup it has never seen', () => {
    const tip = parseItemCard('<p>nothing here</p>', blank())
    expect(tip.stats).toEqual([])
    expect(tip.notes).toEqual([])
    expect(tip.name).toBe('Cord of Potameid Braids')
  })
})

describe('unit formatting', () => {
  it('drops a pointless decimal from a cast time', () => {
    expect(seconds(1)).toBe('1s')
    expect(seconds(2.5)).toBe('2.5s')
    expect(seconds(0)).toBeNull()
    expect(seconds(null)).toBeNull()
  })

  it('turns buff ticks into the time players actually think in', () => {
    expect(ticksToText(5)).toBe('30s')
    expect(ticksToText(10)).toBe('1m')
    expect(ticksToText(15)).toBe('1.5m')
    expect(ticksToText(0)).toBeNull()
  })
})
