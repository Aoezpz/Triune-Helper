import { useEffect, useMemo, useState } from 'react'
import {
  isManualStep,
  stepKey,
  type ProgChapter,
  type ProgressionData,
  type ProgressState,
  type ProgressSummary
} from '@shared/progression'
import { Aurora, Starfield } from '../components/Ambient'

/**
 * Flagging, live.
 *
 * The structure comes from PTDex; the state is the app's own and updates the
 * moment a gate boss dies in your log. Steps that no log line announces - the
 * "go and say this to that NPC" ones - are ticked by hand and labelled as
 * such, because a tracker that silently guesses is worse than one that admits
 * what it cannot see.
 */
export function Progression(): JSX.Element {
  const [data, setData] = useState<ProgressionData | null>(null)
  const [state, setState] = useState<ProgressState>({})
  const [summary, setSummary] = useState<ProgressSummary | null>(null)
  const [onlyRemaining, setOnlyRemaining] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [justFlagged, setJustFlagged] = useState<string[]>([])
  const [confirmReset, setConfirmReset] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncNote, setSyncNote] = useState<string | null>(null)

  useEffect(() => {
    void window.triune.invoke('progress:get').then((r) => {
      setData(r.data)
      setState(r.state)
      setSummary(r.summary)
      // Open the first chapter that still has work in it.
      const first = r.summary.sections
        .flatMap((s) => s.chapters)
        .find((c) => c.earned < c.total)
      setOpen(first?.id ?? null)
    })

    return window.triune.on('progress:flagged', (p) => {
      setSummary(p.summary)
      setState(p.state)
      setJustFlagged(p.keys)
    })
  }, [])

  const toggle = async (key: string, earned: boolean): Promise<void> => {
    const next = await window.triune.invoke('progress:set', { key, earned })
    setSummary(next)
    setState((prev) => {
      const copy = { ...prev }
      if (earned) copy[key] = { at: Date.now(), source: 'manual' }
      else delete copy[key]
      return copy
    })
  }

  const pct = summary && summary.total > 0 ? Math.round((summary.earned / summary.total) * 100) : 0

  const chapterById = useMemo(() => {
    const map = new Map<string, ProgChapter>()
    for (const s of data?.sections ?? []) for (const c of s.chapters) map.set(c.id, c)
    return map
  }, [data])

  if (!data || !summary) {
    return (
      <div className="page">
        <div className="empty">Loading progression…</div>
      </div>
    )
  }

  return (
    <div className="page prog">
      {/* ---- headline ---- */}
      <header className="prog-hero">
        <Aurora />
        <Starfield count={30} seed={5} />
        <div className="ph-in">
          <div className="ph-dial" role="img" aria-label={`${pct} percent complete`}>
            <svg viewBox="0 0 120 120">
              <circle className="track" cx="60" cy="60" r="52" />
              <circle
                className="fill"
                cx="60"
                cy="60"
                r="52"
                style={{ strokeDasharray: `${(pct / 100) * 326.7} 326.7` }}
              />
            </svg>
            <div className="ph-num">
              <b>{pct}</b>
              <span>%</span>
            </div>
          </div>

          <div className="ph-copy">
            <p className="eyebrow">planar ascension</p>
            <h1>The Road</h1>
            <p className="lede">Expansion gates and the Plane of Time, tracked from your logs as you earn them.</p>
            <div className="ph-tally">
              {summary.sections.map((s) => (
                <div className="t" key={s.id}>
                  <span className="n num">
                    {s.earned}
                    <i>/{s.total}</i>
                  </span>
                  <span className="l">{s.name.replace(/^The /, '')}</span>
                </div>
              ))}
              <div className="t">
                <span className="n num">{summary.total - summary.earned}</span>
                <span className="l">Remaining</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ---- what's next ---- */}
      {summary.next.length > 0 && (
        <section className="panel prog-next">
          <div className="phead">
            <span className="t">Next up</span>
            <span className="spacer" />
            <label className="toggle">
              <input
                type="checkbox"
                checked={onlyRemaining}
                onChange={(e) => setOnlyRemaining(e.target.checked)}
              />
              only remaining
            </label>
            <button
              className="btn primary"
              type="button"
              style={{ height: '1.5rem', fontSize: '0.7rem' }}
              disabled={syncing}
              title="Read flags and levels for your characters from PTDex"
              onClick={() => {
                setSyncing(true)
                setSyncNote(null)
                void window.triune
                  .invoke('ptdex:sync')
                  .then((r) => {
                    if (r.summary) setSummary(r.summary)
                    if (r.state) setState(r.state)
                    const ok = r.characters.filter((c) => c.found)
                    const bad = r.characters.filter((c) => !c.found)
                    const unknown = r.characters.flatMap((c) => c.unknownSteps)
                    setSyncNote(
                      [
                        ok.length > 0
                          ? `Synced ${ok.map((c) => `${c.name}${c.level ? ` (${c.level})` : ''}`).join(', ')}.`
                          : null,
                        bad.length > 0
                          ? `Couldn't sync ${bad.map((c) => `${c.name} — ${c.error ?? 'not found'}`).join('; ')}`
                          : null,
                        unknown.length > 0
                          ? `${unknown.length} step(s) on the site aren't in the bundled data: ${unknown.slice(0, 3).join(', ')}${unknown.length > 3 ? '…' : ''}`
                          : null
                      ]
                        .filter(Boolean)
                        .join(' ')
                    )
                  })
                  .finally(() => setSyncing(false))
              }}
            >
              {syncing ? 'Syncing…' : 'Sync from PTDex'}
            </button>
            <button
              className={confirmReset ? 'btn danger' : 'btn'}
              type="button"
              style={{ height: '1.5rem', fontSize: '0.7rem' }}
              title="Clear every flag — use this if progress was recorded from the wrong Logs folder"
              onClick={() => {
                if (!confirmReset) {
                  setConfirmReset(true)
                  window.setTimeout(() => setConfirmReset(false), 5000)
                  return
                }
                setConfirmReset(false)
                void window.triune.invoke('progress:reset').then((s) => {
                  setSummary(s)
                  setState({})
                })
              }}
            >
              {confirmReset ? 'Clear everything?' : 'Reset'}
            </button>
          </div>
          <div className="pbody">
            {syncNote && (
              <p className="fhint" style={{ marginTop: 0 }}>
                {syncNote}
              </p>
            )}
            <div className="nextlist">
              {summary.next.map((n) => (
                <div className="nx" key={n.key}>
                  <span className="nx-mark" aria-hidden="true" />
                  <span className="nx-name">{n.step.name}</span>
                  <span className="nx-where">
                    {n.plane ?? n.step.zone ?? ''}
                    {n.step.level ? ` · lvl ${n.step.level}` : ''}
                  </span>
                  <span className="nx-ch">{n.chapter}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ---- the climb ---- */}
      {summary.sections.map((sec) => (
        <section key={sec.id} className="prog-sec">
          <div className="prog-seghead">
            <span className="sn">{sec.name}</span>
            <span className="sd">{data.sections.find((s) => s.id === sec.id)?.detail}</span>
            <span className="spacer" />
            <span className="sc num">
              {sec.earned}/{sec.total}
            </span>
          </div>

          {sec.chapters.map((chSum) => {
            const ch = chapterById.get(chSum.id)
            if (!ch) return null
            const done = chSum.earned === chSum.total
            if (onlyRemaining && done) return null
            const isOpen = open === ch.id

            return (
              <article className={`prog-ch${done ? ' done' : ''}${isOpen ? ' open' : ''}`} key={ch.id}>
                <button className="pc-head" type="button" onClick={() => setOpen(isOpen ? null : ch.id)}>
                  <span className="pc-node">{done ? '✓' : chSum.earned}</span>
                  <span className="pc-title">
                    {ch.title}
                    {ch.era && <em>{ch.era}</em>}
                    {ch.blurb && <small>{ch.blurb}</small>}
                  </span>
                  <span className="pc-count num">
                    {chSum.earned}/{chSum.total}
                  </span>
                  <span className="pc-mini">
                    <i style={{ width: `${chSum.total ? (chSum.earned / chSum.total) * 100 : 0}%` }} />
                  </span>
                </button>

                {isOpen && (
                  <div className="pc-body">
                    {ch.groups.map((g) => (
                      <div className="pc-grp" key={`${ch.id}-${g.plane ?? 'x'}`}>
                        {g.plane && (
                          <div className="pc-gh">
                            <span className="gn">{g.plane}</span>
                            {g.planeShort && <span className="gz">{g.planeShort}</span>}
                          </div>
                        )}
                        {g.steps.map((step) => {
                          const key = stepKey(ch.id, step)
                          const mark = state[key]
                          const earned = !!mark
                          if (onlyRemaining && earned) return null
                          const manual = isManualStep(step)

                          return (
                            <div
                              className={`pc-st${earned ? ' on' : ''}${justFlagged.includes(key) ? ' fresh' : ''}`}
                              key={key}
                            >
                              <button
                                className="pc-tick"
                                type="button"
                                aria-pressed={earned}
                                title={
                                  earned
                                    ? `Earned ${mark.source === 'log' ? 'from your log' : 'by hand'}${
                                        mark.by ? ` (${mark.by})` : ''
                                      } — click to clear`
                                    : 'Mark as earned'
                                }
                                onClick={() => void toggle(key, !earned)}
                              >
                                {earned ? '✓' : ''}
                              </button>
                              <div className="pc-tx">
                                <div className="pc-nm">
                                  {step.name}
                                  {step.badge && <span className="stage">{step.badge}</span>}
                                  {manual && !earned && (
                                    <span className="byhand" title="No log line announces this one">
                                      by hand
                                    </span>
                                  )}
                                </div>
                                {step.how && <div className="pc-how">{step.how}</div>}
                                {(step.zone || step.level) && (
                                  <div className="pc-where">
                                    {step.zone}
                                    {step.level ? <span className="lv">lvl {step.level}</span> : null}
                                    {step.zoneShort ? <span className="sh">{step.zoneShort}</span> : null}
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ))}
                    {ch.opens && <div className="pc-opens">⚑ {ch.opens}</div>}
                  </div>
                )}
              </article>
            )
          })}
        </section>
      ))}
    </div>
  )
}
