import { useEffect, useMemo, useRef, useState } from 'react'
import type { ParsedEvent } from '@shared/parser/types'
import { clock } from '@shared/stats'

/**
 * The fight timeline.
 *
 * One lane per skill, time running left to right. A landed hit is a solid
 * mark; a miss or a resist is a hollow red one. That distinction is the whole
 * point of the view - a lane that looks busy but is mostly hollow is a lane
 * you are wasting, and no bar chart shows you that.
 *
 * Canvas, because a raid parse is tens of thousands of marks and each one is
 * two pixels wide. Zoom is wheel-driven around the cursor, pan is drag; both
 * are clamped so you cannot lose the fight off the edge of the view.
 */

/** Tall enough for two lines of label - skill over actor - without clipping. */
const LANE_H = 30
const LABEL_W = 150
const AXIS_H = 20
const PAD_R = 10

/** Positional trio colours, the same ones the roster and overlay use. */
const SLOT_VARS = ['--slot-1', '--slot-2', '--slot-3']

type Lane = {
  key: string
  skill: string
  actor: string
  events: ParsedEvent[]
}

/** Marks are grouped by attacker+skill: "Braxus · slash" is its own lane. */
function buildLanes(events: ParsedEvent[], selfNames: Set<string>): Lane[] {
  const lanes = new Map<string, Lane>()

  for (const e of events) {
    const relevant =
      e.kind === 'melee' || e.kind === 'spell' || e.kind === 'dot' || e.kind === 'miss' || e.kind === 'resist'
    if (!relevant) continue
    // Outgoing only: incoming damage is a different question and would double
    // the lane count for something the roster already answers.
    if (e.target?.kind !== 'mob') continue
    const actor = e.attacker?.name ?? 'Unattributed'
    const skill = e.skill ?? e.kind
    const key = `${actor}|${skill}`

    let lane = lanes.get(key)
    if (!lane) {
      lane = { key, skill, actor, events: [] }
      lanes.set(key, lane)
    }
    lane.events.push(e)
  }

  // Your own lanes first, then by volume - so the lanes you can act on are at
  // the top rather than sorted alphabetically into the middle.
  return [...lanes.values()].sort((a, b) => {
    const aMine = selfNames.has(a.actor) ? 0 : 1
    const bMine = selfNames.has(b.actor) ? 0 : 1
    if (aMine !== bMine) return aMine - bMine
    return b.events.length - a.events.length
  })
}

function cssVar(el: HTMLElement, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || '#888'
}

export function Timeline({
  events,
  selfNames,
  order,
  start,
  end
}: {
  events: ParsedEvent[]
  selfNames: Set<string>
  /** Stable character order, so lane colours match the roster. */
  order: string[]
  start: number
  end: number
}): JSX.Element {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState(0)
  const [hover, setHover] = useState<{ x: number; y: number; events: ParsedEvent[]; t: number } | null>(null)
  const drag = useRef<{ x: number; offset: number } | null>(null)

  const lanes = useMemo(() => buildLanes(events, selfNames), [events, selfNames])
  const span = Math.max(1, (end - start) / 1000)

  // Fit-to-view whenever the fight changes, so switching fights never leaves
  // you looking at empty space from the previous one's scroll position.
  useEffect(() => {
    setZoom(1)
    setOffset(0)
  }, [start, end])

  useEffect(() => {
    const el = canvas.current
    const box = wrap.current
    if (!el || !box) return

    const draw = (): void => {
      const dpr = window.devicePixelRatio || 1
      const w = box.clientWidth
      const h = Math.max(box.clientHeight, AXIS_H + lanes.length * LANE_H)
      if (w === 0) return

      el.width = Math.round(w * dpr)
      el.height = Math.round(h * dpr)
      el.style.height = `${h}px`
      const ctx = el.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const plotW = w - LABEL_W - PAD_R
      if (plotW <= 0) return

      const grid = cssVar(box, '--chart-grid')
      const axis = cssVar(box, '--chart-axis')
      const you = cssVar(box, '--series-you')
      const pet = cssVar(box, '--series-pet')
      const group = cssVar(box, '--series-group')
      const bad = cssVar(box, '--bad')

      const scale = (plotW * zoom) / span
      const x = (ts: number): number => LABEL_W + ((ts - start) / 1000) * scale - offset

      ctx.font = '11px system-ui, Segoe UI, sans-serif'
      ctx.textBaseline = 'middle'

      // ---- time axis: a tick every 5, 10, 30 or 60s depending on zoom ----
      const targetPx = 90
      const stepCandidates = [1, 2, 5, 10, 15, 30, 60, 120, 300]
      const step = stepCandidates.find((s) => s * scale >= targetPx) ?? 600

      ctx.textAlign = 'center'
      for (let t = 0; t <= span; t += step) {
        const px = x(start + t * 1000)
        if (px < LABEL_W - 1 || px > w) continue
        ctx.strokeStyle = grid
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(Math.round(px) + 0.5, AXIS_H)
        ctx.lineTo(Math.round(px) + 0.5, h)
        ctx.stroke()
        ctx.fillStyle = axis
        ctx.fillText(clock(t), px, AXIS_H / 2)
      }

      // ---- lanes ----
      ctx.textAlign = 'left'
      lanes.forEach((lane, i) => {
        const y = AXIS_H + i * LANE_H + LANE_H / 2

        if (i % 2 === 1) {
          ctx.fillStyle = 'rgba(255,255,255,0.018)'
          ctx.fillRect(0, AXIS_H + i * LANE_H, w, LANE_H)
        }

        // Label, clipped to its gutter so a long spell name can't run under
        // the marks.
        ctx.save()
        ctx.beginPath()
        ctx.rect(0, AXIS_H + i * LANE_H, LABEL_W - 8, LANE_H)
        ctx.clip()
        ctx.fillStyle = cssVar(box, '--text-2')
        ctx.fillText(lane.skill, 8, y - 5)
        ctx.fillStyle = cssVar(box, '--muted')
        ctx.font = '10px system-ui, Segoe UI, sans-serif'
        ctx.fillText(lane.actor, 8, y + 7)
        ctx.font = '11px system-ui, Segoe UI, sans-serif'
        ctx.restore()

        // Colour by WHO, using the same positional slot colours as the roster -
        // on a trio server every lane belongs to "you" in some sense, so one
        // shared colour for all three would make the view unreadable.
        const isPet = lane.events[0]?.attacker?.kind === 'pet'
        const slotIndex = order.indexOf(lane.actor)
        const color = isPet
          ? pet
          : slotIndex >= 0 && slotIndex < SLOT_VARS.length
            ? cssVar(box, SLOT_VARS[slotIndex])
            : selfNames.has(lane.actor)
              ? you
              : group

        for (const e of lane.events) {
          const px = x(e.ts)
          if (px < LABEL_W || px > w) continue
          const landed = e.kind !== 'miss' && e.kind !== 'resist'

          if (landed) {
            ctx.fillStyle = e.critical ? cssVar(box, '--gold') : color
            ctx.fillRect(Math.round(px), y - 6, 2, 12)
          } else {
            // Hollow: a 1px outline reads as "nothing landed here" at a glance,
            // where a filled mark in another colour just reads as another hit.
            ctx.strokeStyle = bad
            ctx.lineWidth = 1
            ctx.strokeRect(Math.round(px) + 0.5, y - 5.5, 3, 11)
          }
        }
      })

      // ---- separator between labels and plot ----
      ctx.strokeStyle = cssVar(box, '--line')
      ctx.beginPath()
      ctx.moveTo(LABEL_W + 0.5, 0)
      ctx.lineTo(LABEL_W + 0.5, h)
      ctx.stroke()
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(box)
    return () => ro.disconnect()
  }, [lanes, zoom, offset, start, end, span, selfNames, order])

  const onWheel = (e: React.WheelEvent<HTMLDivElement>): void => {
    const box = wrap.current
    if (!box) return
    e.preventDefault()
    const rect = box.getBoundingClientRect()
    const plotW = rect.width - LABEL_W - PAD_R
    const cursor = e.clientX - rect.left - LABEL_W + offset

    const next = Math.max(1, Math.min(60, zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2)))
    // Keep the point under the cursor fixed: zooming toward the middle of a
    // three-minute fight is useless when the thing you're looking at is at 2:40.
    const ratio = next / zoom
    const nextOffset = cursor * ratio - (e.clientX - rect.left - LABEL_W)
    setZoom(next)
    setOffset(Math.max(0, Math.min(plotW * next - plotW, nextOffset)))
  }

  const onDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    drag.current = { x: e.clientX, offset }
  }
  const onMove = (e: React.MouseEvent<HTMLDivElement>): void => {
    const box = wrap.current
    if (!box) return
    const rect = box.getBoundingClientRect()

    if (drag.current) {
      const plotW = rect.width - LABEL_W - PAD_R
      const next = drag.current.offset - (e.clientX - drag.current.x)
      setOffset(Math.max(0, Math.min(Math.max(0, plotW * zoom - plotW), next)))
      return
    }

    // Hover: find the lane under the pointer and the marks near the cursor.
    const localY = e.clientY - rect.top - AXIS_H
    const laneIndex = Math.floor(localY / LANE_H)
    const lane = lanes[laneIndex]
    if (!lane) {
      setHover(null)
      return
    }
    const plotW = rect.width - LABEL_W - PAD_R
    const scale = (plotW * zoom) / span
    const t = (e.clientX - rect.left - LABEL_W + offset) / scale
    const ts = start + t * 1000
    const near = lane.events.filter((ev) => Math.abs(ev.ts - ts) < 1200 / zoom)
    if (near.length === 0) {
      setHover(null)
      return
    }
    setHover({ x: e.clientX - rect.left, y: e.clientY - rect.top, events: near, t })
  }

  if (lanes.length === 0) {
    return <div className="empty">No outgoing swings in this fight yet.</div>
  }

  return (
    <div className="tl">
      <div className="tl-bar">
        <span className="muted">{lanes.length} lanes</span>
        <span className="spacer" />
        <span className="muted">scroll to zoom · drag to pan</span>
        <button
          className="btn"
          type="button"
          onClick={() => {
            setZoom(1)
            setOffset(0)
          }}
          disabled={zoom === 1 && offset === 0}
        >
          Fit
        </button>
      </div>

      <div
        className="tl-plot"
        ref={wrap}
        onWheel={onWheel}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={() => (drag.current = null)}
        onMouseLeave={() => {
          drag.current = null
          setHover(null)
        }}
      >
        <canvas ref={canvas} />
        {hover && (
          <div
            className="chart-tip"
            style={{
              left: Math.min(hover.x + 12, (wrap.current?.clientWidth ?? 0) - 200),
              top: Math.max(4, hover.y - 60)
            }}
          >
            <div className="tip-head">{clock(hover.t)}</div>
            {hover.events.slice(0, 5).map((e, i) => (
              <div className="tip-row" key={i}>
                {e.skill ?? e.kind}
                <span className="v">
                  {e.kind === 'miss'
                    ? (e.avoidance ?? 'miss')
                    : e.kind === 'resist'
                      ? 'resisted'
                      : (e.amount?.toLocaleString() ?? '')}
                </span>
              </div>
            ))}
            {hover.events.length > 5 && <div className="tip-head">+{hover.events.length - 5} more</div>}
          </div>
        )}
      </div>
    </div>
  )
}
