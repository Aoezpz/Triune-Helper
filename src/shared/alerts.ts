import type { ParsedEvent } from './parser/types'

/**
 * Trigger rules.
 *
 * A rule is a pattern over log lines plus what to do when it matches. Rules
 * run against the merged stream, so a line seen by all three boxes fires once,
 * not three times.
 */

export type MatchKind = 'contains' | 'regex'

/** Which lines a rule is allowed to see. */
export type AlertScope = 'all' | 'combat' | 'chat'

export type AlertSound = 'none' | 'chime' | 'alarm' | 'thud' | 'sweep'

export interface AlertRule {
  id: string
  name: string
  enabled: boolean
  match: {
    kind: MatchKind
    value: string
    caseSensitive: boolean
  }
  scope: AlertScope
  sound: AlertSound
  /** Spoken aloud. `$1`..`$9` interpolate regex capture groups. */
  speak: string | null
  /** Show an on-screen banner. */
  banner: boolean
  /**
   * Minimum gap between firings, in ms. Without this a DoT tick or a repeated
   * emote turns one rule into a machine gun.
   */
  debounceMs: number
}

export interface AlertHit {
  rule: AlertRule
  /** The line that matched, verbatim. */
  raw: string
  ts: number
  /** Regex captures, so the spoken text can name the mob that emoted. */
  groups: string[]
  /** Text after `$n` substitution - what actually gets spoken. */
  speech: string | null
}

export function newRule(partial: Partial<AlertRule> = {}): AlertRule {
  return {
    // Not crypto - it only has to be unique within one user's rule list.
    id: `r${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
    name: 'New rule',
    enabled: true,
    match: { kind: 'contains', value: '', caseSensitive: false },
    scope: 'all',
    sound: 'chime',
    speak: null,
    banner: true,
    debounceMs: 3000,
    ...partial
  }
}

/**
 * The rules a fresh install starts with, so the page is never empty and there
 * is a worked example of each match kind. Shared rather than main-only so the
 * UI can offer to restore them after a delete.
 */
export function starterRules(): AlertRule[] {
  return [
    newRule({
      name: 'Charm break',
      match: { kind: 'regex', value: '^Your charm spell has worn off', caseSensitive: false },
      sound: 'alarm',
      speak: 'Charm broke',
      debounceMs: 1000
    }),
    newRule({
      name: 'Your pet died',
      match: { kind: 'contains', value: 'Your pet has been slain', caseSensitive: false },
      sound: 'thud',
      speak: 'Pet down'
    }),
    newRule({
      name: 'You gained a level',
      match: {
        kind: 'regex',
        value: 'You have gained a level! Welcome to level (\\d+)',
        caseSensitive: false
      },
      sound: 'sweep',
      speak: 'Level $1',
      debounceMs: 0
    }),
    newRule({
      name: 'Someone is feared or fleeing',
      enabled: false,
      match: { kind: 'regex', value: '(.+) has fled', caseSensitive: false },
      sound: 'chime',
      speak: null
    })
  ]
}

/** Compile once per rule; an invalid regex disables the rule rather than
 *  throwing on every single log line. */
export function compile(rule: AlertRule): RegExp | null {
  if (rule.match.kind !== 'regex') return null
  try {
    return new RegExp(rule.match.value, rule.match.caseSensitive ? '' : 'i')
  } catch {
    return null
  }
}

function inScope(rule: AlertRule, event: ParsedEvent): boolean {
  if (rule.scope === 'all') return true
  if (rule.scope === 'combat') return event.kind !== 'unparsed' && event.kind !== 'chat'
  return event.kind === 'unparsed' || event.kind === 'chat'
}

/** The text a rule matches against: the line without its timestamp. */
export function lineText(event: ParsedEvent): string {
  return event.raw.replace(/^\[[^\]]*\]\s*/, '')
}

export function matches(rule: AlertRule, event: ParsedEvent, re: RegExp | null): string[] | null {
  if (!rule.enabled || !rule.match.value) return null
  if (!inScope(rule, event)) return null

  const text = lineText(event)

  if (rule.match.kind === 'regex') {
    if (!re) return null
    const m = re.exec(text)
    return m ? m.slice(1) : null
  }

  const needle = rule.match.value
  const hay = rule.match.caseSensitive ? text : text.toLowerCase()
  const find = rule.match.caseSensitive ? needle : needle.toLowerCase()
  return hay.includes(find) ? [] : null
}

/** Replace `$1`..`$9` with capture groups. */
export function interpolate(template: string, groups: string[]): string {
  return template.replace(/\$([1-9])/g, (_, d: string) => groups[Number(d) - 1] ?? '')
}

/**
 * Turn a log line into a starter pattern: numbers and the player's own names
 * become capture groups, so a rule built from one charm break matches the next
 * one too.
 */
export function patternFromLine(line: string, names: string[] = []): string {
  let out = line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  for (const name of names) {
    if (!name) continue
    out = out.split(name).join('(\\w+)')
  }
  return out.replace(/\d+/g, '(\\d+)')
}

/* ---------------------------------------------------------------------------
   Sharing
   ---------------------------------------------------------------------------
   A rule pastes into Discord as one line. The prefix is versioned so a future
   format change can be recognised rather than silently mis-parsed, and the
   payload is base64url so it survives chat clients that mangle `+` and `/`.
--------------------------------------------------------------------------- */

const PREFIX = 'TRIA1:'

/** Fields worth sharing. Ids and enabled-state are local, so they're dropped. */
type Portable = Omit<AlertRule, 'id' | 'enabled'>

export function exportRules(rules: AlertRule[]): string {
  const portable: Portable[] = rules.map(({ id: _id, enabled: _enabled, ...rest }) => rest)
  const json = JSON.stringify(portable.length === 1 ? portable[0] : portable)
  const b64 = btoaUtf8(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return PREFIX + b64
}

export function importRules(text: string): AlertRule[] {
  const trimmed = text.trim()
  if (!trimmed.startsWith(PREFIX)) {
    throw new Error(`Not a Triune alert string - it should start with ${PREFIX}`)
  }
  const b64 = trimmed.slice(PREFIX.length).replace(/-/g, '+').replace(/_/g, '/')
  const json = atobUtf8(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const parsed = JSON.parse(json) as Portable | Portable[]
  const list = Array.isArray(parsed) ? parsed : [parsed]
  return list.map((p) => newRule(p))
}

/* btoa/atob are latin1-only; rules can legitimately contain non-ASCII (mob
   names with accents, emoji in a rule name), so round-trip through UTF-8. */
function btoaUtf8(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function atobUtf8(b64: string): string {
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}
