import { useEffect, useRef } from 'react'
import type { ParsedEvent } from '@shared/parser/types'
import { isSpellName } from '@shared/tooltip'
import { Tipped } from '../components/Tip'

/**
 * The raw stream, parsed into columns.
 *
 * Unparsed lines are kept and shown behind a toggle rather than dropped: they
 * are how you find out the parser is missing a message this server writes, and
 * they are what an alert rule matches when it needs a line the parser has no
 * opinion about.
 */

function time(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(
    d.getSeconds()
  ).padStart(2, '0')}`
}

/**
 * A short, scannable description, with the parts PTDex knows about made
 * hoverable.
 *
 * Returning nodes rather than a string is what lets a spell name inside a
 * sentence carry its own card. Everything else stays plain text, so the column
 * reads exactly as it did before.
 */
function render(e: ParsedEvent): React.ReactNode {
  const skill = e.skill && isSpellName(e.skill) ? <Tipped kind="spell" name={e.skill} /> : e.skill

  if (e.kind === 'loot' && e.item) {
    const who = e.target?.name ?? e.attacker?.name ?? 'someone'
    return (
      <>
        {who} {e.broadcast ? 'discovered' : 'looted'} <Tipped kind="item" name={e.item} className="lootname" />
        {e.tier ? ` (${e.tier})` : ''}
      </>
    )
  }

  const a = e.attacker?.name ?? 'Unattributed'
  const t = e.target?.name ?? ''

  switch (e.kind) {
    case 'melee':
    case 'spell':
    case 'dot':
    case 'heal':
      return (
        <>
          {a} → {t}
          {e.skill ? <> ({skill})</> : null}
        </>
      )
    case 'cast':
      return <>{a} casts {skill}</>
    case 'resist':
      return <>{t || 'target'} resisted {skill}</>
    default:
      return describe(e)
  }
}

/**
 * The lines with nothing hoverable in them. The full original is always in the
 * row's `title`, so nothing here has to be complete - only scannable.
 */
function describe(e: ParsedEvent): string {
  // Named rather than "?": some damage genuinely has no source in the log (a
  // damage shield, an unattributed proc), and "?" read like a parser failure.
  const a = e.attacker?.name ?? 'Unattributed'
  const t = e.target?.name ?? ''
  switch (e.kind) {
    case 'miss':
      return `${a} → ${t} ${e.avoidance ?? 'miss'}`
    case 'death':
      return `${a} slew ${t}`
    case 'zone':
      return `entered ${e.detail ?? ''}`
    case 'level':
      return `level ${e.detail ?? ''}`
    case 'aa':
      return `ability point (${e.amount})`
    case 'group':
      return e.group === 'join'
        ? `${t} joined the group`
        : e.group === 'leave'
          ? `${t} left the group`
          : e.group === 'form'
            ? 'group formed'
            : 'group disbanded'
    default:
      return e.raw.replace(/^\[[^\]]+\]\s*/, '')
  }
}

export function CombatLog({
  lines,
  compact = false
}: {
  lines: ParsedEvent[]
  /** Narrow column: drop the kind column and let the description take it. */
  compact?: boolean
}): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  // Follow the tail, but stop following the moment the user scrolls up to read
  // something - a log that yanks itself back to the bottom mid-read is useless.
  useEffect(() => {
    const el = box.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [lines])

  const onScroll = (): void => {
    const el = box.current
    if (!el) return
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }

  if (lines.length === 0) {
    return <div className="empty">Parsed log lines stream here as they&apos;re written.</div>
  }

  return (
    <div
      className={compact ? 'clog compact' : 'clog'}
      ref={box}
      onScroll={onScroll}
      style={{ height: '100%', overflow: 'auto' }}
    >
      {lines.map((e, i) => (
        <div className="row" key={`${e.source}-${e.ts}-${e.seq}-${i}`} title={e.raw}>
          <span className="t">{time(e.ts)}</span>
          {!compact && <span className={`k ${e.kind}`}>{e.kind}</span>}
          <span className={compact ? `m k-${e.kind}` : 'm'}>{render(e)}</span>
          <span className={e.critical ? 'a crit' : 'a'}>
            {e.amount !== undefined && e.kind !== 'aa' && e.kind !== 'level' ? e.amount.toLocaleString() : ''}
          </span>
        </div>
      ))}
    </div>
  )
}
