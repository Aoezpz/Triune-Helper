import { useMemo } from 'react'

/**
 * Decorative layers. Both are `pointer-events: none`, both are switched off by
 * `prefers-reduced-motion`, and removing either leaves the app plainer and
 * completely functional - the same contract kisstriune/gfx.lua holds itself to.
 */

export function Aurora(): JSX.Element {
  return (
    <div className="aurora" aria-hidden="true">
      <i className="a1" />
      <i className="a2" />
      <i className="a3" />
    </div>
  )
}

/**
 * A fixed, deterministic starfield. Positions come from a seeded PRNG rather
 * than Math.random so the stars don't reshuffle on every re-render - a field
 * that twitches when you switch tabs reads as a bug, not as atmosphere.
 */
export function Starfield({ count = 46, seed = 1337 }: { count?: number; seed?: number }): JSX.Element {
  const stars = useMemo(() => {
    let s = seed
    const rand = (): number => {
      // mulberry32
      s |= 0
      s = (s + 0x6d2b79f5) | 0
      let t = Math.imul(s ^ (s >>> 15), 1 | s)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    return Array.from({ length: count }, () => ({
      left: `${rand() * 100}%`,
      top: `${rand() * 100}%`,
      delay: `${rand() * -6}s`,
      scale: 0.6 + rand() * 1.1
    }))
  }, [count, seed])

  return (
    <div className="starfield" aria-hidden="true">
      {stars.map((st, i) => (
        <i
          key={i}
          style={{
            left: st.left,
            top: st.top,
            animationDelay: st.delay,
            transform: `scale(${st.scale})`
          }}
        />
      ))}
    </div>
  )
}
