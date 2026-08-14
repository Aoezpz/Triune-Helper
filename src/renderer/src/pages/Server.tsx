import { useCallback, useEffect, useMemo, useState } from 'react'
import { censusRows, blessingRows, type ServerData } from '@shared/server'
import { countdown, duration } from '@shared/timers'
import { Aurora, Starfield } from '../components/Ambient'
import { Tipped } from '../components/Tip'

/**
 * The world outside your group.
 *
 * One caveat governs the whole page and is printed on it rather than buried
 * here: everything below was heard on a broadcast channel while you were
 * logged in. It is a sample of the server taken during your play, never a
 * total, and the page says so where somebody might otherwise read a count as
 * a population.
 */
export function Server(): JSX.Element {
  const [data, setData] = useState<ServerData>({
    blessings: [],
    census: {},
    offers: [],
    bazaar: null,
    appliedAt: null
  })
  const [now, setNow] = useState(() => Date.now())
  const [confirmReset, setConfirmReset] = useState(false)

  const load = useCallback(async () => {
    setData(await window.triune.invoke('server:get'))
  }, [])

  useEffect(() => {
    void load()
    const poll = window.setInterval(() => void load(), 5000)
    const beat = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      window.clearInterval(poll)
      window.clearInterval(beat)
    }
  }, [load])

  const blessings = useMemo(() => blessingRows(data.blessings, now), [data.blessings, now])
  const census = useMemo(() => censusRows(data.census), [data.census])
  const live = blessings.filter((b) => b.active).length

  return (
    <div className="page zones">
      <header className="loot-hero">
        <Aurora />
        <Starfield count={26} seed={41} />
        <div className="lh-in">
          <div className="lh-copy">
            <p className="eyebrow">what the world is doing</p>
            <h1>Server</h1>
            <p className="lede">
              World blessings, who is arriving and levelling, and what is being auctioned — everything the
              server broadcast while you were logged in.
            </p>
          </div>
          <div className="lh-total">
            <span className="n">{live}</span>
            <span className="l">
              blessing{live === 1 ? '' : 's'} running
              {census.players.length > 0 ? ` · ${census.players.length} players seen` : ''}
            </span>
          </div>
        </div>
      </header>

      {/* ---- Blessings ---- */}
      <section className="panel">
        <div className="phead">
          <span className="t">World blessings</span>
          <span className="meta">stated by the server, counted down here</span>
        </div>
        <div className="pbody">
          {/* The one thing you can be certain of, so it sits above the table:
              the game said this about you directly, where every row below is
              assembled from a broadcast that may predate the app. */}
          {data.appliedAt !== null && (
            <div className="applied">
              <span className="a-dot" aria-hidden="true" />
              World buffs were applied to you <b>{duration(now - data.appliedAt)} ago</b>
              <span className="dim"> · {new Date(data.appliedAt).toLocaleTimeString()}</span>
            </div>
          )}

          {blessings.length === 0 ? (
            <p className="fhint" style={{ marginBottom: 0 }}>
              No blessing announcement has been read yet. Taking the buffs yourself does not produce one —
              the line that carries a name and a duration is a separate broadcast that only fires when
              somebody <em>activates or extends</em> a blessing, which may have been hours before you
              logged in. The app now reads back through the log on startup looking for those, so this
              usually fills in on the next launch.
            </p>
          ) : (
            <div className="ztable">
              <div className="zrow zhead brow">
                <span className="z-name">Blessing</span>
                <span className="z-n">Remaining</span>
                <span className="z-n">Ends</span>
                <span className="z-n">Heard</span>
              </div>
              {blessings.map((b) => (
                <div className={b.active ? 'zrow brow up' : 'zrow brow'} key={b.name}>
                  <span
                    className="z-bar"
                    style={{ width: `${Math.min(100, (b.remainingMs / Math.max(1, b.statedMs)) * 100)}%` }}
                    aria-hidden="true"
                  />
                  <span className="z-name">{b.name}</span>
                  <span className={b.active ? 'z-n num good' : 'z-n num dim'}>
                    {b.active ? countdown(b.remainingMs) : 'expired'}
                  </span>
                  <span className="z-n num dim">
                    {new Date(b.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="z-n num dim">{duration(now - b.seenAt)} ago</span>
                </div>
              ))}
            </div>
          )}
          <p className="fhint" style={{ marginBottom: 0 }}>
            The server states a remaining duration when a blessing is switched on or extended, and that is
            the only thing it ever says about them — <strong>there is no expiry message</strong>. So a
            blessing that started while you were logged out is invisible here, and one somebody cancelled
            early would still be counting down. Treat a running timer as &ldquo;probably&rdquo;, not
            &ldquo;certainly&rdquo;.
          </p>
        </div>
      </section>

      {/* ---- Census ---- */}
      <section className="panel">
        <div className="phead">
          <span className="t">Who is out there</span>
          <span className="meta">
            {census.players.length} seen · {census.trios.length} trio{census.trios.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="pbody">
          {census.players.length === 0 ? (
            <p className="fhint" style={{ marginBottom: 0 }}>
              Nobody yet. Names arrive when the server announces a first login, a level, or a server-first
              trio.
            </p>
          ) : (
            <>
              <div className="tm-sub">Trio combinations seen</div>
              <div className="triogrid">
                {census.trios.slice(0, 12).map((t) => (
                  <div className="triocard" key={t.trio}>
                    <span className="tc-n num">{t.count}</span>
                    {/* Split on the slashes rather than printing the raw
                        string: "Paladin/Necromancer/Enchanter" contains no
                        space, so nothing can wrap it and it ran straight out
                        of the card. Each class is its own flex item, which
                        gives the line somewhere to break. */}
                    <span className="tc-t">
                      {t.trio.split('/').map((c, i) => (
                        <span className="tc-c" key={`${c}-${i}`}>
                          {i > 0 && <i className="tc-slash">/</i>}
                          {c}
                        </span>
                      ))}
                    </span>
                    {t.firstBy && <span className="tc-first">first: {t.firstBy}</span>}
                  </div>
                ))}
              </div>

              <div className="tm-sub">Most recently heard from</div>
              <div className="ztable">
                {census.players.slice(0, 20).map((p) => (
                  <div className="zrow crow" key={p.name}>
                    <span className="z-name">
                      {p.name}
                      {p.serverFirst && <span className="s-first">server first</span>}
                    </span>
                    {/* Same overflow hazard as the cards above, but a table row
                        cannot grow - so this one truncates and keeps the full
                        string in the tooltip. */}
                    <span className="c-classes" title={p.classes}>
                      {p.classes}
                    </span>
                    <span className="z-n num">{p.level ?? '—'}</span>
                    <span className="z-n num dim">{duration(now - p.lastSeen)} ago</span>
                  </div>
                ))}
              </div>
            </>
          )}
          <p className="fhint" style={{ marginBottom: 0 }}>
            A sample, not a census — only broadcasts made while you were logged in reach this list. The
            first-login message names <em>one</em> class, not the trio; a player&apos;s full trio only
            appears once they level or take a server first, which is why some rows show a single class.
          </p>
        </div>
      </section>

      {/* ---- Market ---- */}
      <section className="panel">
        <div className="phead">
          <span className="t">Auction &amp; trade</span>
          <span className="meta">{data.offers.length} lines kept</span>
        </div>
        <div className="pbody">
          {data.offers.length === 0 ? (
            <p className="fhint" style={{ marginBottom: 0 }}>
              Nothing heard. Lines from <code>/auction</code> and <code>/ooc</code> appear here when they
              mention WTS, WTB, WTT or a tiered item name.
            </p>
          ) : (
            <div className="offers">
              {[...data.offers].reverse().slice(0, 30).map((o, i) => (
                <div className="offer" key={`${o.at}-${i}`}>
                  <span
                    className={`o-tag ${o.intent ?? 'none'}`}
                    title={o.intent === null ? 'No WTS/WTB/WTT in the line — listed for its item names' : undefined}
                  >
                    {o.intent === 'sell' ? 'WTS' : o.intent === 'buy' ? 'WTB' : o.intent === 'trade' ? 'WTT' : 'list'}
                  </span>
                  <span className="o-who">{o.seller}</span>
                  {/* Separated, because run together they read as one absurd
                      item name. Each is a tooltip, which is also the check:
                      a name the extractor merged out of two adjacent items
                      comes back "no item by that name" from PTDex. */}
                  <span className="o-text" title={o.text}>
                    {o.items.length > 0
                      ? o.items.map((it, n) => (
                          <span key={it}>
                            {n > 0 && <span className="o-sep">·</span>}
                            <Tipped
                              kind="item"
                              name={it.replace(/\s*\((?:Legendary|Enchanted|Glamour)\)$/, '')}
                            >
                              <span className="lootname">{it}</span>
                            </Tipped>
                          </span>
                        ))
                      : o.text}
                  </span>
                  <span className="o-when num dim">{duration(now - o.at)} ago</span>
                </div>
              ))}
            </div>
          )}
          <p className="fhint" style={{ marginBottom: 0 }}>
            A chat scraper, not a market index. Item names are only lifted when they carry a tier in
            brackets, and sellers who list several without punctuation between them will have two run into
            one — hover a name to check it against PTDex, which is how you spot those. Most lines carry no
            price at all, <code>list</code> means the line named no WTS/WTB/WTT, and <code>/bazaar</code>{' '}
            trader stock never reaches the log. Hover any row to read the line exactly as it was said.
          </p>
          <div className="row" style={{ marginTop: 'var(--s-3)' }}>
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
                void window.triune.invoke('server:reset').then(setData)
              }}
            >
              {confirmReset ? 'Clear everything?' : 'Clear server history'}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
