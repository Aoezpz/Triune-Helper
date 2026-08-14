import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ratePoints,
  sessionWindow,
  summarizeCharacter,
  type CharacterProgress,
  type LevelingData
} from '@shared/leveling'
import { clock } from '@shared/stats'
import { Starfield } from '../components/Ambient'

/**
 * Progression.
 *
 * The honest version. EverQuest logs say you gained experience, never how much,
 * so there is no regular XP bar here and there never will be.
 *
 * AA is different, and only a real log revealed it: this server writes
 * "You gain bonus AA experience! (5087/18850)". That bar IS drawn, because it
 * is read rather than invented - and its rate is a difference between two
 * readings over real elapsed time, not a guess from how often a message fired.
 */

const SLOT_VARS = ['var(--slot-1)', 'var(--slot-2)', 'var(--slot-3)']

export function Leveling({ characters }: { characters: string[] }): JSX.Element {
  const [data, setData] = useState<LevelingData>({ levels: [], aa: [], aaxp: [], ticks: [] })

  const load = useCallback(async () => {
    setData(await window.triune.invoke('leveling:get'))
  }, [])

  useEffect(() => {
    void load()
    // Progression is slow by nature; a ten-second beat is plenty and keeps the
    // page from re-rendering a chart on every kill.
    const timer = setInterval(() => void load(), 10_000)
    return () => clearInterval(timer)
  }, [load])

  const window_ = useMemo(() => sessionWindow(data.ticks), [data.ticks])

  // Show every character that has any history, not just the ones currently
  // logged in - you want to see last night's grind too.
  const names = useMemo(() => {
    const seen = new Set<string>(characters)
    for (const row of [...data.levels, ...data.aa, ...(data.aaxp ?? []), ...data.ticks]) {
      seen.add(row.character)
    }
    return [...seen].sort()
  }, [characters, data])

  const rows = useMemo(
    () => names.map((n) => summarizeCharacter(n, data, window_)),
    [names, data, window_]
  )

  const anything =
    data.levels.length + data.aa.length + (data.aaxp?.length ?? 0) + data.ticks.length > 0

  return (
    <div className="page lvl">
      <div className="page-head">
        <h1>Leveling</h1>
        <span className="spacer" />
        {window_ && (
          <span className="chip" title="Activity with no gap longer than 30 minutes">
            session {clock((window_.to - window_.from) / 1000)}
          </span>
        )}
        <button
          className="btn"
          type="button"
          disabled={!anything}
          onClick={() => void window.triune.invoke('leveling:reset', {}).then(setData)}
        >
          Clear history
        </button>
        <p className="lede">
          Levels and ability points as they land in your logs. EverQuest never writes how much regular
          experience you gained — only that you did — so there is no XP bar for it. AA is the exception:
          this server prints the count, so that bar is read rather than estimated.
        </p>
      </div>

      {!anything && (
        <div className="stub">
          <div className="empty">
            <Starfield count={30} seed={23} />
            <h2>Nothing recorded yet</h2>
            <p>
              Levels, ability points and kill rate appear here as you play. Nothing is backfilled from before
              the app was running.
            </p>
          </div>
        </div>
      )}

      {anything && (
        <div className="lvl-grid">
          {rows.map((row, i) => (
            <CharacterCard key={row.character} row={row} color={SLOT_VARS[i] ?? 'var(--series-group)'} window_={window_} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * The AA bar.
 *
 * The only progress bar in this app that is allowed to exist, because it is the
 * only one the log supplies both halves of. The remaining count and the ETA sit
 * under it; the ETA appears only once two readings have actually moved, since a
 * projection from a single sample is a decoration, not a forecast.
 */
function AaBar({ row, color }: { row: CharacterProgress; color: string }): JSX.Element {
  const earned = row.aaEarned ?? 0
  const available = row.aaAvailable ?? 0
  const pct = available > 0 ? (earned / available) * 100 : 0
  const remaining = Math.max(0, available - earned)

  return (
    <div className="aabar" title="From the log's own counter, not an estimate">
      <div className="aabar-top">
        <span className="l">AA earned</span>
        <span className="spacer" />
        <span className="v num">
          {earned.toLocaleString()}
          <i>/{available.toLocaleString()}</i>
        </span>
        <span className="p num">{pct.toFixed(1)}%</span>
      </div>
      <div className="aabar-track">
        <span style={{ width: `${Math.max(0.4, Math.min(100, pct))}%`, background: color }} />
      </div>
      <div className="aabar-foot">
        <span>{remaining.toLocaleString()} to go</span>
        {row.etaAllAaSeconds !== null && (
          <>
            <span className="spacer" />
            <span title="At this session's measured rate — it will move as the rate does">
              ~{clock(row.etaAllAaSeconds)} at this rate
            </span>
          </>
        )}
      </div>
    </div>
  )
}

function CharacterCard({
  row,
  color,
  window_
}: {
  row: CharacterProgress
  color: string
  window_: { from: number; to: number } | null
}): JSX.Element {
  const buckets = useMemo(
    () => (window_ ? ratePoints(row.ticks, window_, 32) : []),
    [row.ticks, window_]
  )
  const peak = Math.max(1, ...buckets.map((b) => b.count))

  return (
    <section className="panel lvl-card">
      <div className="phead">
        <span className="slot-mark" style={{ background: color }} />
        <span className="t">{row.character}</span>
        <span className="meta">
          {row.level !== null ? `level ${row.level}` : 'level unknown'}
          {/* Earned, not unspent. The header used to read "23 AA" for a
              character who had earned five thousand of them. */}
          {row.aaEarned !== null ? ` · ${row.aaEarned.toLocaleString()} AA earned` : ''}
          {row.aa !== null ? ` · ${row.aa} unspent` : ''}
        </span>
      </div>

      <div className="pbody">
        {row.aaEarned !== null && row.aaAvailable !== null && row.aaAvailable > 0 && (
          <AaBar row={row} color={color} />
        )}
        <div className="lvl-stats">
          <div className="s">
            <span className="n num">{row.levelsGained}</span>
            <span className="l">levels this session</span>
          </div>
          <div className="s">
            <span className="n num">{row.aaGained}</span>
            <span className="l">AA this session</span>
          </div>
          <div className="s">
            <span className="n num">{Math.round(row.killsPerHour)}</span>
            <span className="l">xp msgs / hour</span>
          </div>
          <div className="s">
            <span className="n num">
              {row.aaEarnedPerHour !== null ? row.aaEarnedPerHour.toFixed(1) : '—'}
            </span>
            <span className="l">AA / hour</span>
          </div>
        </div>

        {/* Kill rate over the session. Bars, not a line: these are counts in
            discrete buckets, and a line would imply a continuous quantity. */}
        {buckets.length > 0 && (
          <div className="lvl-rate" title="Experience messages per bucket across this session">
            {buckets.map((b, i) => (
              <span key={i} style={{ height: `${(b.count / peak) * 100}%`, background: color }} />
            ))}
          </div>
        )}

        {/* Dings, newest first - the actual events, not a derived curve. */}
        <div className="lvl-events">
          {row.levels.length === 0 && row.aa_.length === 0 && (
            <span className="muted">No dings recorded in this session.</span>
          )}
          {[...row.levels.map((l) => ({ ...l, kind: 'level' as const })), ...row.aa_.map((l) => ({ ...l, kind: 'aa' as const }))]
            .sort((a, b) => b.at - a.at)
            .slice(0, 8)
            .map((e, i) => (
              <div className="lvl-ev" key={`${e.kind}-${e.at}-${i}`}>
                <span className={`lvl-kind ${e.kind}`}>{e.kind === 'level' ? 'LEVEL' : 'AA'}</span>
                <span className="lvl-val num">{e.value}</span>
                <span className="lvl-when">
                  {new Date(e.at).toLocaleTimeString([], { hour12: false })}
                </span>
              </div>
            ))}
        </div>

        {row.lastLevelSeconds !== null && (
          <p className="fhint" style={{ margin: 0 }}>
            Last two levels were {clock(row.lastLevelSeconds)} apart.
          </p>
        )}
      </div>
    </section>
  )
}
