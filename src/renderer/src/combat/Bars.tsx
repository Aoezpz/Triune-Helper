import type { MobRow, ProcRow, SourceRow, SpecialRow } from '@shared/stats'
import { short } from '@shared/stats'
import { isSpellName } from '@shared/tooltip'
import { Tipped } from '../components/Tip'

/**
 * Ranked bars. Length carries the magnitude, so colour only has to say what
 * kind of thing the row is - one hue per role, not a ramp, which would
 * double-encode what the length already shows.
 */

function pct(value: number, max: number): string {
  return `${max > 0 ? Math.max(1.5, (value / max) * 100) : 0}%`
}

/** Which series colour a combatant wears, by what it IS - never by its rank,
 *  so filtering the list never repaints the survivors. */
function roleColor(row: SourceRow, selfNames: Set<string>): string {
  if (row.kind === 'pet') return 'var(--series-pet)'
  if (row.kind === 'self' || selfNames.has(row.name)) return 'var(--series-you)'
  if (row.kind === 'mob') return 'var(--series-incoming)'
  return 'var(--series-group)'
}

export function SourceBars({
  rows,
  selfNames,
  healing = false
}: {
  rows: SourceRow[]
  selfNames: Set<string>
  healing?: boolean
}): JSX.Element {
  if (rows.length === 0) return <div className="empty">Nothing yet.</div>
  const max = rows[0].damage

  return (
    <div className="bars">
      {rows.map((row, i) => {
        const swings = row.hits + row.misses
        const missRate = swings > 0 ? row.misses / swings : 0
        return (
          <div className="bar" key={row.name} title={`${row.name} — ${row.damage.toLocaleString()}`}>
            <span
              className="fill"
              style={{ width: pct(row.damage, max), background: roleColor(row, selfNames) }}
            />
            <span className="rank">{i + 1}</span>
            <span className="name">
              {row.name}
              {row.kind === 'pet' && <span className="sub"> pet</span>}
              {missRate > 0.001 && <span className="sub"> · {(missRate * 100).toFixed(0)}% miss</span>}
            </span>
            <span className="val">
              {short(row.damage)}
              <span className="sub">
                {' '}
                · {Math.round(row.dps)} {healing ? 'hps' : 'dps'}
                {row.crits > 0 && ` · ${Math.round((row.crits / Math.max(1, row.hits)) * 100)}% crit`}
              </span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function DamageByMob({ rows }: { rows: MobRow[] }): JSX.Element {
  if (rows.length === 0) return <div className="empty">No mobs damaged yet.</div>
  const max = rows[0].damage
  const total = rows.reduce((s, r) => s + r.damage, 0)

  return (
    <div className="bars">
      {rows.map((row, i) => (
        <div className="bar" key={row.name}>
          <span className="fill" style={{ width: pct(row.damage, max), background: 'var(--bar-mob)' }} />
          <span className="rank">{i + 1}</span>
          <span className="name">
            {row.name}
            {row.resists > 0 && <span className="sub"> · {row.resists} resist</span>}
          </span>
          <span className="val">
            {short(row.damage)}
            <span className="sub"> · {total > 0 ? Math.round((row.damage / total) * 100) : 0}%</span>
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * Named hit modifiers.
 *
 * The best hit leads rather than the total, because that is the number anyone
 * actually wants from a Fatal Bow Shot - and because the total is the sum of a
 * handful of samples, which reads like a rate and is not one.
 */
export function Specials({ rows }: { rows: SpecialRow[] }): JSX.Element {
  if (rows.length === 0) return <div className="empty">No special hits yet.</div>

  return (
    <div className="bars">
      {rows.map((row) => (
        <div className="bar" key={row.name}>
          <span className="rank">•</span>
          <span className="name" title={row.name}>
            {row.name}
          </span>
          <span className="val">
            ×{row.count}
            {row.best > 0 && <span className="sub"> · {short(row.best)} best</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * Procs.
 *
 * The COUNT leads, because the count is what was observed. The rate is a
 * derivation and it comes second, in smaller type, and only on a fight long
 * enough to support one - see MIN_SECONDS_FOR_RATE. It is written "/min" and
 * never "ppm": players already use PPM for the proc rate printed on a weapon,
 * and reusing it here would read as a claim about the item rather than a
 * measurement of this pull.
 */
export function Procs({ rows }: { rows: ProcRow[] }): JSX.Element {
  if (rows.length === 0) return <div className="empty">No procs seen yet.</div>

  return (
    <div className="bars">
      {rows.map((row) => (
        <div className="bar" key={row.name}>
          <span className="rank">•</span>
          {/* The names are long enough to be truncated here, and a proc name IS
              a spell name - so the card doubles as the way to read the rest. */}
          <span className="name" title={row.name}>
            {isSpellName(row.name) ? <Tipped kind="spell" name={row.name} /> : row.name}
          </span>
          <span className="val">
            ×{row.count}
            {row.perMinute !== null && (
              <span className="sub"> · {row.perMinute.toFixed(1)}/min</span>
            )}
          </span>
        </div>
      ))}
    </div>
  )
}
