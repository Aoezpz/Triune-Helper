import { useCallback, useEffect, useMemo, useState } from 'react'
import { isLive, type CombatState, type LogSource, type WatcherStatus } from '@shared/ipc'
import { sessionWindow, summarizeCharacter, type LevelingData } from '@shared/leveling'
import { formatCoin, summarizeLoot, toPlatinum, type LootData } from '@shared/loot'
import type { ProgressSummary } from '@shared/progression'
import { EMPTY_ROSTER, partyOf, type RosterState } from '@shared/roster'
import { clock } from '@shared/stats'
import { summarizeZones, type ZonesData } from '@shared/zones'
import { Aurora, Starfield } from '../components/Ambient'
import { ClassChips } from '../components/Classes'
import { Crest } from '../components/Crest'

const SLOT_VARS = ['var(--slot-1)', 'var(--slot-2)', 'var(--slot-3)']

/**
 * Overview.
 *
 * The landing page, and until now the only page that knew nothing: it listed
 * the paths of the files being tailed, which is the one fact a player already
 * has. Everything below is drawn from what the rest of the app has already
 * worked out, so this costs six cheap reads and no new parsing.
 *
 * One session definition, used by all of it. A session is a run of kills with
 * no gap longer than thirty minutes, and the same window is handed to loot and
 * zones - so "this session" means the same span in every number on the screen.
 * Three pages each computing their own would be three different answers to one
 * question.
 */
export function Overview({
  status,
  active,
  onGoToPreferences,
  onNavigate
}: {
  status: WatcherStatus | null
  /** The character the title bar is on - the one whose group the headline names. */
  active: string | null
  onGoToPreferences: () => void
  onNavigate: (page: 'combat' | 'loot' | 'zones' | 'leveling' | 'progression') => void
}): JSX.Element {
  const sources = status?.sources ?? []
  const connected = sources.length > 0

  const [combat, setCombat] = useState<CombatState>({ live: null, history: [], overall: null })
  const [leveling, setLeveling] = useState<LevelingData>({ levels: [], aa: [], aaxp: [], ticks: [] })
  const [loot, setLoot] = useState<LootData>({ coin: [], discoveries: [] })
  const [zones, setZones] = useState<ZonesData>({ visits: [] })
  const [roster, setRoster] = useState<RosterState>(EMPTY_ROSTER)
  const [flags, setFlags] = useState<ProgressSummary | null>(null)

  const load = useCallback(async () => {
    const [c, l, lo, z, r, p] = await Promise.all([
      window.triune.invoke('combat:get'),
      window.triune.invoke('leveling:get'),
      window.triune.invoke('loot:get'),
      window.triune.invoke('zones:get'),
      window.triune.invoke('roster:get'),
      window.triune.invoke('progress:get')
    ])
    setCombat(c)
    setLeveling(l)
    setLoot(lo)
    setZones(z)
    setRoster(r)
    setFlags(p.summary)
  }, [])

  useEffect(() => {
    if (!connected) return
    void load()
    const timer = setInterval(() => void load(), 5000)
    return () => clearInterval(timer)
  }, [load, connected])

  const characters = useMemo(() => sources.map((s) => s.character), [sources])
  const window_ = useMemo(() => sessionWindow(leveling.ticks), [leveling.ticks])

  const kills = useMemo(
    () =>
      window_
        ? leveling.ticks.filter((t) => t.at >= window_.from && t.at <= window_.to).length
        : 0,
    [leveling.ticks, window_]
  )

  const money = useMemo(() => summarizeLoot(loot, window_), [loot, window_])
  const zoneRows = useMemo(() => summarizeZones(zones, window_), [zones, window_])
  const here = zones.visits.at(-1)?.zone ?? null

  const bestFight = useMemo(() => {
    const all = combat.live ? [combat.live, ...combat.history] : combat.history
    return all.reduce<(typeof all)[number] | null>((best, f) => (!best || f.dps > best.dps ? f : best), null)
  }, [combat])

  const aaGained = useMemo(
    () => characters.reduce((n, c) => n + summarizeCharacter(c, leveling, window_).aaGained, 0),
    [characters, leveling, window_]
  )

  const party = useMemo(() => partyOf(roster, characters, active), [roster, characters, active])

  // A clock, purely so liveness decays on its own. Fifteen seconds is fine for
  // a two-minute window and costs one render a quarter-minute.
  const [tick, setTick] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [])

  // Split by whether the game is still writing for them. Boxing three and
  // camping one used to leave the parked character sitting in the same block
  // as the two being played, distinguishable only by a word at the far right.
  //
  // Recomputed here against `tick` rather than trusting `s.active`. That flag
  // is frozen at the moment main last pushed a status, and main pushes when
  // something changes - a character logging out changes nothing main can
  // observe, so the flag stayed LIVE indefinitely.
  const live = (s: LogSource): boolean => isLive(s.lastLineAt, tick)
  const playing = sources.filter(live)
  const quiet = sources.filter((s) => !live(s))

  /**
   * One character's row.
   *
   * The slot color is looked up by the character's place in the FULL source
   * list, not by its index within its own group - otherwise a character going
   * quiet would repaint everyone below it, and these colors are the same ones
   * the combat meter uses to say who is who.
   */
  const charRow = (s: LogSource): JSX.Element => {
    const id = roster.known[s.character]
    const p = summarizeCharacter(s.character, leveling, window_)
    const pct = p.aaEarned !== null && p.aaAvailable ? (p.aaEarned / p.aaAvailable) * 100 : null
    const slot = sources.findIndex((o) => o.character === s.character)
    const on = live(s)

    return (
      <div className={on ? 'ovchar' : 'ovchar apart'} key={s.path}>
        <span
          className="slot-mark"
          style={{ background: SLOT_VARS[slot] ?? 'var(--muted)' }}
          aria-hidden="true"
        />
        <span className="oc-name">{s.character}</span>
        <ClassChips id={id} size="sm" />
        <span className="spacer" />
        <span className="oc-lvl num">{p.level !== null ? p.level : '—'}</span>
        <span className={on ? 'oc-state live' : 'oc-state'} title={lastSeen(s, tick)}>
          {on ? 'live' : 'quiet'}
        </span>
        {pct !== null && (
          <span
            className="oc-aa"
            title={`${p.aaEarned?.toLocaleString()} of ${p.aaAvailable?.toLocaleString()} AA earned`}
          >
            <i style={{ width: `${Math.max(1, pct)}%` }} />
          </span>
        )}
      </div>
    )
  }

  if (!connected) {
    return (
      <div className="page">
        <section className="hero">
          <Aurora />
          <Starfield count={60} seed={7} />
          <div className="hero-inner">
            <Crest size={140} />
            <p className="eyebrow">Emu Multitool</p>
            <h1>Read your logs. See your trio.</h1>
            <p className="lede">
              Nexus Reader tails the log files EverQuest already writes — a live meter, a fight timeline,
              trigger alerts and progression, with nothing injected and nothing in your game folder touched.
            </p>
            <div className="row" style={{ justifyContent: 'center', marginTop: 'var(--s-5)' }}>
              <button className="btn primary" type="button" onClick={onGoToPreferences}>
                Connect your Logs folder
              </button>
            </div>
            {status?.error && <p className="err">{status.error}</p>}
            <p className="hint">
              Turn logging on in-game with <code>/log on</code> for each character you box.
            </p>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="page ov">
      {/* No Aurora and no Starfield here: the banner carries key art, and two
          decorative layers on top of a picture is one too many. Both are still
          used on the first-run hero below, which has no art behind it. */}
      <header className="loot-hero hero-art">
        <div className="lh-in">
          <div className="lh-copy">
            <p className="eyebrow">
              <span className={status?.watching ? 'dot live' : 'dot'} />{' '}
              {status?.watching ? 'reading your logs' : 'idle'}
              {here ? ` · ${here}` : ''}
            </p>
            {/* Names the group, not every log open. Boxing two characters who
                are nowhere near each other is not a party of two. */}
            <h1>
              {party.members.length > 1
                ? party.members.join(' · ')
                : (party.focus ?? characters[0] ?? 'Overview')}
            </h1>
            <p className="lede">
              {window_
                ? `This session: ${clock((window_.to - window_.from) / 1000)} of it, across ${zoneRows.length} zone${zoneRows.length === 1 ? '' : 's'}.`
                : 'Nothing has happened yet this session. Numbers appear as you fight.'}
            </p>
          </div>
        </div>
      </header>

      <div className="loot-splits">
        <Tile label="Kills" value={kills.toLocaleString()} sub="this session" onClick={() => onNavigate('zones')} />
        <Tile
          label="Best fight"
          value={bestFight ? Math.round(bestFight.dps).toLocaleString() : '—'}
          sub={bestFight ? `dps · ${bestFight.name}` : 'no fights yet'}
          onClick={() => onNavigate('combat')}
        />
        <Tile
          label="Earned"
          value={formatCoin(money.total)}
          sub={money.perHour !== null ? `${toPlatinum(money.perHour).toFixed(1)} plat / hour` : 'no rate yet'}
          onClick={() => onNavigate('loot')}
        />
        <Tile
          label="AA gained"
          value={aaGained.toLocaleString()}
          sub="this session"
          onClick={() => onNavigate('leveling')}
        />
      </div>

      <div className="ov-cols">
        <section className="panel">
          <div className="phead">
            <span className="t">Your characters</span>
            <span className="meta">
              {playing.length > 0 && quiet.length > 0
                ? `${playing.length} playing · ${quiet.length} quiet`
                : `${sources.length} log${sources.length === 1 ? '' : 's'} tailed`}
            </span>
          </div>
          <div className="pbody">
            <div className="ovchars">
              {playing.map(charRow)}

              {/* Only split the list when there is something to split it FROM.
                  A heading over the whole list says nothing; a heading that
                  appears the moment one of three boxes logs out is the point -
                  the character who stopped being played stops sitting in the
                  same block as the ones who are. */}
              {quiet.length > 0 && playing.length > 0 && (
                <div className="ovchars-sep">not playing</div>
              )}
              {quiet.map(charRow)}
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="phead">
            <span className="t">Flagging</span>
            <span className="meta">account-wide</span>
          </div>
          <div className="pbody">
            {flags && flags.total > 0 ? (
              <button className="ovflags" type="button" onClick={() => onNavigate('progression')}>
                <span className="of-pct num">{Math.round((flags.earned / flags.total) * 100)}%</span>
                <span className="of-bar">
                  <i style={{ width: `${(flags.earned / flags.total) * 100}%` }} />
                </span>
                <span className="of-sub">
                  {flags.earned} of {flags.total} steps · {flags.total - flags.earned} to go
                </span>
              </button>
            ) : (
              <div className="empty">Sync from PTDex on the Progression page to fill this in.</div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

/**
 * Why a log is marked quiet, in words, on hover.
 *
 * "Quiet" is deliberately not "offline": EverQuest writes nothing at all for a
 * character standing still in an empty zone, so silence is not proof of a
 * logout and the app will not claim one. What it can state as a fact is when
 * the game last wrote to the file, so it says that instead and lets you draw
 * the conclusion.
 */
function lastSeen(s: LogSource, now: number): string {
  if (isLive(s.lastLineAt, now)) return 'Written to in the last two minutes'
  if (s.lastLineAt === null) return 'No lines read from this log yet'
  const ago = clock(Math.max(0, (now - s.lastLineAt) / 1000))
  return `Last written ${ago} ago — either logged out, or somewhere nothing is happening`
}

function Tile({
  label,
  value,
  sub,
  onClick
}: {
  label: string
  value: string
  sub: string
  onClick: () => void
}): JSX.Element {
  return (
    <button className="lsplit ovtile" type="button" onClick={onClick}>
      <span className="l">{label}</span>
      <span className="v num">{value}</span>
      <span className="sub">{sub}</span>
    </button>
  )
}
