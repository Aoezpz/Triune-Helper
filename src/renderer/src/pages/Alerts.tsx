import { useCallback, useEffect, useState } from 'react'
import {
  exportRules,
  importRules,
  newRule,
  starterRules,
  type AlertRule,
  type AlertScope,
  type AlertSound
} from '@shared/alerts'
import { getAlertVolume, setAlertVolume, useAlertHistory } from '../alerts/sink'
import { playAlert, speak } from '../alerts/sound'

/**
 * Trigger rules.
 *
 * Rules are matched in main against the merged stream; this page edits them
 * and shows what has fired. The noise itself is made by the sink installed at
 * the app root, so alerts sound whatever page you are looking at - which is
 * the whole point, since you are usually looking at the game.
 */

const SOUNDS: AlertSound[] = ['none', 'chime', 'alarm', 'thud', 'sweep']
const SCOPES: Array<{ id: AlertScope; label: string; hint: string }> = [
  { id: 'all', label: 'Every line', hint: 'Anything written to the log.' },
  { id: 'combat', label: 'Combat only', hint: 'Hits, heals, deaths - skips chat and emotes.' },
  { id: 'chat', label: 'Chat & emotes', hint: 'Everything the combat parser has no rule for.' }
]

export function Alerts(): JSX.Element {
  const [rules, setRules] = useState<AlertRule[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [sample, setSample] = useState('')
  const [test, setTest] = useState<{ matched: boolean; groups: string[]; speech: string | null } | null>(null)
  const [shareText, setShareText] = useState('')
  const [shareNote, setShareNote] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [volume, setVolumeState] = useState(getAlertVolume())
  const recent = useAlertHistory()

  // Volume is a setting, not page state, so it survives a restart and matches
  // the slider in Preferences.
  const setVolume = (v: number): void => {
    setVolumeState(v)
    setAlertVolume(v)
    void window.triune.invoke('settings:set', { alertVolume: v })
  }

  useEffect(() => {
    void window.triune.invoke('settings:get').then((s) => {
      setVolumeState(s.alertVolume)
      setAlertVolume(s.alertVolume)
    })
  }, [])

  useEffect(() => {
    void window.triune.invoke('alerts:list').then((r) => {
      setRules(r)
      setSelected(r[0]?.id ?? null)
    })
  }, [])

  const persist = useCallback(async (next: AlertRule[]) => {
    setRules(await window.triune.invoke('alerts:save', next))
  }, [])

  const rule = rules.find((r) => r.id === selected) ?? null

  const patch = (changes: Partial<AlertRule>): void => {
    if (!rule) return
    void persist(rules.map((r) => (r.id === rule.id ? { ...r, ...changes } : r)))
  }

  const runTest = useCallback(async () => {
    if (!rule) return
    setTest(await window.triune.invoke('alerts:test', { rule, sample }))
  }, [rule, sample])

  useEffect(() => {
    if (rule && sample) void runTest()
    else setTest(null)
  }, [rule, sample, runTest])

  const add = (): void => {
    const created = newRule()
    void persist([...rules, created])
    setSelected(created.id)
  }

  /**
   * Two-step delete. A rule can represent real work - a regex someone tuned,
   * or one a guildmate shared - and a single stray click destroying it with no
   * undo is the wrong trade. The first click arms; the second confirms; five
   * seconds of inaction disarms.
   */
  const remove = (id: string): void => {
    if (confirmDelete !== id) {
      setConfirmDelete(id)
      window.setTimeout(() => setConfirmDelete((cur) => (cur === id ? null : cur)), 5000)
      return
    }
    setConfirmDelete(null)
    void persist(rules.filter((r) => r.id !== id))
    if (selected === id) setSelected(null)
  }

  const restoreStarters = async (): Promise<void> => {
    const existing = new Set(rules.map((r) => r.name))
    const missing = starterRules().filter((r) => !existing.has(r.name))
    if (missing.length === 0) {
      setShareNote('All the starter rules are already here.')
      return
    }
    await persist([...rules, ...missing])
    setShareNote(`Restored ${missing.length} starter rule${missing.length === 1 ? '' : 's'}.`)
  }

  const doExport = (): void => {
    if (!rule) return
    setShareText(exportRules([rule]))
    setShareNote('Copied string is below — paste it into Discord.')
  }

  const doImport = (): void => {
    try {
      const imported = importRules(shareText)
      void persist([...rules, ...imported])
      setSelected(imported[0]?.id ?? null)
      setShareNote(`Imported ${imported.length} rule${imported.length === 1 ? '' : 's'}.`)
    } catch (err) {
      setShareNote((err as Error).message)
    }
  }

  return (
    <div className="page alerts">
      <div className="page-head">
        <h1>Alerts</h1>
        <span className="spacer" />
        <label className="toggle" title="Alert volume">
          <span className="muted">volume</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            style={{ width: '6rem' }}
          />
        </label>
        <button className="btn" type="button" onClick={() => playAlert('chime', volume)}>
          Test sound
        </button>
        <button className="btn primary" type="button" onClick={add}>
          New rule
        </button>
        <p className="lede">
          Rules run against the merged log, so a line all three of your boxes wrote fires once — and they
          sound whichever page you&apos;re on.
        </p>
      </div>

      <div className="al-cols">
        {/* ---- rule list ---- */}
        <section className="panel al-list">
          <div className="phead">
            <span className="t">Rules</span>
            <span className="spacer" />
            <button
              className="btn"
              type="button"
              style={{ height: '1.5rem', fontSize: '0.7rem' }}
              title="Add back any starter rules you've deleted"
              onClick={() => void restoreStarters()}
            >
              Restore starters
            </button>
            <span className="meta">{rules.filter((r) => r.enabled).length} on</span>
          </div>
          <div className="pbody">
            {rules.length === 0 && <div className="empty">No rules yet.</div>}
            {rules.map((r) => (
              <div className={r.id === selected ? 'al-item sel' : 'al-item'} key={r.id}>
                <input
                  type="checkbox"
                  checked={r.enabled}
                  aria-label={`${r.name} enabled`}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => void persist(rules.map((x) => (x.id === r.id ? { ...x, enabled: e.target.checked } : x)))}
                />
                <button className="al-pick" type="button" onClick={() => setSelected(r.id)}>
                  <span className="al-name">{r.name}</span>
                  <span className="al-sub">
                    {r.match.kind === 'regex' ? 'regex' : 'text'} · {r.sound}
                    {r.speak ? ' · speaks' : ''}
                  </span>
                </button>
                <button
                  className={confirmDelete === r.id ? 'al-del arm' : 'al-del'}
                  type="button"
                  title={confirmDelete === r.id ? 'Click again to delete' : 'Delete rule'}
                  onClick={() => remove(r.id)}
                >
                  {confirmDelete === r.id ? 'Delete?' : '✕'}
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* ---- editor ---- */}
        <section className="panel al-edit">
          <div className="phead">
            <span className="t">{rule ? 'Rule' : 'Nothing selected'}</span>
            <span className="spacer" />
            {rule && (
              <button className="btn" type="button" onClick={doExport}>
                Share
              </button>
            )}
          </div>
          <div className="pbody form">
            {!rule && <div className="empty">Pick a rule, or make a new one.</div>}

            {rule && (
              <>
                <label className="field">
                  <span className="flabel">Name</span>
                  <input type="text" value={rule.name} onChange={(e) => patch({ name: e.target.value })} />
                </label>

                <label className="field">
                  <span className="flabel">Match</span>
                  <div className="row">
                    <div className="seg">
                      {(['contains', 'regex'] as const).map((k) => (
                        <button
                          key={k}
                          type="button"
                          aria-pressed={rule.match.kind === k}
                          onClick={() => patch({ match: { ...rule.match, kind: k } })}
                        >
                          {k === 'contains' ? 'Text' : 'Regex'}
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      className="mono"
                      style={{ flex: 1 }}
                      placeholder={rule.match.kind === 'regex' ? '^(.+) begins to cast' : 'text to look for'}
                      value={rule.match.value}
                      onChange={(e) => patch({ match: { ...rule.match, value: e.target.value } })}
                    />
                    <label className="toggle" title="Match upper and lower case exactly">
                      <input
                        type="checkbox"
                        checked={rule.match.caseSensitive}
                        onChange={(e) => patch({ match: { ...rule.match, caseSensitive: e.target.checked } })}
                      />
                      Aa
                    </label>
                  </div>
                  <span className="fhint">
                    Regex captures become <code>$1</code>…<code>$9</code> in the spoken text.
                  </span>
                </label>

                <label className="field">
                  <span className="flabel">Test against a line</span>
                  <input
                    type="text"
                    className="mono"
                    placeholder="Paste a log line here"
                    value={sample}
                    onChange={(e) => setSample(e.target.value)}
                  />
                  {test && (
                    <span className={test.matched ? 'al-hit' : 'al-miss'}>
                      {test.matched ? '✓ matches' : '✕ no match'}
                      {test.matched && test.groups.length > 0 && (
                        <span className="muted"> · captures: {test.groups.map((g, i) => `$${i + 1}=${g}`).join(', ')}</span>
                      )}
                      {test.speech && <span className="muted"> · says “{test.speech}”</span>}
                    </span>
                  )}
                </label>

                <label className="field">
                  <span className="flabel">Scope</span>
                  <div className="seg">
                    {SCOPES.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        aria-pressed={rule.scope === s.id}
                        onClick={() => patch({ scope: s.id })}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <span className="fhint">{SCOPES.find((s) => s.id === rule.scope)?.hint}</span>
                </label>

                <label className="field">
                  <span className="flabel">Sound</span>
                  <div className="row">
                    <div className="seg">
                      {SOUNDS.map((s) => (
                        <button key={s} type="button" aria-pressed={rule.sound === s} onClick={() => patch({ sound: s })}>
                          {s}
                        </button>
                      ))}
                    </div>
                    <button className="btn" type="button" onClick={() => playAlert(rule.sound, volume)}>
                      Play
                    </button>
                  </div>
                </label>

                <label className="field">
                  <span className="flabel">Say out loud</span>
                  <div className="row">
                    <input
                      type="text"
                      style={{ flex: 1 }}
                      placeholder="Leave blank for no speech"
                      value={rule.speak ?? ''}
                      onChange={(e) => patch({ speak: e.target.value || null })}
                    />
                    <button
                      className="btn"
                      type="button"
                      disabled={!rule.speak}
                      onClick={() => rule.speak && speak(rule.speak, volume)}
                    >
                      Say
                    </button>
                  </div>
                </label>

                <label className="field">
                  <span className="flabel">Don&apos;t repeat within</span>
                  <div className="row">
                    <input
                      type="number"
                      min={0}
                      step={500}
                      value={rule.debounceMs}
                      style={{ width: '6rem' }}
                      onChange={(e) => patch({ debounceMs: Math.max(0, Number(e.target.value)) })}
                    />
                    <span className="muted">ms — stops a DoT tick becoming a machine gun</span>
                  </div>
                </label>
              </>
            )}

            <label className="field">
              <span className="flabel">Share string</span>
              <div className="row">
                <input
                  type="text"
                  className="mono"
                  style={{ flex: 1 }}
                  placeholder="TRIA1:…"
                  value={shareText}
                  onChange={(e) => setShareText(e.target.value)}
                />
                <button className="btn" type="button" disabled={!shareText} onClick={doImport}>
                  Import
                </button>
              </div>
              {shareNote && <span className="fhint">{shareNote}</span>}
            </label>
          </div>
        </section>

        {/* ---- what has fired ---- */}
        <section className="panel al-recent">
          <div className="phead">
            <span className="t">Fired</span>
            <span className="meta">{recent.length}</span>
          </div>
          <div className="pbody">
            {recent.length === 0 && <div className="empty">Nothing has triggered yet.</div>}
            {recent.map((hit, i) => (
              <div className="al-fire" key={`${hit.ts}-${i}`}>
                <span className="al-fname">{hit.rule.name}</span>
                <span className="al-fline mono">{hit.raw}</span>
                <span className="al-ftime">
                  {new Date(hit.ts).toLocaleTimeString([], { hour12: false })}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
