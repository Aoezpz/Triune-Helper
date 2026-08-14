import { useState } from 'react'
import type { Identity } from '@shared/roster'
import type { SourceRow } from '@shared/stats'
import { short } from '@shared/stats'
import { isSpellName } from '@shared/tooltip'
import { ClassChips } from '../components/Classes'
import { Tipped } from '../components/Tip'

/**
 * The roster column.
 *
 * The reference app puts combatants in a flat ranked bar list. This goes a
 * step further and makes each combatant a card that opens: the per-skill
 * breakdown is already computed for every source, and burying it behind a
 * separate "breakdown" view means nobody looks at it. Here it is one click
 * away, in place, without losing your position in the list.
 *
 * Slot colour is positional and follows the entity, never its rank - so
 * switching from Outgoing to Healing, where the order changes completely,
 * doesn't repaint everyone.
 */

const SLOT_VARS = ['var(--slot-1)', 'var(--slot-2)', 'var(--slot-3)']

/**
 * What the "Unattributed" row is, said in full.
 *
 * It is not a person and it is not a parser failure. EverQuest has a line that
 * reports damage without saying who caused it - "Diaku Guardian was hit by
 * non-melee for 60 points of damage." - and that is all the information the
 * game gives. Damage shields and procs are the usual culprits.
 *
 * The app attributes these to the most recent spell you were seen casting,
 * within twelve seconds. When nothing was cast, there is nothing to attribute
 * to, and the damage lands here rather than being dropped or guessed at.
 */
const UNATTRIBUTED_HELP =
  'Damage EverQuest logged without naming a source — "… was hit by non-melee for N points of damage." ' +
  'Usually a damage shield or a proc. It counts toward the totals, but the log gives no one to credit it to.'

function roleColor(row: SourceRow, order: string[]): string {
  if (row.kind === 'mob') return 'var(--series-incoming)'
  if (row.kind === 'pet') return 'var(--series-pet)'
  // Neutral, and deliberately not a series colour: wearing the group hue made
  // it look like a fourth group member called "Unattributed".
  if (row.kind === 'unknown') return 'var(--line-2)'
  const i = order.indexOf(row.owner ?? row.name)
  return SLOT_VARS[i] ?? 'var(--series-group)'
}

export function Roster({
  rows,
  order,
  unit = 'dps',
  known = {}
}: {
  rows: SourceRow[]
  /** Stable character order, so slot colours never shuffle. */
  order: string[]
  unit?: 'dps' | 'hps'
  /** PTDex identities by name, for the class chips. */
  known?: Record<string, Identity>
}): JSX.Element {
  const [open, setOpen] = useState<string | null>(null)

  if (rows.length === 0) return <div className="empty">Nothing yet.</div>

  const max = rows[0].damage
  const total = rows.reduce((s, r) => s + r.damage, 0)

  return (
    <div className="roster">
      {rows.map((row, i) => {
        const color = roleColor(row, order)
        const isOpen = open === row.name
        const swings = row.hits + row.misses
        const missRate = swings > 0 ? row.misses / swings : 0

        return (
          <article className={isOpen ? 'rcard open' : 'rcard'} key={row.name}>
            <button
              className="rhead"
              type="button"
              onClick={() => setOpen(isOpen ? null : row.name)}
              aria-expanded={isOpen}
              title={row.kind === 'unknown' ? UNATTRIBUTED_HELP : undefined}
            >
              <span className="rrank">{i + 1}</span>
              <span className="rmark" style={{ background: color }} aria-hidden="true" />
              <span className="rname">
                {row.name}
                {row.kind === 'pet' && <em>pet</em>}
                {row.kind === 'unknown' && <em>no source in log</em>}
              </span>
              {/* Outside .rname, which truncates: a long name should eat itself
                  before it eats the classes. */}
              <ClassChips id={known[row.name]} size="sm" />
              <span className="rtotal">{short(row.damage)}</span>
              <span className="rshare">{total > 0 ? Math.round((row.damage / total) * 100) : 0}%</span>
            </button>

            <div className="rbar">
              <span
                style={{
                  width: `${max > 0 ? Math.max(1.5, (row.damage / max) * 100) : 0}%`,
                  background: color
                }}
              />
            </div>

            <div className="rmeta">
              <span className="num">{Math.round(row.dps).toLocaleString()} {unit}</span>
              {missRate > 0.001 && <span>{(missRate * 100).toFixed(0)}% miss</span>}
              {row.crits > 0 && <span>{Math.round((row.crits / Math.max(1, row.hits)) * 100)}% crit</span>}
              <span className="spacer" />
              <span className="rcaret" aria-hidden="true">
                {isOpen ? '−' : '+'}
              </span>
            </div>

            {isOpen && (
              <div className="rskills">
                {row.skills.length === 0 && <span className="muted">No skill detail.</span>}
                {row.skills.map((s) => (
                  <div className="rskill" key={s.name}>
                    {/* Weapon skills - slash, kick - are not spells and have no
                        PTDex page, so only the named abilities get a card. */}
                    <span className="sname">
                      {isSpellName(s.name) ? <Tipped kind="spell" name={s.name} /> : s.name}
                    </span>
                    <span className="srange">
                      {s.hits > 0 ? `${s.min}–${s.max}` : s.misses > 0 ? `${s.misses} missed` : ''}
                      {s.resists > 0 && ` · ${s.resists} resist`}
                    </span>
                    <span className="sval num">{short(s.damage)}</span>
                  </div>
                ))}
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}
