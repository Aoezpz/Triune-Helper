import { useEffect, useMemo, useState } from 'react'
import type { HistoryResult, Settings, WatcherStatus } from '@shared/ipc'
import { DEFAULT_THEME, THEMES } from '@shared/themes'
import { hasUpdate, type UpdateStatus } from '@shared/update'
import { genderOf, resolveVoice, VOICE_PERSONAS, type AvailableVoice } from '@shared/voices'
import { setAlertVolume } from '../alerts/sink'
import {
  availableVoices,
  onVoicesChanged,
  playAlert,
  setVoicePersona,
  speak,
  speakWithVoice
} from '../alerts/sound'

/** Short, and representative of what an alert actually sounds like. */
const SAMPLE = 'Charm broke'

/** Shown only in the moment before the first status arrives. */
const VERSION_UNKNOWN = '…'

export function Preferences({
  settings,
  update,
  status
}: {
  settings: Settings
  update: (patch: Partial<Settings>) => Promise<void>
  status: WatcherStatus | null
}): JSX.Element {
  const [detectMsg, setDetectMsg] = useState<string | null>(null)
  const [voices, setVoices] = useState<AvailableVoice[]>(availableVoices())
  const [upd, setUpd] = useState<UpdateStatus | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)

  // Reads the cached answer main already has; no second request on mount. The
  // subscription is what keeps the percentage moving during a download.
  useEffect(() => {
    void window.triune.invoke('update:check').then(setUpd)
    return window.triune.on('update:status', setUpd)
  }, [])

  // getVoices() is empty on the first call in Chromium; the list arrives
  // asynchronously and announces itself, so re-read when it does.
  useEffect(() => {
    const refresh = (): void => setVoices(availableVoices())
    refresh()
    return onVoicesChanged(refresh)
  }, [])

  const activeNote = useMemo(
    () => resolveVoice(settings.voice, voices).note,
    [settings.voice, voices]
  )

  const pick = async (): Promise<void> => {
    const folder = await window.triune.invoke('logs:pickFolder')
    if (folder) {
      await update({ logFolder: folder })
      setDetectMsg(null)
    }
  }

  const autodetect = async (): Promise<void> => {
    const found = await window.triune.invoke('logs:autodetect')
    if (found) {
      await update({ logFolder: found })
      setDetectMsg(null)
    } else {
      setDetectMsg("Couldn't find a Logs folder with this server's logs — pick it manually.")
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Preferences</h1>
      </div>

      <section className="panel">
        <div className="phead">
          <span className="t">Log source</span>
          <span className="meta">{status?.sources.length ?? 0} watched</span>
        </div>
        <div className="pbody form">
          <label className="field">
            <span className="flabel">EverQuest Logs folder</span>
            <div className="row">
              <input
                type="text"
                value={settings.logFolder}
                placeholder="C:\EverQuest\Logs"
                onChange={(e) => void update({ logFolder: e.target.value })}
                style={{ flex: 1 }}
              />
              <button className="btn" type="button" onClick={() => void pick()}>
                Browse…
              </button>
              <button className="btn" type="button" onClick={() => void autodetect()}>
                Auto-detect
              </button>
            </div>
            <span className="fhint">
              Read-only. Nexus Reader never writes into your game directory. Turn logging on in-game with{' '}
              <code>/log on</code>.
            </span>
            {detectMsg && <span className="err">{detectMsg}</span>}
          </label>

          <label className="field">
            <span className="flabel">Server shortname</span>
            <input
              type="text"
              value={settings.serverShortname}
              onChange={(e) => void update({ serverShortname: e.target.value })}
            />
            <span className="fhint">
              Matches the tail of the log filename — <code>eqlog_&lt;Char&gt;_{settings.serverShortname}.txt</code>.
            </span>
          </label>

          <label className="field">
            <span className="flabel">Primary character</span>
            <select
              value={settings.primaryCharacter}
              onChange={(e) => void update({ primaryCharacter: e.target.value })}
            >
              <option value="">First watched character</option>
              {(status?.sources ?? []).map((s) => (
                <option key={s.character} value={s.character}>
                  {s.character}
                </option>
              ))}
            </select>
            <span className="fhint">
              A tie-break, not a party. When you box a trio the same mob line appears in all three logs, so
              anything that names nobody you are playing — a mob hitting a stranger — is counted from this
              log only. Your own hits and the hits on you are always counted from your own log, whatever
              this says. To choose who you are <em>playing</em>, use the character picker in the title bar.
            </span>
          </label>
        </div>
      </section>

      <section className="panel">
        <div className="phead">
          <span className="t">Encounters</span>
        </div>
        <div className="pbody form">
          <label className="field">
            <span className="flabel">End a fight after</span>
            <div className="row">
              <input
                type="number"
                min={3}
                max={60}
                value={settings.fightTimeoutSeconds}
                onChange={(e) => void update({ fightTimeoutSeconds: Number(e.target.value) })}
                style={{ width: '5rem' }}
              />
              <span className="muted">seconds of no combat</span>
            </div>
          </label>
        </div>
      </section>

      <section className="panel">
        <div className="phead">
          <span className="t">History</span>
        </div>
        <div className="pbody form">
          <RebuildHistory />
        </div>
      </section>

      <section className="panel">
        <div className="phead">
          <span className="t">Updates</span>
          <span className="meta">
            {updateBusy
              ? 'checking…'
              : upd?.phase === 'downloading'
                ? `downloading ${upd.percent}%`
                : upd?.phase === 'ready'
                  ? 'ready to install'
                  : upd?.phase === 'available'
                    ? `${upd.latest} available`
                    : upd?.phase === 'error'
                      ? 'check failed'
                      : upd?.phase === 'current'
                        ? 'up to date'
                        : 'not checked'}
          </span>
        </div>
        <div className="pbody form">
          <label className="field row">
            <input
              type="checkbox"
              checked={settings.updateCheck}
              onChange={(e) => void update({ updateCheck: e.target.checked })}
            />
            <span>Check GitHub for a newer release on launch</span>
          </label>

          <div className="field row">
            <button
              className="btn"
              type="button"
              disabled={!settings.updateCheck || updateBusy}
              onClick={() => {
                setUpdateBusy(true)
                void window.triune
                  .invoke('update:check', { force: true })
                  .then(setUpd)
                  .finally(() => setUpdateBusy(false))
              }}
            >
              Check now
            </button>
            <span className="muted">
              You are running <b>{upd?.current ?? VERSION_UNKNOWN}</b>
              {upd?.latest ? ` · newest published is ${upd.latest}` : ''}
            </span>
          </div>

          {upd && hasUpdate(upd) && (
            <div className="field row">
              {upd.phase === 'available' && upd.canSelfInstall && (
                <button
                  className="btn"
                  type="button"
                  onClick={() => void window.triune.invoke('update:download').then(setUpd)}
                >
                  Download {upd.latest}
                </button>
              )}
              {upd.phase === 'downloading' && (
                <span className="muted">Downloading {upd.percent}%…</span>
              )}
              {upd.phase === 'ready' && (
                <button
                  className="btn"
                  type="button"
                  onClick={() => void window.triune.invoke('update:install')}
                >
                  Restart and install {upd.latest}
                </button>
              )}
              {/* Always offered, at every stage. If the updater breaks, this is
                  the way out, and it must not be hidden behind a failure. */}
              <button
                className="btn"
                type="button"
                onClick={() => void window.triune.invoke('shell:open', upd.url)}
              >
                Open the release page
              </button>
            </div>
          )}

          {/* Stated rather than buried. This is the app's only request that is
              not needed for it to work, so what it sends is spelled out. */}
          <span className="fhint">
            This asks GitHub for one public file — the newest release number — and nothing else.
            GitHub sees your IP address, exactly as visiting the releases page in a browser would. No
            character name, no log line and no identifier is sent, ever.
            <br />
            <br />
            Nothing downloads or installs on its own. Finding a new version, fetching it, and
            restarting into it are three separate clicks you make, so the app never spends your
            bandwidth or replaces itself mid-raid. The installer it downloads is checked against the
            hash published with the release. Untick the box and no request is made at all.
          </span>
          {upd?.error && <span className="fhint bad">{upd.error}</span>}
        </div>
      </section>

      <section className="panel">
        <div className="phead">
          <span className="t">Color scheme</span>
          <span className="meta">applies to the overlays too</span>
        </div>
        <div className="pbody form">
          <div className="themegrid">
            {THEMES.map((t) => {
              const chosen = (settings.theme || DEFAULT_THEME) === t.id
              return (
                <button
                  key={t.id}
                  className={chosen ? 'themecard on' : 'themecard'}
                  type="button"
                  aria-pressed={chosen}
                  onClick={() => void update({ theme: t.id })}
                >
                  {/* Ground, accent, secondary - enough to recognise a scheme
                      without having to apply it and change your mind back. */}
                  <span className="tc-swatch" style={{ background: t.swatch[0] }} aria-hidden="true">
                    <i style={{ background: t.swatch[1] }} />
                    <i style={{ background: t.swatch[2] }} />
                  </span>
                  <span className="tc-name">{t.name}</span>
                  <span className="tc-note">{t.note}</span>
                </button>
              )
            })}
          </div>
          <span className="fhint">
            Every scheme is dark. Status colors, the three trio slot markers and the chart series colors
            are the same in all of them on purpose — they carry meaning, and a scheme that repainted them
            would turn &ldquo;you died&rdquo; into a decorative choice.
          </span>
        </div>
      </section>

      <section className="panel">
        <div className="phead">
          <span className="t">Alert voice</span>
          <span className="meta">{voices.length} available</span>
        </div>
        <div className="pbody form">
          <label className="field">
            <span className="flabel">Voice</span>
            <div className="voicegrid">
              {VOICE_PERSONAS.map((p) => {
                const res = resolveVoice(p.id, voices)
                const chosen = settings.voice === p.id
                return (
                  <button
                    key={p.id}
                    className={chosen ? 'voicecard on' : 'voicecard'}
                    type="button"
                    aria-pressed={chosen}
                    onClick={() => {
                      void update({ voice: p.id })
                      setVoicePersona(p.id)
                      speak(SAMPLE, settings.alertVolume, p.id)
                    }}
                  >
                    <span className="vc-label">{p.label}</span>
                    <span className="vc-voice">
                      {res.voice ? res.voice.name : 'whatever Windows picks'}
                    </span>
                    {!res.exact && <span className="vc-warn">substituted</span>}
                  </button>
                )
              })}
            </div>
            <span className="fhint">
              Click one to hear it. If an accent isn&apos;t available the nearest voice is used and the card
              says so.
            </span>
            {activeNote && <span className="err">{activeNote}</span>}
          </label>

          {/* Windows 11 lists "Natural" voices that Settings and Edge can use
              but that this app's speech engine often cannot enumerate. Showing
              the real list is the only way to tell "not installed" apart from
              "installed but invisible to me". */}
          <details className="field voicelist">
            <summary>
              Voices this app can see <span className="muted">({voices.length})</span>
            </summary>
            <div className="vl-body">
              {voices.length === 0 && <span className="muted">None yet — the list can take a moment.</span>}
              {voices.map((v) => (
                <div className="vl-row" key={`${v.name}-${v.lang}`}>
                  <button className="vl-play" type="button" onClick={() => speakWithVoice(SAMPLE, v.name, settings.alertVolume)}>
                    ▸
                  </button>
                  <span className="vl-name">{v.name}</span>
                  <span className="vl-lang mono">{v.lang}</span>
                  <span className="vl-gender">{genderOf(v.name) ?? '—'}</span>
                </div>
              ))}
              <p className="fhint" style={{ marginTop: 'var(--s-2)' }}>
                Windows 11 also ships &ldquo;Natural&rdquo; voices that Settings and Edge can use but that this
                app&apos;s speech engine may not expose. If one you expect is missing here, that&apos;s why —
                installing more under <code>Settings › Time &amp; language › Speech</code> only helps if they
                register as classic system voices.
              </p>
            </div>
          </details>

          <label className="field">
            <span className="flabel">Alert volume</span>
            <div className="row">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={settings.alertVolume}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  void update({ alertVolume: v })
                  setAlertVolume(v)
                }}
                style={{ width: '12rem' }}
              />
              <span className="muted num">{Math.round(settings.alertVolume * 100)}%</span>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  playAlert('chime', settings.alertVolume)
                  speak(SAMPLE, settings.alertVolume, settings.voice)
                }}
              >
                Test
              </button>
            </div>
          </label>
        </div>
      </section>

      <section className="panel">
        <div className="phead">
          <span className="t">PTDex</span>
        </div>
        <div className="pbody form">
          <label className="field">
            <span className="flabel">Site address</span>
            <input
              type="text"
              value={settings.ptdexBase}
              placeholder="https://…"
              onChange={(e) => void update({ ptdexBase: e.target.value.trim() })}
            />
            <span className="fhint">
              Optional. Fills item and spell tooltips from the website. Leave blank and the app runs entirely
              on its bundled data.
            </span>
          </label>
        </div>
      </section>
    </div>
  )
}

/**
 * Rebuild the lifetime ledgers from every log on disk.
 *
 * The app only counts what it sees while running, so a folder with a year of
 * history in it starts at zero. This reads the lot.
 *
 * Guarded behind a confirm because it CLEARS the ledgers first - which is what
 * makes it safe to run twice, but is also the only destructive button in the
 * app. Nothing it clears is irreplaceable: every figure it holds was derived
 * from these same logs and is about to be derived again.
 */
function RebuildHistory(): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [result, setResult] = useState<HistoryResult | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  return (
    <div>
      <div className="row">
        <button
          className={confirm ? 'btn danger' : 'btn'}
          type="button"
          disabled={busy}
          onClick={() => {
            if (!confirm) {
              setConfirm(true)
              window.setTimeout(() => setConfirm(false), 6000)
              return
            }
            setConfirm(false)
            setBusy(true)
            setFailed(null)
            void window.triune
              .invoke('history:rebuild')
              .then(setResult)
              .catch((e: Error) => setFailed(e.message))
              .finally(() => setBusy(false))
          }}
        >
          {busy ? 'Reading your logs…' : confirm ? 'Clear and rebuild?' : 'Rebuild from logs'}
        </button>
        <span className="muted" style={{ fontSize: '0.78rem' }}>
          Zones, Mobs, Loot and Leveling
        </span>
      </div>

      <p className="fhint">
        Replays every <code>eqlog</code> file in your folder, including characters you no longer play, and
        rebuilds the lifetime totals from them. It clears those totals first, so running it twice gives the
        same answer rather than double the numbers. Combat history and your flags are untouched.
      </p>

      {failed && <p className="err">{failed}</p>}

      {result && !busy && (
        <p className="fhint">
          Read {result.lines.toLocaleString()} lines from {result.files} log
          {result.files === 1 ? '' : 's'} across {result.sessions} play session
          {result.sessions === 1 ? '' : 's'}
          {result.from ? `, back to ${new Date(result.from).toLocaleDateString()}` : ''}.
          {result.truncated.length > 0 &&
            ` The oldest lines were skipped for ${result.truncated.join(', ')} — those logs are very large.`}
        </p>
      )}
    </div>
  )
}
