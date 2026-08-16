import { useEffect, useMemo, useState } from 'react'
import type { ParsedEvent } from '@shared/parser/types'
import { isLive } from '@shared/ipc'
import { partyOf } from '@shared/roster'
import type { FightSummary } from '@shared/stats'
import { clock, short } from '@shared/stats'
import { Starfield } from '../components/Ambient'
import { DamageByMob, Procs, Specials } from '../combat/Bars'
import { CombatLog } from '../combat/CombatLog'
import { DpsOverTime } from '../combat/DpsOverTime'
import { Party } from '../combat/Party'
import { BuffBoard, TargetCard } from '../combat/Presence'
import { Roster } from '../combat/Roster'
import { Timeline } from '../combat/Timeline'
import { useCombat, useCombatLines } from '../hooks/useCombat'
import { useRoster } from '../hooks/useRoster'
import { useWatcherStatus } from '../hooks/useSettings'

type Scope = 'fight' | 'overall'
export type View = 'dashboard' | 'timeline'
type Lens = 'outgoing' | 'incoming' | 'healing'

/**
 * Combat.
 *
 * Three columns rather than the usual grid-of-equal-panels: WHO on the left,
 * WHAT HAPPENED in the middle, and the raw stream as a permanent ticker on the
 * right. The reasoning is that those three questions get asked at different
 * rates - you glance at the roster constantly, study the curve occasionally,
 * and scan the log when something surprised you - and a layout that gives each
 * its own column lets all three stay on screen instead of trading places.
 *
 * The headline strip spans all three, because the one number everybody wants
 * is the one number that should never be in a column.
 */
export function Combat({
  characters,
  active,
  view,
  onView
}: {
  characters: string[]
  /** The character the title bar is on. A party is that character's group. */
  active: string | null
  view: View
  onView: (v: View) => void
}): JSX.Element {
  const combat = useCombat()
  const [scope, setScope] = useState<Scope>('fight')
  const [lens, setLens] = useState<Lens>('outgoing')
  const [showUnparsed, setShowUnparsed] = useState(false)
  const [showLoot, setShowLoot] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [timelineEvents, setTimelineEvents] = useState<ParsedEvent[]>([])

  const lines = useCombatLines(400, showUnparsed, showLoot)
  const roster = useRoster()
  const selfNames = useMemo(() => new Set(characters), [characters])
  const party = useMemo(() => partyOf(roster, characters, active), [roster, characters, active])

  // Who the game has stopped writing for. Recomputed against a ticking clock
  // rather than read off the pushed status, because logging out is not
  // something main can observe - the file simply stops growing, and nothing
  // prompts a new status.
  const status = useWatcherStatus()
  const [tick, setTick] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [])
  const offline = useMemo(
    () =>
      new Set(
        (status?.sources ?? []).filter((s) => !isLive(s.lastLineAt, tick)).map((s) => s.character)
      ),
    [status, tick]
  )

  // When the game last wrote for the character in the title bar - the buff
  // board needs it to know whether it still has grounds to show anything.
  const activeLastLine =
    (status?.sources ?? []).find((s) => s.character === active)?.lastLineAt ?? null

  const fights: FightSummary[] = useMemo(
    () => (combat.live ? [combat.live, ...combat.history] : combat.history),
    [combat]
  )
  const selected = selectedId ? (fights.find((f) => f.id === selectedId) ?? null) : (fights[0] ?? null)
  const shown = scope === 'overall' ? combat.overall : selected

  const rows = shown
    ? lens === 'outgoing'
      ? shown.sources
      : lens === 'incoming'
        ? shown.incoming
        : shown.healing
    : []

  // Events are pulled only while the timeline is open, and re-pulled on a slow
  // beat for a live fight - fast enough to watch a pull develop, cheap enough
  // that leaving the tab open costs nothing.
  useEffect(() => {
    if (view !== 'timeline' || !shown) {
      setTimelineEvents([])
      return
    }
    let alive = true
    const pull = (): void => {
      void window.triune.invoke('combat:events', { fightId: shown.id }).then((rows) => {
        if (alive) setTimelineEvents(rows)
      })
    }
    pull()
    if (!shown.live) return () => { alive = false }
    const timer = setInterval(pull, 1000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [view, shown?.id, shown?.live, shown])

  const total = shown
    ? lens === 'healing'
      ? shown.totalHealed
      : lens === 'incoming'
        ? shown.totalIn
        : shown.totalOut
    : 0

  return (
    <div className="page combat">
      {/* ---- headline strip ---- */}
      <header className="cbar">
        <div className="cbar-left">
          <div className="seg">
            <button type="button" aria-pressed={scope === 'fight'} onClick={() => setScope('fight')}>
              Fight
            </button>
            <button type="button" aria-pressed={scope === 'overall'} onClick={() => setScope('overall')}>
              Overall
            </button>
          </div>

          <select
            className="fightsel"
            value={selected?.id ?? ''}
            disabled={scope === 'overall' || fights.length === 0}
            onChange={(e) => setSelectedId(e.target.value || null)}
            aria-label="Fight"
          >
            {fights.length === 0 && <option value="">No fight yet</option>}
            {fights.map((f) => (
              <option key={f.id} value={f.id}>
                {f.live ? '● ' : ''}
                {f.name} · {clock(f.durationSeconds)}
              </option>
            ))}
          </select>

          <div className="seg">
            {(['dashboard', 'timeline'] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => onView(v)}>
                {v === 'dashboard' ? 'Dashboard' : 'Timeline'}
              </button>
            ))}
          </div>
        </div>

        <div className="cbar-mid">
          {shown && (
            <>
              <span className="ctitle">{shown.name}</span>
              <span className="csub">
                {shown.zone ?? 'unknown zone'} · {clock(shown.durationSeconds)}
                {shown.live && <span className="dot live" style={{ marginLeft: '0.5rem' }} />}
              </span>
            </>
          )}
        </div>

        <div className="cbar-right">
          <div className="dps-readout">
            <b className="num">{shown ? Math.round(shown.dps).toLocaleString() : '—'}</b>
            <span className="unit">dps</span>
          </div>
          <div className="csub num">
            {shown
              ? `act ${Math.round(shown.actDps).toLocaleString()} · ${short(shown.totalOut)} out · ${short(
                  shown.totalIn
                )} in`
              : 'waiting for combat'}
          </div>
        </div>
      </header>

      {/* ---- three columns ---- */}
      <div className="ccols">
        {/* WHO */}
        <section className="panel ccol-who">
          <div className="phead">
            <div className="tabs">
              {(['outgoing', 'incoming', 'healing'] as Lens[]).map((l) => (
                <button key={l} type="button" aria-pressed={lens === l} onClick={() => setLens(l)}>
                  {l === 'outgoing' ? 'Out' : l === 'incoming' ? 'In' : 'Heals'}
                </button>
              ))}
            </div>
            <span className="meta">
              {short(total)}
              {/* Absorbs sit beside the heal total, never inside it - damage
                  prevented is not damage repaired. Shown only on the Heals
                  lens, where it is the other half of the same question. */}
              {lens === 'healing' && shown && shown.totalAbsorbed > 0 && (
                <span className="sub" title="Damage stopped by shields before it landed">
                  {' '}
                  · {short(shown.totalAbsorbed)} absorbed
                </span>
              )}
            </span>
          </div>
          {/* Outside .pbody, so it stays put while the ranked list scrolls. */}
          <Party
            party={party}
            known={roster.known}
            order={characters}
            busy={roster.busy}
            offline={offline}
          />
          <div className="pbody">
            {shown ? (
              <Roster
                rows={rows}
                order={characters}
                unit={lens === 'healing' ? 'hps' : 'dps'}
                known={roster.known}
              />
            ) : (
              <Waiting text="Everyone who swung, ranked. Click a row for the skill breakdown." />
            )}
          </div>
        </section>

        {/* WHAT HAPPENED */}
        <div className="ccol-what">
          {view === 'timeline' ? (
            <section className="panel" style={{ flex: 1 }}>
              <div className="phead">
                <span className="t">Timeline</span>
                <span className="meta">one lane per skill · hollow = missed or resisted</span>
              </div>
              <div className="pbody" style={{ padding: 0 }}>
                {shown ? (
                  <Timeline
                    events={timelineEvents}
                    selfNames={selfNames}
                    order={characters}
                    start={shown.start}
                    end={shown.end}
                  />
                ) : (
                  <Waiting text="Every swing, in order, one lane per skill." />
                )}
              </div>
            </section>
          ) : (
            <>
              <section className="panel">
                <div className="phead">
                  <span className="t">DPS over time</span>
                  <span className="meta">
                    {shown && shown.series.length > 0
                      ? `${short(Math.max(...shown.series.map((p) => p.you + p.pet + p.group)))} peak`
                      : '—'}
                  </span>
                </div>
                <div className="pbody">
                  {shown ? (
                    <DpsOverTime series={shown.series} />
                  ) : (
                    <Waiting text="A rolling curve for you, your pets and the rest of the trio." />
                  )}
                </div>
              </section>

              <div className="ccol-split">
                <section className="panel">
                  <div className="phead">
                    <span className="t">Mobs</span>
                    <span className="meta">{shown ? shown.mobs.length : '—'}</span>
                  </div>
                  <div className="pbody">
                    {shown ? <DamageByMob rows={shown.mobs} /> : <Waiting text="Ranked by damage taken." />}
                  </div>
                </section>

                <section className="panel">
                  <div className="phead">
                    <span className="t">Procs</span>
                    <span className="meta">
                      {shown ? `${shown.procs.reduce((s, p) => s + p.count, 0)}` : '—'}
                    </span>
                  </div>
                  <div className="pbody">
                    {shown ? <Procs rows={shown.procs} /> : <Waiting text="Weapon procs, counted." />}
                  </div>
                </section>

                <section className="panel">
                  <div className="phead">
                    <span className="t">Specials</span>
                    <span className="meta">
                      {shown ? `${shown.specials.reduce((s, p) => s + p.count, 0)}` : '—'}
                    </span>
                  </div>
                  <div className="pbody">
                    {shown ? (
                      <Specials rows={shown.specials} />
                    ) : (
                      <Waiting text="Finishing blows, fatal bow shots and the like." />
                    )}
                  </div>
                </section>
              </div>

              {/* Live state rather than fight history: what is on you, and what
                  you are pointed at. Both hide themselves when they have
                  nothing to say, so a quiet moment costs no space. */}
              <div className="ccol-split">
                <BuffBoard character={active} lastLineAt={activeLastLine} />
                <TargetCard />
              </div>
            </>
          )}
        </div>

        {/* THE STREAM */}
        <section className="panel ccol-log">
          <div className="phead">
            <span className="t">Stream</span>
            <span className="spacer" />
            <label
              className="toggle"
              title="Server-wide discovery announcements — hover an item for its stats"
            >
              <input type="checkbox" checked={showLoot} onChange={(e) => setShowLoot(e.target.checked)} />
              loot
            </label>
            <label className="toggle" title="Show lines the parser has no rule for">
              <input
                type="checkbox"
                checked={showUnparsed}
                onChange={(e) => setShowUnparsed(e.target.checked)}
              />
              raw
            </label>
          </div>
          <div className="pbody" style={{ padding: 'var(--s-1) var(--s-2)' }}>
            <CombatLog lines={lines} compact />
          </div>
        </section>
      </div>
    </div>
  )
}

function Waiting({ text }: { text: string }): JSX.Element {
  return (
    <div className="empty">
      <Starfield count={20} seed={text.length} />
      <p style={{ margin: 0, maxWidth: '30ch', lineHeight: 1.55 }}>{text}</p>
    </div>
  )
}
