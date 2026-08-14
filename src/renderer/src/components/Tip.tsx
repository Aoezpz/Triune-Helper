import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CLASS_NAMES, classColor } from '@shared/roster'
import { seconds, ticksToText, type Tip, type TipKind } from '@shared/tooltip'

/**
 * Hover cards for the names a log drops on the floor.
 *
 * "Hexzo hit Diaku Guardian for 950 points of non-melee damage. (Time Rend)"
 * tells you a number and withholds everything that would let you judge it.
 * PTDex knows what Time Rend is; this puts that knowledge under the cursor
 * without making anybody alt-tab to a browser.
 *
 * Three rules keep it out of the way:
 *
 *   * **Nothing happens until you mean it.** A 350 ms dwell before the request,
 *     so dragging the mouse across a stream scrolling at a hundred lines a
 *     second fires nothing at all.
 *   * **Asked once, ever.** Results are cached in this module for the session
 *     and on disk in main, so the second hover is instant and the hundredth
 *     costs nothing.
 *   * **Silence on a miss.** A name PTDex has never heard of shows no card. An
 *     empty box that says "not found" is a worse answer than no box.
 */

const DWELL_MS = 350

/** Session cache, so re-hovering never even crosses the IPC boundary. */
const seen = new Map<string, Tip | null>()

function useTip(kind: TipKind, name: string, active: boolean): Tip | null {
  const cacheKey = `${kind}:${name.toLowerCase()}`
  const [tip, setTip] = useState<Tip | null>(() => seen.get(cacheKey) ?? null)

  useEffect(() => {
    if (!active || seen.has(cacheKey)) return
    let alive = true
    void window.triune.invoke('tooltip:get', { kind, name }).then((res) => {
      // A network failure is not cached - the next hover should try again.
      if (res.error === null) seen.set(cacheKey, res.tip)
      if (alive) setTip(res.tip)
    })
    return () => {
      alive = false
    }
  }, [cacheKey, kind, name, active])

  return tip ?? seen.get(cacheKey) ?? null
}

export function Tipped({
  kind,
  name,
  children,
  className
}: {
  kind: TipKind
  name: string
  children?: React.ReactNode
  className?: string
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const timer = useRef<number | null>(null)

  const tip = useTip(kind, name, open)

  const cancel = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }

  useEffect(() => cancel, [])

  return (
    <span
      className={className ? `tipped ${className}` : 'tipped'}
      onMouseEnter={(e) => {
        const { clientX: x, clientY: y } = e
        cancel()
        timer.current = window.setTimeout(() => {
          setAt({ x, y })
          setOpen(true)
        }, DWELL_MS)
      }}
      onMouseLeave={() => {
        cancel()
        setOpen(false)
      }}
    >
      {children ?? name}
      {open && at && tip && <Card tip={tip} at={at} />}
    </span>
  )
}

/**
 * The card itself, in a portal at fixed coordinates.
 *
 * Portalled because every surface this can appear on - the stream, the roster,
 * an overlay - clips its own overflow, and a tooltip that gets sliced in half
 * by the panel it came from is worse than none. Fixed coordinates rather than
 * an anchored popper for the same reason: there is nothing to anchor to that
 * isn't inside something scrolling.
 */
function Card({ tip, at }: { tip: Tip; at: { x: number; y: number } }): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: at.x + 16, top: at.y + 16 })

  // Measured after mount rather than guessed: the card's height depends on how
  // many effect lines a spell has, and a fixed offset would push a long one off
  // the bottom of the window.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const pad = 12
    let left = at.x + 16
    let top = at.y + 16
    if (left + r.width > window.innerWidth - pad) left = Math.max(pad, at.x - r.width - 16)
    if (top + r.height > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - r.height - pad)
    setPos({ left, top })
  }, [at.x, at.y, tip])

  return createPortal(
    <div className="tipcard" ref={box} style={{ left: pos.left, top: pos.top }} role="tooltip">
      <div className="tc-head">
        <span className="tc-name">{tip.name}</span>
        <span className="tc-kind">{tip.kind}</span>
      </div>
      {tip.kind === 'spell' ? <SpellBody tip={tip} /> : <ItemBody tip={tip} />}
    </div>,
    document.body
  )
}

function SpellBody({ tip }: { tip: Extract<Tip, { kind: 'spell' }> }): JSX.Element {
  const meta = [
    tip.resist ? `${tip.resist} resist` : null,
    tip.range ? `${tip.range} range` : null,
    ticksToText(tip.durationTicks)
  ].filter(Boolean)

  const cost = [
    tip.mana ? `${tip.mana} mana` : null,
    seconds(tip.castSeconds) ? `${seconds(tip.castSeconds)} cast` : null,
    seconds(tip.recastSeconds) ? `${seconds(tip.recastSeconds)} recast` : null
  ].filter(Boolean)

  return (
    <>
      {meta.length > 0 && <div className="tc-meta">{meta.join(' · ')}</div>}

      {tip.effects.length > 0 && (
        <ul className="tc-fx">
          {tip.effects.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}

      {cost.length > 0 && <div className="tc-cost num">{cost.join(' · ')}</div>}

      {tip.classes.length > 0 && (
        <div className="tc-classes">
          {tip.classes.map((c) => (
            <span
              className="cchip"
              key={c.abbrev}
              style={{ color: classColor(c.abbrev) }}
              title={CLASS_NAMES[c.abbrev] ?? c.abbrev}
            >
              {c.abbrev} {c.level}
            </span>
          ))}
        </div>
      )}

      {tip.effects.length === 0 && meta.length === 0 && cost.length === 0 && (
        // Said plainly. This happens for a handful of internal spells that
        // carry no player-facing data at all, and pretending otherwise would
        // mean inventing something.
        <div className="tc-meta">PTDex lists this spell but has no details for it.</div>
      )}
    </>
  )
}

function ItemBody({ tip }: { tip: Extract<Tip, { kind: 'item' }> }): JSX.Element {
  return (
    <>
      {tip.notes.map((n, i) => (
        <div className="tc-meta" key={i}>
          {n}
        </div>
      ))}

      {tip.stats.length > 0 && (
        <div className="tc-stats">
          {tip.stats.map((s, i) => (
            <div className="tc-stat" key={`${s.label}-${i}`}>
              <span className="l">{s.label}</span>
              <span className="v num">{s.value}</span>
            </div>
          ))}
        </div>
      )}

      {tip.extras.length > 0 && (
        <div className="tc-extras">
          {tip.extras.map((a, i) => (
            <div key={i}>{a}</div>
          ))}
        </div>
      )}
    </>
  )
}
