import { useCallback, useEffect, useState } from 'react'
import type { LeaderboardResult } from '@shared/leaderboard'
import { Aurora, Starfield } from '../components/Ambient'

/**
 * The raid boards, read from PTDex.
 *
 * Read-only by design: the game server records every ranked clear itself, so
 * there is nothing here for the app to submit and no way for it to disagree
 * with the site. Rows deep-link back to the encounter on PTDex.
 */

const BRACKET_CLASS: Record<string, string> = { Solo: 'b1', Duo: 'b2', Trio: 'b3' }

export function Leaderboards(): JSX.Element {
  const [result, setResult] = useState<LeaderboardResult | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (force = false) => {
    setLoading(true)
    setResult(await window.triune.invoke('leaderboard:get', { force }))
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const open = (url: string): void => void window.triune.invoke('shell:open', url)

  const data = result?.data ?? null

  return (
    <div className="page lb">
      <header className="lb-hero">
        <Aurora />
        <Starfield count={26} seed={9} />
        <div className="lb-hero-in">
          <div>
            <p className="eyebrow">raid.encounters</p>
            <h1>The Race Board</h1>
            <p className="lede">
              Every ranked clear on Project Triune, by boss and group size. Recorded by the server, not by this
              app.
            </p>
          </div>
          <span className="spacer" />
          <div className="lb-actions">
            <button className="btn" type="button" onClick={() => void load(true)} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
            {data && (
              <button className="btn" type="button" onClick={() => open(data.source)}>
                Open on PTDex
              </button>
            )}
          </div>
        </div>

        {data && data.totals.length > 0 && (
          <div className="lb-totals">
            {data.totals.map((t) => (
              <div className="t" key={t.label}>
                <span className="n num">{t.value}</span>
                <span className="l">{t.label}</span>
              </div>
            ))}
          </div>
        )}
      </header>

      {result?.error && (
        <div className="panel">
          <div className="pbody">
            <p className="err" style={{ margin: 0 }}>
              {result.error}
              {result.stale && ' Showing the last copy that loaded.'}
            </p>
          </div>
        </div>
      )}

      {!data && loading && <div className="empty">Reading the boards…</div>}

      {data?.bosses.map((boss) => (
        <section className="lb-boss" key={boss.key} style={{ ['--acc' as string]: boss.accent ?? 'var(--gold)' }}>
          <div className="lbb-head">
            {boss.icon && <span className="lbb-icon">{boss.icon}</span>}
            <div className="lbb-title">
              <h2>{boss.name}</h2>
              {boss.meta && <div className="lbb-meta">{boss.meta}</div>}
            </div>
            <span className="spacer" />
            <button className="btn" type="button" onClick={() => open(boss.url)}>
              All rankings
            </button>
          </div>

          <div className="lbb-cols">
            {boss.boards.map((board) => (
              <div className="lbb-col" key={board.title}>
                <h3>
                  {board.title}
                  {board.note && <em>{board.note}</em>}
                </h3>
                {board.rows.map((row) => (
                  <button
                    className={`lbb-row ${BRACKET_CLASS[row.bracket] ?? ''}`}
                    key={`${board.title}-${row.bracket}-${row.names}`}
                    type="button"
                    disabled={row.encounterId === null}
                    onClick={() =>
                      row.encounterId !== null &&
                      open(`${new URL(data.source).origin}/leaderboard/encounter/${row.encounterId}`)
                    }
                  >
                    <span className="bk">{row.bracket}</span>
                    <span className="who">
                      <span className="nm">{row.names}</span>
                      <span className="when">{row.when}</span>
                    </span>
                    <span className={`val ${row.kind}`}>
                      {row.value}
                      {row.unit && <em>{row.unit}</em>}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
