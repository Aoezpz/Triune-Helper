import { useId } from 'react'

/**
 * The Nexus Reader mark.
 *
 * A broken ring around three bars. The bars read two ways on purpose: as a
 * meter, which is what the app is, and as the trio, which is who it is for.
 * The centre one is the obelisk from the key art (design/keyart.jpg) - the art
 * itself is kept for places a picture gets a whole screen, because at 16px it
 * reduces to a violet smudge.
 *
 * Geometry is a flat reduction of that art, drawn on a 48x48 grid centred on
 * (24, 24). The ring's gap is what makes the silhouette recognisable at a
 * glance, so it is the one thing that never closes.
 *
 * Motion is deliberately slower than the old emblem's: the gap sweeping round
 * once every 18 seconds reads as alive without becoming something that moves
 * in the corner of your eye while you are trying to read a damage row.
 */

/**
 * Below this the two outer bars stop resolving and only muddy the centre one,
 * so they are dropped and the ring thickens to compensate. Same threshold the
 * .ico uses for its 16 and 24 entries (scripts/make-icon.mjs).
 */
const REDUCE_BELOW = 22

export function Crest({ size = 44, spin = true }: { size?: number; spin?: boolean }): JSX.Element {
  // Gradient ids must be unique per instance: the title bar and the hero both
  // render a mark, and duplicate ids would make one steal the other's fills.
  const uid = useId().replace(/:/g, '')
  const id = (n: string): string => `${n}-${uid}`

  const small = size < REDUCE_BELOW

  return (
    <svg
      className={spin ? 'mark' : 'mark still'}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      role="img"
      aria-label="Nexus Reader"
    >
      <defs>
        {/* Faint on purpose. At 32px in the title bar a stronger halo stops
            reading as light around the ring and starts reading as a grey disc
            behind it, which is what the mark is standing on top of. */}
        <radialGradient id={id('halo')}>
          <stop offset=".46" stopColor="#a855f7" stopOpacity="0" />
          <stop offset=".74" stopColor="#c9a2ff" stopOpacity=".16" />
          <stop offset="1" stopColor="#c9a2ff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Halo, breathing on its own cycle */}
      <circle className="mk-halo" cx="24" cy="24" r="23.5" fill={`url(#${id('halo')})`} />

      {/* The broken ring. One arc, gap on the left, turning slowly.
          #8778ab, not the #5b5170 the mock used: on the mock's light artboard
          that value read as a soft grey edge, and on the app's near black
          ground it disappeared, leaving three bars floating. */}
      <path
        className="mk-ring"
        d="M11.14 8.68A20 20 0 1 1 11.14 39.32"
        stroke="#8778ab"
        strokeWidth={small ? 6.5 : 3.6}
        strokeLinecap="round"
      />

      {small ? (
        <path className="mk-spire" d="M20 35V19L24 12L28 19V35Z" fill="#c9a2ff" />
      ) : (
        <>
          <rect className="mk-b1" x="14.5" y="25" width="4.6" height="9" rx="1.6" fill="#a855f7" opacity="0.55" />
          <path className="mk-spire" d="M21.7 34V19.5L24 14.5L26.3 19.5V34Z" fill="#c9a2ff" />
          <rect className="mk-b3" x="28.9" y="22" width="4.6" height="12" rx="1.6" fill="#a855f7" opacity="0.8" />
        </>
      )}
    </svg>
  )
}
