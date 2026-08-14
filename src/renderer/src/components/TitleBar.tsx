import { useEffect, useState } from 'react'
import type { OverlayPreset, OverlayState } from '@shared/ipc'
import { Aurora } from './Ambient'
import { Crest } from './Crest'
import { IconClose, IconMax, IconMin, IconOverlay } from './Icons'

/** Slot colours are positional (see theme.css) - character 1 is always sky. */
const SLOT_VARS = ['var(--slot-1)', 'var(--slot-2)', 'var(--slot-3)']

export function TitleBar({
  characters,
  active,
  onSelect,
  server,
  live
}: {
  characters: string[]
  active: string | null
  onSelect: (name: string) => void
  server: string
  live: boolean
}): JSX.Element {
  const [maximized, setMaximized] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [overlay, setOverlay] = useState<OverlayState>({
    locked: false,
    open: { meter: false, stream: false }
  })

  useEffect(() => {
    void window.triune.invoke('window:isMaximized').then(setMaximized)
    return window.triune.on('window:maximized', setMaximized)
  }, [])

  useEffect(() => {
    void window.triune.invoke('overlay:state').then(setOverlay)
    return window.triune.on('overlay:changed', setOverlay)
  }, [])

  const activeIndex = active ? characters.indexOf(active) : -1
  const slot = SLOT_VARS[activeIndex] ?? 'var(--muted)'

  // A <select> rather than a bespoke menu: it stays keyboard- and
  // screen-reader-navigable for free, and it can't get stuck open behind the
  // always-on-top overlay windows.
  return (
    <header className="titlebar">
      <Aurora />

      <div className="brand">
        <Crest size={32} />
        <span className="wordmark">
          Triune-Helper
          <small>Project Triune</small>
        </span>
      </div>

      <div className="spacer" />

      <span className={live ? 'dot live' : 'dot'} title={live ? 'Reading logs' : 'Not reading logs'} />

      <div className="ovmenu no-drag">
        <button
          className={Object.values(overlay.open).some(Boolean) ? 'btn on' : 'btn'}
          type="button"
          aria-haspopup="true"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          title="Always-on-top overlays"
        >
          <IconOverlay />
          Overlay
          <i className="caret" aria-hidden="true" />
        </button>

        {menuOpen && (
          <div className="ovmenu-pop" role="menu" onMouseLeave={() => setMenuOpen(false)}>
            {(['meter', 'stream'] as OverlayPreset[]).map((p) => (
              <button
                key={p}
                role="menuitemcheckbox"
                aria-checked={overlay.open[p]}
                type="button"
                onClick={() => void window.triune.invoke('overlay:toggle', { preset: p }).then(setOverlay)}
              >
                <span className="tick">{overlay.open[p] ? '✓' : ''}</span>
                {p === 'meter' ? 'Damage meter' : 'Combat stream'}
              </button>
            ))}
            <div className="ovmenu-sep" />
            <button
              role="menuitemcheckbox"
              aria-checked={overlay.locked}
              type="button"
              onClick={() => void window.triune.invoke('overlay:lock', !overlay.locked).then(setOverlay)}
            >
              <span className="tick">{overlay.locked ? '✓' : ''}</span>
              Lock (click-through)
            </button>
            <p className="ovmenu-note">
              Overlays open locked, so a stray click lands on the game rather than stealing focus from it —
              which is what leaves your character running. Unlock to move or resize one, then lock it again.
              Needs the game in borderless windowed mode.
            </p>
          </div>
        )}
      </div>

      <label
        className="charpick no-drag"
        title={
          characters.length > 1
            ? 'Who you are playing. Decides whose group the party strip shows.'
            : undefined
        }
      >
        <span className="slot-mark" style={{ background: slot }} aria-hidden="true" />
        {characters.length === 0 ? (
          <span className="muted">No characters yet</span>
        ) : (
          <select
            value={active ?? ''}
            onChange={(e) => onSelect(e.target.value)}
            aria-label="Character you are playing"
            style={{
              background: 'transparent',
              border: 0,
              padding: 0,
              color: 'inherit',
              font: 'inherit'
            }}
          >
            {characters.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        <span className="srv">· {server}</span>
      </label>

      <div className="wincontrols">
        <button type="button" onClick={() => void window.triune.invoke('window:minimize')} aria-label="Minimise">
          <IconMin />
        </button>
        <button
          type="button"
          onClick={() => void window.triune.invoke('window:maximize').then(setMaximized)}
          aria-label={maximized ? 'Restore' : 'Maximise'}
        >
          <IconMax maximized={maximized} />
        </button>
        <button
          className="close"
          type="button"
          onClick={() => void window.triune.invoke('window:close')}
          aria-label="Close"
        >
          <IconClose />
        </button>
      </div>
    </header>
  )
}
