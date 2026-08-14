import { CLASS_NAMES, classColor, type Identity } from '@shared/roster'

/**
 * A character's classes, as three small chips.
 *
 * Chips rather than the site's plain `War/Rng/Brd` string, because the thing
 * being read is usually one class out of three - "does this trio have a
 * Necromancer in it" - and a slash-separated run of abbreviations makes you
 * read all three to find out. One colour per class answers it peripherally.
 *
 * Nothing renders when the identity is unknown. A row that quietly says just
 * the name is honest; a row that says "???" implies the app failed at
 * something, when in fact it has simply never met that character.
 */
export function ClassChips({
  id,
  size = 'md'
}: {
  id: Identity | undefined
  size?: 'sm' | 'md'
}): JSX.Element | null {
  if (!id?.classes.length) return null

  return (
    <span className={size === 'sm' ? 'cchips sm' : 'cchips'}>
      {id.classes.map((c, i) => (
        <span
          className="cchip"
          key={`${c}-${i}`}
          title={CLASS_NAMES[c] ?? c}
          // Inline rather than sixteen CSS rules: the colour belongs next to
          // the class it names, and the chip's border already rides on
          // currentColor.
          style={{ color: classColor(c) }}
        >
          {c}
        </span>
      ))}
    </span>
  )
}

/** `65 · Lunar Asylum · #5` - whatever of it we actually know. */
export function IdentityLine({ id }: { id: Identity | undefined }): JSX.Element | null {
  if (!id?.found) return null
  const bits = [
    id.level ? `lvl ${id.level}` : null,
    id.guild,
    id.overallRank ? `#${id.overallRank}` : null
  ].filter(Boolean)
  if (bits.length === 0) return null
  return <span className="idline">{bits.join(' · ')}</span>
}
