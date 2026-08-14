import { useEffect, useRef, useState } from 'react'
import type { SeriesPoint } from '@shared/stats'
import { clock, short } from '@shared/stats'

/**
 * The rolling DPS curve.
 *
 * Canvas rather than SVG: a long fight is a few thousand points across four
 * series redrawn five times a second, which is a lot of DOM nodes to keep
 * churning and no benefit - nothing here needs to be individually hoverable,
 * because the hover layer is a crosshair over the whole plot.
 *
 * you / pet / group are STACKED AREAS - together they are one quantity, your
 * side's damage, and stacking is what makes the total readable. `incoming` is
 * a LINE on the same axis: it is a different quantity, so it gets a different
 * mark rather than being piled onto the stack. That shape difference is also
 * the secondary encoding the palette's aqua-red CVD warn requires.
 *
 * One axis only. Incoming shares the dps scale because it IS dps - a second
 * y-axis would be the dual-axis mistake.
 */

const SERIES = [
  { key: 'you' as const, label: 'You', varName: '--series-you' },
  { key: 'pet' as const, label: 'Pet', varName: '--series-pet' },
  { key: 'group' as const, label: 'Group', varName: '--series-group' }
]
const INCOMING = { label: 'Incoming', varName: '--series-incoming' }

const PAD = { top: 10, right: 12, bottom: 18, left: 42 }

function cssVar(el: HTMLElement, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || '#888'
}

export function DpsOverTime({ series }: { series: SeriesPoint[] }): JSX.Element {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [hover, setHover] = useState<{ x: number; y: number; point: SeriesPoint } | null>(null)

  useEffect(() => {
    const el = canvas.current
    const box = wrap.current
    if (!el || !box) return

    const draw = (): void => {
      const dpr = window.devicePixelRatio || 1
      const w = box.clientWidth
      const h = box.clientHeight
      if (w === 0 || h === 0) return

      el.width = Math.round(w * dpr)
      el.height = Math.round(h * dpr)
      const ctx = el.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const plotW = w - PAD.left - PAD.right
      const plotH = h - PAD.top - PAD.bottom
      if (plotW <= 0 || plotH <= 0) return

      const grid = cssVar(box, '--chart-grid')
      const axis = cssVar(box, '--chart-axis')
      const colors = SERIES.map((s) => cssVar(box, s.varName))
      const incomingColor = cssVar(box, INCOMING.varName)

      // Peak of the stack or of incoming, whichever is higher - both live on
      // the one axis.
      let peak = 0
      for (const p of series) {
        peak = Math.max(peak, p.you + p.pet + p.group, p.incoming)
      }
      if (peak <= 0) peak = 1
      const yMax = niceCeil(peak)

      const x = (i: number): number =>
        PAD.left + (series.length <= 1 ? plotW / 2 : (i / (series.length - 1)) * plotW)
      const y = (v: number): number => PAD.top + plotH - (v / yMax) * plotH

      // ---- grid + y labels (recessive) ----
      ctx.font = '10px ui-monospace, Consolas, monospace'
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'right'
      for (let i = 0; i <= 2; i++) {
        const v = (yMax / 2) * i
        const py = Math.round(y(v)) + 0.5
        ctx.strokeStyle = grid
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(PAD.left, py)
        ctx.lineTo(w - PAD.right, py)
        ctx.stroke()
        ctx.fillStyle = axis
        ctx.fillText(short(v), PAD.left - 6, py)
      }

      if (series.length === 0) return

      // ---- stacked areas, drawn top-of-stack downward so each band sits on
      //      the one below without overdrawing it ----
      const running = new Float64Array(series.length)
      SERIES.forEach((s, si) => {
        ctx.beginPath()
        // upper edge
        series.forEach((p, i) => {
          const top = running[i] + p[s.key]
          const px = x(i)
          const py = y(top)
          if (i === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        })
        // back along the lower edge
        for (let i = series.length - 1; i >= 0; i--) {
          ctx.lineTo(x(i), y(running[i]))
        }
        ctx.closePath()
        ctx.fillStyle = withAlpha(colors[si], 0.42)
        ctx.fill()

        // A crisp upper edge separates adjacent bands - the 2px-gap rule,
        // expressed as a stroke since areas cannot carry a real gap.
        ctx.beginPath()
        series.forEach((p, i) => {
          const py = y(running[i] + p[s.key])
          if (i === 0) ctx.moveTo(x(i), py)
          else ctx.lineTo(x(i), py)
        })
        ctx.strokeStyle = colors[si]
        ctx.lineWidth = 1.5
        ctx.stroke()

        series.forEach((p, i) => {
          running[i] += p[s.key]
        })
      })

      // ---- incoming, as a line ----
      const anyIncoming = series.some((p) => p.incoming > 0)
      if (anyIncoming) {
        ctx.beginPath()
        series.forEach((p, i) => {
          const py = y(p.incoming)
          if (i === 0) ctx.moveTo(x(i), py)
          else ctx.lineTo(x(i), py)
        })
        ctx.strokeStyle = incomingColor
        ctx.lineWidth = 2
        ctx.stroke()
      }

      // ---- x labels: start and end only; a fight's shape matters, its exact
      //      seconds do not ----
      ctx.fillStyle = axis
      ctx.textAlign = 'left'
      ctx.fillText('0:00', PAD.left, h - PAD.bottom / 2)
      ctx.textAlign = 'right'
      ctx.fillText(clock(series[series.length - 1].t), w - PAD.right, h - PAD.bottom / 2)

      // ---- crosshair ----
      if (hover) {
        const px = Math.round(x(series.indexOf(hover.point))) + 0.5
        ctx.strokeStyle = axis
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(px, PAD.top)
        ctx.lineTo(px, PAD.top + plotH)
        ctx.stroke()
      }
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(box)
    return () => ro.disconnect()
  }, [series, hover])

  const onMove = (e: React.MouseEvent<HTMLDivElement>): void => {
    const box = wrap.current
    if (!box || series.length === 0) return
    const rect = box.getBoundingClientRect()
    const plotW = rect.width - PAD.left - PAD.right
    const rel = (e.clientX - rect.left - PAD.left) / Math.max(1, plotW)
    const i = Math.max(0, Math.min(series.length - 1, Math.round(rel * (series.length - 1))))
    setHover({ x: e.clientX - rect.left, y: e.clientY - rect.top, point: series[i] })
  }

  if (series.length === 0) {
    return <div className="empty">No damage yet.</div>
  }

  return (
    <div className="chart-stack">
      <div
        className="chart-wrap"
        ref={wrap}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <canvas ref={canvas} />
        {hover && (
          <div
            className="chart-tip"
            style={{
              left: Math.min(hover.x + 12, (wrap.current?.clientWidth ?? 0) - 150),
              top: Math.max(4, hover.y - 70)
            }}
          >
            <div className="tip-head">{clock(hover.point.t)}</div>
            {SERIES.map((s) => (
              <div className="tip-row" key={s.key}>
                <span className="swatch" style={{ background: `var(${s.varName})` }} />
                {s.label}
                <span className="v">{short(hover.point[s.key])}</span>
              </div>
            ))}
            <div className="tip-row">
              <span className="swatch" style={{ background: `var(${INCOMING.varName})` }} />
              {INCOMING.label}
              <span className="v">{short(hover.point.incoming)}</span>
            </div>
          </div>
        )}
      </div>

      <div className="legend">
        {SERIES.map((s) => (
          <span className="item" key={s.key}>
            <span className="swatch" style={{ background: `var(${s.varName})` }} />
            {s.label}
          </span>
        ))}
        <span className="item">
          <span className="swatch line" style={{ background: `var(${INCOMING.varName})` }} />
          {INCOMING.label}
        </span>
        <span className="spacer" />
        <span className="muted">5s rolling</span>
      </div>
    </div>
  )
}

/** Round an axis maximum up to something a human would have chosen. */
function niceCeil(v: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / mag
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return step * mag
}

/** Canvas has no colour-mix, so alpha is applied by hand. */
function withAlpha(color: string, alpha: number): string {
  const hex = color.replace('#', '')
  if (hex.length !== 6) return color
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
