import { useCallback, useEffect, useMemo, useState } from 'react'
import { coinSession, formatCoin, summarizeLoot, toPlatinum, type LootData } from '@shared/loot'
import { clock } from '@shared/stats'
import { Aurora, Starfield } from '../components/Ambient'
import { Tipped } from '../components/Tip'

/**
 * Loot.
 *
 * Two income streams that nothing else adds up: coin off corpses, and the
 * server's auto-sell. The second is the bigger one by a distance and it names
 * the item, so this doubles as the only running record of what a night's
 * killing actually produced.
 *
 * The discoveries at the bottom are a different thing on purpose - they are a
 * server-wide broadcast about everybody, not your loot. Said plainly, because
 * a list of items you never saw, presented as yours, would be a lie told by
 * layout.
 */
export function Loot(): JSX.Element {
  const [data, setData] = useState<LootData>({ coin: [], discoveries: [] })
  const [confirmReset, setConfirmReset] = useState(false)
  const [scope, setScope] = useState<'session' | 'all'>('session')

  const load = useCallback(async () => {
    setData(await window.triune.invoke('loot:get'))
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), 5000)
    return () => clearInterval(timer)
  }, [load])

  const session = useMemo(() => coinSession(data.coin), [data.coin])
  const s = useMemo(
    () => summarizeLoot(data, scope === 'session' ? session : null),
    [data, scope, session]
  )
  const anything = data.coin.length + data.discoveries.length > 0
  const recent = useMemo(() => [...data.discoveries].reverse().slice(0, 40), [data.discoveries])

  return (
    <div className="page loot">
      <header className="loot-hero">
        <Aurora />
        <Starfield count={26} seed={11} />
        <div className="lh-in">
          <div className="lh-copy">
            <p className="eyebrow">the takings</p>
            <h1>Loot</h1>
            <p className="lede">
              Coin off corpses and everything the server sold for you, counted from your logs.
            </p>
            <div className="seg" style={{ marginTop: 'var(--s-3)' }}>
              <button
                type="button"
                aria-pressed={scope === 'session'}
                disabled={!session}
                onClick={() => setScope('session')}
                title="Activity with no gap longer than 30 minutes"
              >
                This session
              </button>
              <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
                All time
              </button>
            </div>
          </div>

          <div className="lh-total">
            <span className="n">{formatCoin(s.total)}</span>
            <span className="l">
              {s.perHour !== null
                ? `${toPlatinum(s.perHour).toFixed(1)} plat / hour over ${clock(s.observedSeconds)}`
                : 'not enough time yet for a rate'}
            </span>
          </div>
        </div>
      </header>

      {!anything && (
        <section className="panel">
          <div className="empty">
            <Starfield count={24} seed={7} />
            <h2>Nothing banked yet</h2>
            <p>
              Coin and auto-sales appear here as you kill things. Nothing is backfilled from before the app
              was running.
            </p>
          </div>
        </section>
      )}

      {anything && (
        <>
          <div className="loot-splits">
            <Split label="From corpses" copper={s.fromKills} total={s.total} tone="var(--slot-1)" />
            <Split label="Auto-sold" copper={s.fromSales} total={s.total} tone="var(--gold)" />
            <div className="lsplit">
              <span className="l">Items sold</span>
              <span className="v num">{s.sold.reduce((n, r) => n + r.count, 0).toLocaleString()}</span>
              <span className="sub">{s.sold.length} distinct</span>
            </div>
            <div className="lsplit">
              <span className="l">Coin drops</span>
              <span className="v num">{s.coin.filter((c) => !c.item).length.toLocaleString()}</span>
              <span className="sub">corpses that paid</span>
            </div>
          </div>

          {(s.byZone.length > 0 || s.unzoned > 0) && (
            <section className="panel">
              <div className="phead">
                <span className="t">Where it came from</span>
                <span className="meta">income by zone</span>
              </div>
              <div className="pbody">
                <div className="soldlist">
                  {s.byZone.map((z) => {
                    const share = s.total > 0 ? (z.copper / s.total) * 100 : 0
                    return (
                      <div className="sold" key={z.zone}>
                        <span className="s-bar" style={{ width: `${Math.max(1, share)}%` }} aria-hidden="true" />
                        <span className="s-name">{z.zone}</span>
                        <span className="s-count num">×{z.events}</span>
                        <span className="s-coin num">{formatCoin(z.copper)}</span>
                      </div>
                    )
                  })}
                </div>
                {s.unzoned > 0 && (
                  <p className="fhint" style={{ marginBottom: 0 }}>
                    {formatCoin(s.unzoned)} was banked before the app saw you zone, so it has no zone
                    against it. That figure shrinks to nothing once you zone again.
                  </p>
                )}
              </div>
            </section>
          )}

          <section className="panel">
            <div className="phead">
              <span className="t">What sold</span>
              <span className="meta">ranked by what it earned</span>
              <span className="spacer" />
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
                  void window.triune.invoke('loot:reset').then(setData)
                }}
              >
                {confirmReset ? 'Clear everything?' : 'Clear'}
              </button>
            </div>
            <div className="pbody">
              {s.sold.length === 0 ? (
                <div className="empty">Nothing has been auto-sold yet.</div>
              ) : (
                <div className="soldlist">
                  {s.sold.slice(0, 30).map((row) => {
                    const share = s.fromSales > 0 ? (row.copper / s.fromSales) * 100 : 0
                    return (
                      <div className="sold" key={row.item}>
                        <span className="s-bar" style={{ width: `${Math.max(1, share)}%` }} aria-hidden="true" />
                        <span className="s-name">
                          <Tipped kind="item" name={row.item} />
                        </span>
                        <span className="s-count num">×{row.count}</span>
                        <span className="s-coin num">{formatCoin(row.copper)}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="phead">
              <span className="t">Discovered on the server</span>
              <span className="meta">everyone&apos;s finds, not yours — hover for stats</span>
            </div>
            <div className="pbody">
              {recent.length === 0 ? (
                <div className="empty">No discovery announcements seen yet.</div>
              ) : (
                <div className="disclist">
                  {recent.map((d, i) => (
                    <div className="disc" key={`${d.at}-${d.item}-${i}`}>
                      <span className="d-when">
                        {new Date(d.at).toLocaleTimeString([], { hour12: false })}
                      </span>
                      <span className="d-who">{d.who}</span>
                      <span className="d-item">
                        <Tipped kind="item" name={d.item} />
                      </span>
                      {d.tier && <span className={`d-tier t-${d.tier.toLowerCase()}`}>{d.tier}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function Split({
  label,
  copper,
  total,
  tone
}: {
  label: string
  copper: number
  total: number
  tone: string
}): JSX.Element {
  const share = total > 0 ? (copper / total) * 100 : 0
  return (
    <div className="lsplit">
      <span className="l">{label}</span>
      <span className="v num">{formatCoin(copper)}</span>
      <span className="sub">{share.toFixed(0)}% of the total</span>
      <span className="lsplit-bar">
        <i style={{ width: `${share}%`, background: tone }} />
      </span>
    </div>
  )
}
