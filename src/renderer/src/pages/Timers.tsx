import { useEffect, useMemo, useState } from 'react'
import type { AlertSound } from '@shared/alerts'
import {
  countdown,
  duration,
  MIN_SPAWN_MS,
  parseDuration,
  remainingMs,
  TIMER_PRESETS,
  type ManualTimer,
  type SpawnRow
} from '@shared/timers'
import { Aurora, Starfield } from '../components/Ambient'
import { add, patch, remove, track, useTimers } from '../timers/store'

/**
 * Timers.
 *
 * Two halves, and the split between them is the whole design: countdowns you
 * set, and spawn windows the app worked out from your own kills. There is no
 * third half - buff and recast timers would need durations the log never
 * writes, and this page would rather be short than invented.
 *
 * The clock lives here rather than in the store, because a display tick should
 * only re-render the thing being displayed. The alarms run from app start
 * whether or not this page is open; see timers/store.ts.
 */
export function Timers(): JSX.Element {
  const data = useTimers()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const beat = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(beat)
  }, [])

  const running = data.manual.filter((t) => t.endsAt !== null && t.endsAt > now).length
  const pinned = data.spawns.filter((s) => s.tracked)
  const due = pinned.filter((s) => s.dueAt !== null && s.dueAt <= now).length

  return (
    <div className="page zones">
      <header className="loot-hero">
        <Aurora />
        <Starfield count={26} seed={31} />
        <div className="lh-in">
          <div className="lh-copy">
            <p className="eyebrow">countdowns, and windows you have earned</p>
            <h1>Timers</h1>
            <p className="lede">
              Countdowns you set, and respawn windows worked out from your own kill history. Both keep
              running and both make noise on any page â€” you are meant to be looking at the game.
            </p>
          </div>
          <div className="lh-total">
            <span className="n">{running}</span>
            <span className="l">
              running{pinned.length > 0 ? ` Â· ${pinned.length} mob${pinned.length === 1 ? '' : 's'} pinned` : ''}
              {due > 0 ? ` Â· ${due} due` : ''}
            </span>
          </div>
        </div>
      </header>

      <Countdowns timers={data.manual} now={now} />
      <Spawns rows={data.spawns} now={now} />
    </div>
  )
}

/* ---------------------------------------------------------------------------
   Countdowns
--------------------------------------------------------------------------- */

const SOUNDS: AlertSound[] = ['chime', 'alarm', 'thud', 'sweep', 'none']

function Countdowns({ timers, now }: { timers: ManualTimer[]; now: number }): JSX.Element {
  const [label, setLabel] = useState('')
  const [len, setLen] = useState('')

  const seconds = useMemo(() => parseDuration(len), [len])
  const canAdd = label.trim().length > 0 && seconds !== null && seconds > 0

  const create = (withSeconds?: number): void => {
    const s = withSeconds ?? seconds
    if (!s || label.trim() === '') return
    void add({
      // Left empty on purpose: main mints the id. Generating it here would put
      // the app's only use of crypto.randomUUID in the renderer, where it is
      // only defined in a secure context - and a packaged build loads from
      // file://.
      id: '',
      label: label.trim(),
      seconds: s,
      // Started immediately. A timer you set and then have to press play on is
      // a timer you set too late.
      endsAt: Date.now() + s * 1000,
      repeat: false,
      sound: 'chime'
    })
    setLabel('')
    setLen('')
  }

  return (
    <section className="panel">
      <div className="phead">
        <span className="t">Countdowns</span>
        <span className="meta">
          {timers.length} saved Â· alarms sound on any page
        </span>
      </div>

      <div className="pbody">
        <div className="tm-new">
          <input
            type="text"
            placeholder="What is it? â€” repop, port, camp check"
            value={label}
            maxLength={40}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && canAdd && create()}
          />
          <input
            className="tm-len"
            type="text"
            placeholder="22m"
            value={len}
            onChange={(e) => setLen(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && canAdd && create()}
            aria-invalid={len !== '' && seconds === null}
          />
          <button className="btn" type="button" disabled={!canAdd} onClick={() => create()}>
            Start
          </button>
        </div>

        <div className="tm-presets">
          <span className="muted">or</span>
          {TIMER_PRESETS.map((p) => (
            <button
              key={p.label}
              className="chipbtn"
              type="button"
              disabled={label.trim() === ''}
              title={label.trim() === '' ? 'Name it first' : `Start a ${p.label} timer`}
              onClick={() => create(p.seconds)}
            >
              {p.label}
            </button>
          ))}
          <span className="fhint" style={{ margin: 0 }}>
            Type <code>90</code>, <code>5m</code>, <code>1h30m</code> or <code>2:30</code>.
          </span>
        </div>

        {timers.length === 0 ? (
          <p className="fhint" style={{ marginBottom: 0 }}>
            Nothing set. A countdown here is just a countdown â€” the app never learns these from the log,
            because EverQuest doesn&apos;t write durations to it.
          </p>
        ) : (
          <div className="tm-list">
            {timers.map((t) => (
              <Countdown key={t.id} timer={t} now={now} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function Countdown({ timer, now }: { timer: ManualTimer; now: number }): JSX.Element {
  const left = remainingMs(timer, now)
  const done = left === 0
  const stopped = left === null
  const fraction = left === null ? 0 : Math.min(1, left / (timer.seconds * 1000))

  const restart = (): void => void patch(timer.id, { endsAt: Date.now() + timer.seconds * 1000 })

  return (
    <div className={done ? 'tm-row done' : stopped ? 'tm-row off' : 'tm-row'}>
      {/* Drains right to left, so the bar and the number agree about which way
          time is going. */}
      <span className="tm-fill" style={{ width: `${fraction * 100}%` }} aria-hidden="true" />

      <span className="tm-label">{timer.label}</span>
      <span className="tm-clock num">
        {stopped ? countdown(timer.seconds * 1000) : countdown(left)}
      </span>
      <span className="tm-of dim">{duration(timer.seconds * 1000)}</span>

      <button
        className="chipbtn"
        type="button"
        aria-pressed={timer.repeat}
        title="Restart automatically when it finishes"
        onClick={() => void patch(timer.id, { repeat: !timer.repeat })}
      >
        â†»
      </button>

      <select
        className="tm-sound"
        value={timer.sound}
        aria-label="Sound"
        onChange={(e) => void patch(timer.id, { sound: e.target.value as AlertSound })}
      >
        {SOUNDS.map((s) => (
          <option key={s} value={s}>
            {s === 'none' ? 'silent' : s}
          </option>
        ))}
      </select>

      <button className="chipbtn" type="button" onClick={restart}>
        {stopped || done ? 'Start' : 'Restart'}
      </button>
      <button
        className="chipbtn"
        type="button"
        disabled={stopped}
        onClick={() => void patch(timer.id, { endsAt: null })}
      >
        Stop
      </button>
      <button className="chipbtn x" type="button" aria-label="Delete" onClick={() => void remove(timer.id)}>
        Ã—
      </button>
    </div>
  )
}

/* ---------------------------------------------------------------------------
   Spawn windows
--------------------------------------------------------------------------- */

function Spawns({ rows, now }: { rows: SpawnRow[]; now: number }): JSX.Element {
  const pinned = rows.filter((r) => r.tracked)
  const suggested = rows.filter((r) => !r.tracked)
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? suggested : suggested.slice(0, 8)

  return (
    <section className="panel">
      <div className="phead">
        <span className="t">Spawn windows</span>
        <span className="meta">observed, not a spawn table</span>
      </div>

      <div className="pbody">
        {rows.length === 0 ? (
          <p className="fhint" style={{ marginBottom: 0 }}>
            Nothing to go on yet. A window needs the same mob killed twice, at least{' '}
            {duration(MIN_SPAWN_MS)} apart â€” kill something twice, or rebuild from your logs in
            Preferences to read the history you already have on disk.
          </p>
        ) : (
          <>
            {pinned.length > 0 && (
              <div className="ztable">
                <SpawnHead />
                {pinned.map((r) => (
                  <Spawn key={r.mob} row={r} now={now} />
                ))}
              </div>
            )}

            {suggested.length > 0 && (
              <>
                <div className="tm-sub">
                  {pinned.length > 0 ? 'Also looks like it is on a timer' : 'Looks like it is on a timer'}
                  <span className="spacer" />
                  {suggested.length > 8 && (
                    <button className="chipbtn" type="button" onClick={() => setShowAll(!showAll)}>
                      {showAll ? 'Show fewer' : `All ${suggested.length}`}
                    </button>
                  )}
                </div>
                <div className="ztable">
                  {pinned.length === 0 && <SpawnHead />}
                  {visible.map((r) => (
                    <Spawn key={r.mob} row={r} now={now} />
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* The single most important sentence on the page. An observed gap is
            respawn plus travel, so every number here is generous, and saying
            so is the difference between a useful tool and a wrong one. Held
            back until there are rows: with none, the empty state above has
            already said the same thing more briefly. */}
        {rows.length > 0 && (
        <p className="fhint" style={{ marginBottom: 0 }}>
          Worked out from the gaps between your own kills, because a log file contains no spawn table. A
          gap is the respawn <em>plus</em> however long it took you to get back and kill it again, so the
          shortest gap you have ever seen is the earliest it can be up â€” never later than the real timer,
          often earlier than you will find it. Gaps over {duration(6 * 60 * 60 * 1000)} are treated as you
          logging off rather than as a slow spawn. Pin a mob to have it chime when its window opens.
        </p>
        )}
      </div>
    </section>
  )
}

function SpawnHead(): JSX.Element {
  return (
    <div className="zrow zhead srow">
      <span className="z-name">Mob</span>
      <span className="z-n">Window opens</span>
      <span className="z-n">Soonest seen</span>
      <span className="z-n">Typical</span>
      <span className="z-n">Killed</span>
      <span className="z-n">Last kill</span>
      <span className="z-n" />
    </div>
  )
}

function Spawn({ row, now }: { row: SpawnRow; now: number }): JSX.Element {
  const left = row.dueAt === null ? null : row.dueAt - now
  const up = left !== null && left <= 0
  const since = now - row.lastKillAt
  // How far through the window we are, for the bar. Full means due.
  const fraction =
    row.shortestMs === null ? 0 : Math.max(0, Math.min(1, since / row.shortestMs))

  return (
    <div className={up ? 'zrow srow up' : 'zrow srow'}>
      <span className="z-bar" style={{ width: `${fraction * 100}%` }} aria-hidden="true" />

      <span className="z-name" title={row.zone ?? undefined}>
        {row.mob}
        {row.zone && <span className="s-zone">{row.zone}</span>}
      </span>

      <span className={up ? 'z-n num good' : 'z-n num'}>
        {left === null ? 'â€”' : up ? 'open' : countdown(left)}
      </span>
      <span className="z-n num dim">
        {row.shortestMs === null ? 'â€”' : duration(row.shortestMs)}
      </span>
      {/* One gap is not a typical anything, so the median waits for two. */}
      <span className="z-n num dim">
        {row.medianMs !== null && row.samples >= 2 ? duration(row.medianMs) : 'â€”'}
      </span>
      <span className="z-n num">{row.kills.toLocaleString()}</span>
      <span className="z-n num dim">{duration(since)} ago</span>
      <span className="z-n">
        <button
          className={row.tracked ? 'chipbtn on' : 'chipbtn'}
          type="button"
          aria-pressed={row.tracked}
          title={row.tracked ? 'Stop watching this one' : 'Chime when its window opens'}
          onClick={() => void track(row.mob, !row.tracked)}
        >
          {row.tracked ? 'â˜…' : 'â˜†'}
        </button>
      </span>
    </div>
  )
}
