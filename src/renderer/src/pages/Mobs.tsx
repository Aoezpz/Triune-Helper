import { useCallback, useEffect, useMemo, useState } from 'react'
import { mobRows, type MobsData } from '@shared/mobs'
import { clock, short } from '@shared/stats'
import { Aurora, Starfield } from '../components/Ambient'

/**
 * Mobs.
 *
 * Zones answers where the evening went; this answers what was in it. Both are
 * lifetime ledgers, kept forever, because "I have killed four hundred of these
 * and they have killed me twice" is a fact about a year rather than about
 * tonight.
 *
 * Recorded one closed fight at a time, since every number worth having here is
 * per-fight: a kill time cannot be derived from a stream of swings.
 */
export function Mobs(): JSX.Element {
  const [data, setData] = useState<MobsData>({ totals: {} })
  const [sortBy, setSortBy] = useState<'kills' | 'time' | 'danger'>('kills')
  const [confirmReset, setConfirmReset] = useState(false)

  const load = useCallback(async () => {
    setData(await window.triune.invoke('mobs:get'))
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), 5000)
    return () => clearInterval(timer)
  }, [load])

  const rows = useMemo(() => {
    const base = mobRows(data.totals)
    if (sortBy === 'time') return [...base].sort((a, b) => b.seconds - a.seconds)
    // Danger is deaths first, then damage taken - the things that actually
    // ruined an evening, in that order.
    if (sortBy === 'danger') {
      return [...base].sort((a, b) => b.deaths - a.deaths || b.damageTaken - a.damageTaken)
    }
    return base
  }, [data, sortBy])

  const totalKills = rows.reduce((n, r) => n + r.kills, 0)
  const totalTime = rows.reduce((n, r) => n + r.seconds, 0)
  const worst = useMemo(
    () => [...rows].sort((a, b) => b.deaths - a.deaths)[0] ?? null,
    [rows]
  )

  return (
    <div className="page zones">
      <header className="loot-hero">
        <Aurora />
        <Starfield count={26} seed={17} />
        <div className="lh-in">
          <div className="lh-copy">
            <p className="eyebrow">everything you have fought</p>
            <h1>Mobs</h1>
            <p className="lede">
              Kills, kill times and damage traded, per mob, kept for as long as you keep the app. Recorded
              when a fight ends, so nothing appears until the first one closes.
            </p>
          </div>
          <div className="lh-total">
            <span className="n">{totalKills.toLocaleString()}</span>
            <span className="l">
              kills across {rows.length} mob{rows.length === 1 ? '' : 's'} · {clock(totalTime)} fighting
              {worst && worst.deaths > 0 ? ` · worst: ${worst.mob}` : ''}
            </span>
          </div>
        </div>
      </header>

      {rows.length === 0 ? (
        <section className="panel">
          <div className="empty">
            <Starfield count={24} seed={13} />
            <h2>Nothing fought yet</h2>
            <p>
              A mob appears here when the fight against it ends — either it dies or combat goes quiet for
              long enough to close the fight.
            </p>
          </div>
        </section>
      ) : (
        <section className="panel">
          <div className="phead">
            <span className="t">The bestiary</span>
            <span className="spacer" />
            <div className="seg">
              {(['kills', 'time', 'danger'] as const).map((k) => (
                <button key={k} type="button" aria-pressed={sortBy === k} onClick={() => setSortBy(k)}>
                  {k === 'kills' ? 'By kills' : k === 'time' ? 'By time' : 'By danger'}
                </button>
              ))}
            </div>
            <button
              className={confirmReset ? 'btn danger' : 'btn'}
              type="button"
              style={{ height: '1.5rem', fontSize: '0.7rem' }}
              onClick={() => {
                if (!confirmReset) {
                  setConfirmReset(true)
                  window.setTimeout(() => setConfirmReset(false), 5000)
                  return
                }
                setConfirmReset(false)
                void window.triune.invoke('mobs:reset').then(setData)
              }}
            >
              {confirmReset ? 'Clear everything?' : 'Clear'}
            </button>
          </div>

          <div className="pbody">
            <div className="ztable">
              <div className="zrow zhead mrow">
                <span className="z-name">Mob</span>
                <span className="z-n">Kills</span>
                <span className="z-n">Avg kill</span>
                <span className="z-n">Fastest</span>
                <span className="z-n">Your dps</span>
                <span className="z-n">Dealt</span>
                <span className="z-n">Taken</span>
                <span className="z-n">Deaths</span>
              </div>

              {rows.map((r) => (
                <div className="zrow mrow" key={r.mob}>
                  <span
                    className="z-bar"
                    style={{ width: `${totalKills > 0 ? (r.kills / totalKills) * 100 : 0}%` }}
                    aria-hidden="true"
                  />
                  <span
                    className="z-name"
                    title={`${r.fights} fight${r.fights === 1 ? '' : 's'}${r.zones.length > 0 ? ` · ${r.zones.join(', ')}` : ''}`}
                  >
                    {r.mob}
                  </span>
                  <span className="z-n num">{r.kills.toLocaleString()}</span>
                  {/* A dash under three kills: one lucky pull is not an average. */}
                  <span className="z-n num dim">
                    {r.averageSeconds !== null ? clock(r.averageSeconds) : '—'}
                  </span>
                  <span className="z-n num">
                    {r.fastestSeconds !== null ? clock(r.fastestSeconds) : '—'}
                  </span>
                  <span className="z-n num dim">{r.dps !== null ? short(r.dps) : '—'}</span>
                  <span className="z-n num">{short(r.damageDone)}</span>
                  <span className="z-n num dim">{short(r.damageTaken)}</span>
                  <span className={r.deaths > 0 ? 'z-n num bad' : 'z-n num dim'}>
                    {r.deaths > 0 ? r.deaths : '—'}
                  </span>
                </div>
              ))}
            </div>
            <p className="fhint" style={{ marginBottom: 0 }}>
              Deaths are counted per fight the mob was in, not per killing blow — the log never says which
              of three things standing on you landed it.
            </p>
          </div>
        </section>
      )}
    </div>
  )
}
