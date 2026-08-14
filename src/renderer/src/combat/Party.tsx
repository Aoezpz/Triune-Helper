import { useState } from 'react'
import { classTitle, type Identity, type PartyView } from '@shared/roster'
import { ClassChips } from '../components/Classes'

/**
 * The party strip.
 *
 * The ranked roster below only lists people who did something measurable, which
 * is the right rule for a damage meter and the wrong one for the question "who
 * am I actually playing with". A cleric who spent the pull healing has no row
 * under Out; a group-mate who died in the first three seconds has no row at
 * all. This strip is the answer to that question and nothing else: everyone the
 * logs place in the group, with what they are.
 *
 * "In the group" is meant literally - see partyOf(). Characters you are boxing
 * who are not grouped with the one you are looking at appear underneath, under
 * their own heading, because reading somebody's log is not evidence that they
 * are standing next to you.
 *
 * The classes come from PTDex, because no log line has ever stated one.
 */

const SLOT_VARS = ['var(--slot-1)', 'var(--slot-2)', 'var(--slot-3)']

/** Everything PTDex told us, for the row's tooltip. */
function describe(name: string, id: Identity | undefined): string {
  if (!id) return `${name} — not looked up yet`
  if (!id.found) return `${name} — no character by that name on PTDex`
  return [
    name,
    id.level ? `level ${id.level}` : null,
    id.race,
    classTitle(id),
    id.guild ? `<${id.guild}>` : null,
    id.score !== null ? `score ${id.score}` : null,
    id.trioRank && id.trioOf ? `#${id.trioRank} of ${id.trioOf} running this trio` : null,
    id.overallRank ? `#${id.overallRank} overall` : null
  ]
    .filter(Boolean)
    .join(' · ')
}

export function Party({
  party,
  known,
  order,
  busy
}: {
  party: PartyView
  known: Record<string, Identity>
  /** Your own boxed characters, in their stable order - they get slot colours. */
  order: string[]
  busy: boolean
}): JSX.Element | null {
  const [refreshing, setRefreshing] = useState(false)
  const { members, alsoOnline } = party

  if (members.length === 0 && alsoOnline.length === 0) return null

  const row = (name: string, apart: boolean): JSX.Element => {
    const id = known[name]
    const slot = order.indexOf(name)

    return (
      <div className={apart ? 'pty apart' : 'pty'} key={name} title={describe(name, id)}>
        <span
          className="pty-mark"
          style={{ background: SLOT_VARS[slot] ?? 'var(--line-2)' }}
          aria-hidden="true"
        />
        <span className="pty-name">{name}</span>
        <ClassChips id={id} size="sm" />
        <span className="spacer" />
        {id?.level ? (
          <span className="pty-lvl num">{id.level}</span>
        ) : (
          // The three states are said plainly rather than left blank: an empty
          // slot reads as a bug, and "PTDex has never heard of this character"
          // is a real answer - it is what a brand-new alt looks like.
          <span className="pty-unknown">
            {id === undefined ? '…' : id.found ? '—' : 'unlisted'}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="party">
      <div className="party-head">
        {/* A party of one is a real thing and says so, rather than being
            dressed up as a group with a member count of 1. */}
        <span className="t">{members.length > 1 ? 'Party' : 'Solo'}</span>
        {members.length > 1 && <span className="n num">{members.length}</span>}
        <span className="spacer" />
        {(busy || refreshing) && <span className="party-busy">looking up…</span>}
        <button
          className="party-sync"
          type="button"
          title="Re-read levels and classes from PTDex"
          disabled={busy || refreshing}
          onClick={() => {
            setRefreshing(true)
            void window.triune
              .invoke('roster:refresh', { names: [...members, ...alsoOnline] })
              .finally(() => setRefreshing(false))
          }}
        >
          ⟳
        </button>
      </div>

      <div className="party-rows">
        {members.map((name) => row(name, false))}

        {alsoOnline.length > 0 && (
          <>
            <div className="party-apart" title="Logs being read for characters who are not in this group">
              not grouped
            </div>
            {alsoOnline.map((name) => row(name, true))}
          </>
        )}
      </div>
    </div>
  )
}
