import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { OverlayPreset, OverlayState } from '@shared/ipc'
import { clock, short } from '@shared/stats'
import { applyTheme } from '@shared/themes'
import '@shared/theme/theme.css'
import './styles/app.css'
import './styles/charts.css'
import './styles/overlay.css'
import { CombatLog } from './combat/CombatLog'
import { useCombat, useCombatLines } from './hooks/useCombat'

/**
 * The always-on-top windows.
 *
 * Deliberately spare. This is drawn over a game someone is playing, so it
 * carries no aurora, no starfield and no panel ornament - just the numbers, on
 * a ground dark enough to read against anything, at a size readable from
 * across a desk.
 *
 * The whole surface is a drag handle when unlocked; locked, clicks pass
 * through to the game and the chrome fades so it stops competing with what is
 * behind it.
 */

const preset = (new URLSearchParams(location.search).get('preset') ?? 'meter') as OverlayPreset

const SLOT_VARS = ['var(--slot-1)', 'var(--slot-2)', 'var(--slot-3)']

/**
 * Keep the overlay on the same scheme as the main window.
 *
 * Applied to <html> before React paints anything it can, and then again
 * whenever the main window changes it - an overlay never re-reads settings on
 * its own, so without the push it would sit on whatever scheme was current
 * when it opened.
 */
function useTheme(): void {
  useEffect(() => {
    const set = (id: string): void => applyTheme(id, document.documentElement)
    void window.triune.invoke('settings:get').then((s) => set(s.theme))
    return window.triune.on('settings:theme', set)
  }, [])
}

function useOverlayState(): OverlayState {
  const [state, setState] = useState<OverlayState>({
    locked: false,
    open: { meter: false, stream: false }
  })
  useEffect(() => {
    void window.triune.invoke('overlay:state').then(setState)
    return window.triune.on('overlay:changed', setState)
  }, [])
  return state
}

function Chrome({
  title,
  meta,
  locked,
  children
}: {
  title: string
  meta?: string
  locked: boolean
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className={locked ? 'ov locked' : 'ov'}>
      <header className="ov-head">
        <span className="ov-t">{title}</span>
        {meta && <span className="ov-meta num">{meta}</span>}
        <span className="spacer" />
        {/*
          Locked means click-through, so nothing in this header can be reached
          while it is on - including the button that would turn it off. That is
          the point: a click that lands here instead of on the game takes
          Windows focus away from EverQuest and leaves your character running.
          The way back is the main window's Overlay menu, and the hint says so
          rather than leaving you poking at a dead padlock.
        */}
        <button
          className="ov-btn no-drag"
          type="button"
          title={
            locked
              ? 'Click-through. Unlock from the main window: Overlay â–¾ â€º Lock'
              : 'Lock: clicks pass through to the game so it never steals focus'
          }
          onClick={() => void window.triune.invoke('overlay:lock', !locked)}
        >
          {locked ? 'ðŸ”’' : 'ðŸ”“'}
        </button>
        <button
          className="ov-btn no-drag"
          type="button"
          title="Close this overlay"
          onClick={() => void window.triune.invoke('overlay:toggle', { preset, on: false })}
        >
          âœ•
        </button>
      </header>
      <div className="ov-body">{children}</div>
      {/*
        Along the bottom edge rather than in the header: a 300px overlay has no
        spare width, and putting this in the header squeezed the title down to
        "C..". It only appears while the cursor is over the window, which a
        locked overlay still sees - setIgnoreMouseEvents forwards movement even
        though it swallows clicks.
      */}
      {locked && <div className="ov-locknote">click-through â€” unlock in Overlay â–¾</div>}
    </div>
  )
}

function Meter({ locked }: { locked: boolean }): JSX.Element {
  const combat = useCombat()
  const fight = combat.live ?? combat.history[0] ?? null

  if (!fight) {
    return (
      <Chrome title="Nexus" locked={locked}>
        <div className="ov-idle">waiting for combat</div>
      </Chrome>
    )
  }

  const max = fight.sources[0]?.damage ?? 0
  const order = fight.sources.filter((s) => s.kind !== 'pet').map((s) => s.name)

  return (
    <Chrome
      title={fight.name}
      meta={`${Math.round(fight.dps).toLocaleString()} dps Â· ${clock(fight.durationSeconds)}`}
      locked={locked}
    >
      <div className="ov-rows">
        {fight.sources.slice(0, 6).map((row) => {
          const idx = order.indexOf(row.owner ?? row.name)
          const color =
            row.kind === 'pet' ? 'var(--series-pet)' : (SLOT_VARS[idx] ?? 'var(--series-group)')
          return (
            <div className="ov-row" key={row.name}>
              <span
                className="ov-fill"
                style={{ width: `${max > 0 ? (row.damage / max) * 100 : 0}%`, background: color }}
              />
              <span className="ov-name">{row.name}</span>
              <span className="ov-val num">{Math.round(row.dps).toLocaleString()}</span>
              <span className="ov-tot num">{short(row.damage)}</span>
            </div>
          )
        })}
      </div>
    </Chrome>
  )
}

function Stream({ locked }: { locked: boolean }): JSX.Element {
  const lines = useCombatLines(120, false)
  return (
    <Chrome title="Stream" locked={locked}>
      <CombatLog lines={lines} compact />
    </Chrome>
  )
}

function OverlayApp(): JSX.Element {
  useTheme()
  const { locked } = useOverlayState()
  return preset === 'stream' ? <Stream locked={locked} /> : <Meter locked={locked} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OverlayApp />
  </StrictMode>
)
