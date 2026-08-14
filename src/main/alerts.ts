import Store from 'electron-store'
import {
  compile,
  interpolate,
  lineText,
  matches,
  starterRules,
  type AlertHit,
  type AlertRule
} from '@shared/alerts'
import type { ParsedEvent } from '@shared/parser/types'

/**
 * Evaluates alert rules against the merged log stream.
 *
 * Runs in main, on the same events the meter sees, so a rule fires once for a
 * line even when three boxed clients all wrote it.
 *
 * Compiled regexes are cached and invalidated whenever the rule list changes -
 * recompiling a dozen patterns for every line of a busy raid parse would show
 * up in the profile, and an invalid pattern would otherwise throw thousands of
 * times a second.
 */

const store = new Store<{ rules: AlertRule[] }>({
  name: 'triune-alerts',
  defaults: { rules: starterRules() },
  clearInvalidConfig: true
})

export class Alerts {
  private rules: AlertRule[] = store.get('rules')
  private compiled = new Map<string, RegExp | null>()
  private lastFired = new Map<string, number>()

  constructor(private onHit: (hit: AlertHit) => void) {
    this.recompile()
  }

  list(): AlertRule[] {
    return this.rules
  }

  save(rules: AlertRule[]): AlertRule[] {
    this.rules = rules
    store.set('rules', rules)
    this.recompile()
    return this.rules
  }

  /** Feed merged events. Returns the hits, so a caller can log or test them. */
  observe(events: ParsedEvent[]): AlertHit[] {
    if (this.rules.length === 0) return []
    const hits: AlertHit[] = []

    for (const event of events) {
      for (const rule of this.rules) {
        const groups = matches(rule, event, this.compiled.get(rule.id) ?? null)
        if (!groups) continue

        const last = this.lastFired.get(rule.id) ?? 0
        // Debounce on the LINE's timestamp, not the wall clock, so replaying a
        // log behaves the same as reading one live.
        if (rule.debounceMs > 0 && event.ts - last < rule.debounceMs) continue
        this.lastFired.set(rule.id, event.ts)

        const hit: AlertHit = {
          rule,
          raw: lineText(event),
          ts: event.ts,
          groups,
          speech: rule.speak ? interpolate(rule.speak, groups) : null
        }
        hits.push(hit)
        this.onHit(hit)
      }
    }

    return hits
  }

  /** Run a rule against sample text, for the editor's live preview. */
  test(rule: AlertRule, sample: string): { matched: boolean; groups: string[]; speech: string | null } {
    const fake: ParsedEvent = {
      kind: 'unparsed',
      ts: Date.now(),
      seq: 0,
      source: 'test',
      raw: sample
    }
    const groups = matches({ ...rule, enabled: true, scope: 'all' }, fake, compile(rule))
    return {
      matched: groups !== null,
      groups: groups ?? [],
      speech: groups && rule.speak ? interpolate(rule.speak, groups) : null
    }
  }

  private recompile(): void {
    this.compiled.clear()
    for (const rule of this.rules) this.compiled.set(rule.id, compile(rule))
  }
}
