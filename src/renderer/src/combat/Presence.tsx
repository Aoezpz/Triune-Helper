import { useCallback, useEffect, useState } from 'react'
import { buffRows, type BuffsData } from '@shared/buffs'
import { mobRows, type MobsData } from '@shared/mobs'
import { awayMs, type PresenceData } from '@shared/presence'
import { clock, short } from '@shared/stats'
import { duration } from '@shared/timers'

/**
 * Two small panels that answer "what is going on right now", as distinct from
 * the meter's "what happened".
 *
 * They share a poll because they share a cadence: both change on a target
 * switch or a song pulse, neither needs the meter's 5 Hz.
 */

function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), everyMs)
    return () => window.clearInterval(t)
  }, [everyMs])
  return now
}

/* ---------------------------------------------------------------------------
   Buff board
--------------------------------------------------------------------------- */

/**
 * What is on your characters.
 *
 * There are no durations here and there cannot be: the log states when
 * something landed and when it faded, never how long it was meant to last. So
 * this shows what is up and how long it has been up, and for songs - which
 * re-sing every few seconds - whether they are still pulsing.
 */
export function BuffBoard({ characters }: { characters: string[] }): JSX.Element | null {
  const [data, setData] = useState<BuffsData>({ states: [] })
  const now = useNow(1000)

  const load = useCallback(async () => {
    setData(await window.triune.invoke('buffs:get'))
  }, [])

  useEffect(() => {
    void load()
    const t = window.setInterval(() => void load(), 2000)
    return () => window.clearInterval(t)
  }, [load])

  const rows = buffRows(data.states, now)
  if (rows.length === 0) return null

  return (
    <div className="panel">
      <div className="phead">
        <span className="t">On you</span>
        <span className="meta">{rows.length} up</span>
      </div>
      <div className="pbody">
        <div className="buffs">
          {rows.map((b) => (
            <div className={b.quiet ? 'buff quiet' : 'buff'} key={`${b.character}-${b.name}`}>
              <span className="b-name">{b.name}</span>
              {characters.length > 1 && <span className="b-who">{b.character}</span>}
              {b.song ? (
                <span className="b-tag" title={`Re-sung ${b.pulses} times`}>
                  {b.quiet ? `quiet ${duration(b.heldMs)}` : 'pulsing'}
                </span>
              ) : (
                <span className="b-tag dim">{duration(b.heldMs)}</span>
              )}
            </div>
          ))}
        </div>
        <p className="fhint" style={{ marginBottom: 0 }}>
          Read from each spell&apos;s own effect message, so only spells whose message names exactly one
          spell appear — &ldquo;Your protection fades&rdquo; belongs to 26 of them and is skipped rather
          than guessed. <strong>No durations:</strong> the log never states one. A song marked{' '}
          <em>quiet</em> has not pulsed lately, which is a hint and not proof it dropped.
        </p>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------------------
   Target dossier
--------------------------------------------------------------------------- */

/**
 * What you know about the thing you are pointed at.
 *
 * All of it comes from ledgers the app already keeps, which is the point: the
 * target line itself carries nothing but a name, and everything worth showing
 * is what you have learned about that name over months.
 */
export function TargetCard(): JSX.Element | null {
  const [presence, setPresence] = useState<PresenceData>({ targets: [], away: [] })
  const [mobs, setMobs] = useState<MobsData>({ totals: {} })
  const now = useNow(1000)

  useEffect(() => {
    const load = (): void => {
      void window.triune.invoke('presence:get').then(setPresence)
      void window.triune.invoke('mobs:get').then(setMobs)
    }
    load()
    const t = window.setInterval(load, 2000)
    return () => window.clearInterval(t)
  }, [])

  const current = presence.targets[0]
  const away = awayMs(presence.away, now, 'afk')

  if (!current) return null

  const entry = mobRows(mobs.totals).find((m) => m.mob === current.name)

  return (
    <div className="panel">
      <div className="phead">
        <span className="t">Target</span>
        <span className="meta">{current.kind.toLowerCase()}</span>
      </div>
      <div className="pbody">
        <div className="tgt">
          <div className="tgt-name">{current.name}</div>
          {current.assessment ? (
            <div className="tgt-con">{current.assessment}</div>
          ) : (
            <div className="tgt-con dim">no consider seen</div>
          )}

          {entry ? (
            <div className="tgt-stats">
              <span>
                <b>{entry.kills.toLocaleString()}</b> killed
              </span>
              {entry.fastestSeconds !== null && (
                <span>
                  best <b>{clock(entry.fastestSeconds)}</b>
                </span>
              )}
              {entry.averageSeconds !== null && (
                <span>
                  avg <b>{clock(entry.averageSeconds)}</b>
                </span>
              )}
              {entry.deaths > 0 && (
                <span className="bad">
                  killed you <b>{entry.deaths}×</b>
                </span>
              )}
              <span className="dim">{short(entry.damageDone)} dealt</span>
            </div>
          ) : (
            <div className="tgt-stats dim">Never fought — nothing on record yet.</div>
          )}
        </div>

        {/* Kept to one short line on purpose. This panel is the shortest on the
            page, and a three-line caveat sat below the fold of its own scroll
            box - a caveat nobody scrolls to is not a caveat. */}
        {away > 0 && (
          <p className="fhint" style={{ marginBottom: 0 }}>
            Flagged away: <b>{duration(away)}</b> this session — <code>/afk</code> time only, so a
            floor rather than a total.
          </p>
        )}
      </div>
    </div>
  )
}
