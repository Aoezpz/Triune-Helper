import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatCoin, toPlatinum } from '@shared/loot'
import { clock } from '@shared/stats'
import { lifetimeRows, summarizeZones, totalSeconds, type ZonesData } from '@shared/zones'
import { Aurora, Starfield } from '../components/Ambient'

/**
 * Zones.
 *
 * Where the hours went, and what each of them was worth. Every figure here is
 * a count between two "You have entered ..." lines - the log states every
 * transition even though it never states a position, and a zone is just the
 * gap between two transitions.
 *
 * Ranked by time rather than by income on purpose: the first question is where
 * the evening actually went, and the answer is often not where you would guess.
 * What it paid is the second column, right beside it, so the comparison is
 * unavoidable.
 *
 * There is no map. Triune-Helper reads logs and nothing else, and a log carries
 * no coordinates - so a map here could show the terrain but never you, and a
 * map that cannot show you is a picture.
 */
export function Zones(): JSX.Element {
  const [data, setData] = useState<ZonesData>({ visits: [] })
  const [sortBy, setSortBy] = useState<'time' | 'coin' | 'kills'>('time')
  const [scope, setScope] = useState<'lifetime' | 'recent'>('lifetime')
  const [confirmReset, setConfirmReset] = useState(false)

  const load = useCallback(async () => {
    setData(await window.triune.invoke('zones:get'))
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), 5000)
    return () => clearInterval(timer)
  }, [load])

  const rows = useMemo(() => {
    // Lifetime comes from the ledger, which is never trimmed; recent comes from
    // the capped visit list. They agree until the cap bites, and after that the
    // ledger is the one still telling the truth.
    const base = scope === 'lifetime' ? lifetimeRows(data.totals) : summarizeZones(data)
    if (sortBy === 'coin') return [...base].sort((a, b) => b.copper - a.copper)
    if (sortBy === 'kills') return [...base].sort((a, b) => b.kills - a.kills)
    return base
  }, [data, sortBy, scope])

  const total = useMemo(() => totalSeconds(rows), [rows])
  const totalCoin = rows.reduce((n, r) => n + r.copper, 0)
  const totalKills = rows.reduce((n, r) => n + r.kills, 0)

  return (
    <div className="page zones">
      <header className="loot-hero">
        <Aurora />
        <Starfield count={26} seed={31} />
        <div className="lh-in">
          <div className="lh-copy">
            <p className="eyebrow">where the hours went</p>
            <h1>Zones</h1>
            <p className="lede">
              Time, kills, coin and deaths per zone, counted between one zone line and the next. Lifetime
              totals are kept forever; nothing is backfilled from before the app was running.
            </p>
            <div className="seg" style={{ marginTop: 'var(--s-3)' }}>
              <button
                type="button"
                aria-pressed={scope === 'lifetime'}
                onClick={() => setScope('lifetime')}
                title="Every visit ever recorded, never trimmed"
              >
                Lifetime
              </button>
              <button
                type="button"
                aria-pressed={scope === 'recent'}
                onClick={() => setScope('recent')}
                title="The most recent visits still held in detail"
              >
                Recent
              </button>
            </div>
          </div>
          <div className="lh-total">
            <span className="n">{clock(total)}</span>
            <span className="l">
              across {rows.length} zone{rows.length === 1 ? '' : 's'} · {totalKills.toLocaleString()} kills ·{' '}
              {formatCoin(totalCoin)}
            </span>
          </div>
        </div>
      </header>

      {rows.length === 0 ? (
        <section className="panel">
          <div className="empty">
            <Starfield count={24} seed={9} />
            <h2>No zones recorded yet</h2>
            <p>
              A zone appears here once you enter it with the app running. Zoning is the only thing the log
              reports about where you are, so that first line is what starts the clock.
            </p>
          </div>
        </section>
      ) : (
        <section className="panel">
          <div className="phead">
            <span className="t">Time and takings</span>
            <span className="spacer" />
            <div className="seg">
              {(['time', 'coin', 'kills'] as const).map((k) => (
                <button key={k} type="button" aria-pressed={sortBy === k} onClick={() => setSortBy(k)}>
                  {k === 'time' ? 'By time' : k === 'coin' ? 'By coin' : 'By kills'}
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
                void window.triune.invoke('zones:reset').then(setData)
              }}
            >
              {confirmReset ? 'Clear everything?' : 'Clear'}
            </button>
          </div>

          <div className="pbody">
            <div className="ztable">
              <div className="zrow zhead">
                <span className="z-name">Zone</span>
                <span className="z-n">Time</span>
                <span className="z-n">Kills</span>
                <span className="z-n">Kills/hr</span>
                <span className="z-n">Coin</span>
                <span className="z-n">Plat/hr</span>
                <span className="z-n">Deaths</span>
                <span className="z-n">AA</span>
              </div>

              {rows.map((r) => (
                <div className="zrow" key={r.zone}>
                  <span
                    className="z-bar"
                    style={{ width: `${total > 0 ? (r.seconds / total) * 100 : 0}%` }}
                    aria-hidden="true"
                  />
                  <span className="z-name" title={`${r.visits} visit${r.visits === 1 ? '' : 's'}`}>
                    {r.zone}
                  </span>
                  <span className="z-n num">{clock(r.seconds)}</span>
                  <span className="z-n num">{r.kills.toLocaleString()}</span>
                  {/* A dash rather than a number when the stay was too short to
                      divide by - a rate from a ninety-second stop in the Bazaar
                      would top the table and mean nothing. */}
                  <span className="z-n num dim">
                    {r.killsPerHour !== null ? Math.round(r.killsPerHour).toLocaleString() : '—'}
                  </span>
                  <span className="z-n num">{formatCoin(r.copper)}</span>
                  <span className="z-n num dim">
                    {r.copperPerHour !== null ? toPlatinum(r.copperPerHour).toFixed(1) : '—'}
                  </span>
                  <span className={r.deaths > 0 ? 'z-n num bad' : 'z-n num dim'}>
                    {r.deaths > 0 ? r.deaths : '—'}
                  </span>
                  <span className="z-n num dim">{r.aa > 0 ? r.aa : '—'}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
