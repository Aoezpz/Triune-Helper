import { useEffect, useState } from 'react'
import type { OverlayPreset, OverlayState } from '@shared/ipc'
import { hasUpdate, type UpdateStatus } from '@shared/update'
import { Aurora } from './Ambient'
import { Crest } from './Crest'
import { IconClose, IconMax, IconMin, IconOverlay } from './Icons'

/** Slot colours are positional (see theme.css) - character 1 is always sky. */
const SLOT_VARS = ['var(--slot-1)', 'var(--slot-2)', 'var(--slot-3)']

/**
 * The update control: fetch it, watch it arrive, restart into it.
 *
 * A dev run has no packaged installer to replace, so there the click opens the
 * release page instead - the same escape hatch a failed download falls back to,
 * which is why the manual route is never taken away.
 */
function UpdatePill({ s }: { s: UpdateStatus }): JSX.Element {
  const open = (): void => void window.triune.invoke('shell:open', s.url)

  if (s.phase === 'downloading') {
    return (
      <span className="uppill busy" title={`Downloading ${s.latest}`}>
        <span className="updot" aria-hidden="true" />
        Downloading {s.percent}%
      </span>
    )
  }

  if (s.phase === 'ready') {
    return (
      <button
        className="uppill ready no-drag"
        type="button"
        title={`${s.latest} is downloaded. Restarts the app and runs the installer — the game is untouched either way.`}
        onClick={() => void window.triune.invoke('update:install')}
      >
        <span className="updot" aria-hidden="true" />
        Restart to update
      </button>
    )
  }

  return (
    <button
      className="uppill no-drag"
      type="button"
      title={
        s.canSelfInstall
          ? `You are on ${s.current}. Downloads ${s.latest} inside the app; you choose when to restart.`
          : `You are on ${s.current}. ${s.latest} is out — opens the release page in your browser.`
      }
      onClick={() => void (s.canSelfInstall ? window.triune.invoke('update:download') : open())}
    >
      <span className="updot" aria-hidden="true" />
      {s.canSelfInstall ? `Get ${s.latest}` : `Update to ${s.latest}`}
    </button>
  )
}

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

  // One look on launch. Main caches the answer and honours the setting, so this
  // costs nothing when the check is turned off and nothing on a remount. After
  // that, main pushes every phase change and download tick.
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    void window.triune.invoke('update:check').then(setUpdate)
    return window.triune.on('update:status', setUpdate)
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
          Nexus Reader
          {/* The descriptor, not the server. This app is pointed at whichever
              trio server you play; naming one here would be a lie on every
              other one. The server you ARE on is named in the character picker
              at the other end of this bar, where it is a fact rather than a
              claim. */}
          <small>Emu Multitool</small>
        </span>
      </div>

      <div className="spacer" />

      {/* Only ever appears when there IS a newer build. An "up to date" badge
          would be noise on every launch forever to say nothing happened.

          One control, three jobs, in the order they happen: fetch it, watch it
          arrive, restart into it. A separate button per stage would mean two of
          them are always dead. */}
      {update && hasUpdate(update) && <UpdatePill s={update} />}

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
