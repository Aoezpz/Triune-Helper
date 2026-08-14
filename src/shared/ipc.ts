import type { AlertHit, AlertRule } from './alerts'
import type { BuffsData } from './buffs'
import type { PresenceData } from './presence'
import type { ServerData } from './server'
import type { LeaderboardResult } from './leaderboard'
import type { LevelingData } from './leveling'
import type { LootData } from './loot'
import type { MobsData } from './mobs'
import type { ParsedEvent } from './parser/types'
import type { ProgressState, ProgressSummary, ProgressionData } from './progression'
import type { RosterState } from './roster'
import type { FightSummary } from './stats'
import type { UpdateStatus } from './update'
import { DEFAULT_THEME } from './themes'
import type { ManualTimer, TimersData } from './timers'
import type { TipKind, TipResult } from './tooltip'
import type { ZonesData } from './zones'

/**
 * The single definition of the main <-> renderer contract.
 *
 * Both sides import from here, so a channel can't drift out of sync: the
 * preload bridge, the main-process handlers and the renderer hook all typecheck
 * against these shapes.
 */

/** Where the app looks for logs and how it decides a fight is over. */
export interface Settings {
  /** `<EQ install>\Logs`. Empty until the user picks one (or auto-detect finds it). */
  logFolder: string
  /**
   * Character names whose logs we tail. On a trio server this is normally three.
   * Empty means "every eqlog_*_multiclass.txt in the folder".
   */
  watchedCharacters: string[]
  /**
   * The log that owns third-party events (mobs, other players, other people's
   * pets). Without this, a line seen in all three logs would be counted three
   * times. Empty means "the first watched character, alphabetically".
   */
  primaryCharacter: string
  /**
   * The character you are actually playing right now.
   *
   * Distinct from `primaryCharacter`, which is a merge tie-break. This is the
   * one the app answers questions about: whose group the party strip shows,
   * and which name the Overview headline carries. It matters most when the
   * logs are several accounts that are NOT grouped, where "your party" has no
   * meaning until you say who "you" is. Empty means the first log found.
   */
  activeCharacter: string
  /** Seconds of silence that end a fight. */
  fightTimeoutSeconds: number
  /**
   * Base URL of the PTDex site. Empty disables every network feature and the
   * app runs entirely on its bundled data.
   */
  ptdexBase: string
  /** Server shortname used in log filenames. Project Triune's loginserver is `multiclass`. */
  serverShortname: string
  /** The section the app was last on, so relaunching lands where you left off. */
  lastPage: string
  /** Which Combat view was last open: dashboard or timeline. */
  combatView: string
  /** Colour scheme id - see shared/themes.ts. Applies to the overlays too. */
  theme: string
  /** Persona id for spoken alerts - see shared/voices.ts. */
  voice: string
  /** Master alert volume, 0-1. */
  alertVolume: number
  /**
   * Ask GitHub on launch whether a newer release exists.
   *
   * A setting rather than a given, because it is the app's only call that is
   * not needed for it to do its job. Off means no request is ever made and the
   * version banner never appears.
   */
  updateCheck: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  logFolder: '',
  watchedCharacters: [],
  primaryCharacter: '',
  activeCharacter: '',
  fightTimeoutSeconds: 8,
  // The PTDex deployment for Project Triune. Confirmed from the site itself:
  // this host serves the PTDex wordmark and the Project Triune crest.
  ptdexBase: 'https://nms.bestemu.com',
  serverShortname: 'multiclass',
  lastPage: 'overview',
  combatView: 'dashboard',
  theme: DEFAULT_THEME,
  voice: 'system',
  alertVolume: 1,
  updateCheck: true
}

/** A log file the watcher knows about. */
export interface LogSource {
  character: string
  path: string
  /** Bytes consumed so far - shown in Preferences so a stuck tail is visible. */
  offset: number
  active: boolean
  /** Epoch ms of the last line we read from this file. */
  lastLineAt: number | null
  /**
   * Who this log has seen join its group, excluding the character itself - a
   * client never announces you to your own group.
   */
  group: string[]
}

export interface WatcherStatus {
  folder: string
  sources: LogSource[]
  watching: boolean
  error: string | null
}

/** Outcome of a history rebuild, reported plainly including what was skipped. */
export interface HistoryResult {
  files: number
  lines: number
  sessions: number
  /** Characters whose oldest lines were skipped because the file was huge. */
  truncated: string[]
  from: number | null
  to: number | null
}

/** What the Combat page renders. */
export interface CombatState {
  live: FightSummary | null
  /** Closed fights, newest first, capped so the payload stays small. */
  history: FightSummary[]
  /** Everything since the fight started, aggregated as one "Overall" fight. */
  overall: FightSummary | null
}

/** The always-on-top windows. */
export type OverlayPreset = 'meter' | 'stream'

export interface OverlayBounds {
  x: number
  y: number
  width: number
  height: number
}

/** Outcome of a PTDex sync, per character, reported honestly. */
export interface PtdexSyncResult {
  characters: Array<{
    name: string
    found: boolean
    id: number | null
    level: number | null
    earned: number
    error: string | null
    /** Steps the site shows earned that our bundled data has no entry for. */
    unknownSteps: string[]
  }>
  summary: ProgressSummary | null
  state: ProgressState | null
}

export interface OverlayState {
  /** Locked overlays pass clicks through to the game. */
  locked: boolean
  open: Record<OverlayPreset, boolean>
}

/** Channels the renderer invokes and awaits. */
export interface InvokeMap {
  'window:minimize': [void, void]
  'window:maximize': [void, boolean]
  'window:close': [void, void]
  'window:isMaximized': [void, boolean]
  'settings:get': [void, Settings]
  'settings:set': [Partial<Settings>, Settings]
  'logs:pickFolder': [void, string | null]
  'logs:autodetect': [void, string | null]
  'logs:status': [void, WatcherStatus]
  'logs:restart': [void, WatcherStatus]
  'combat:get': [void, CombatState]
  /** Every event in one fight, pulled on demand for the timeline. */
  'combat:events': [{ fightId: string }, ParsedEvent[]]
  'progress:get': [void, { data: ProgressionData; state: ProgressState; summary: ProgressSummary }]
  'progress:set': [{ key: string; earned: boolean }, ProgressSummary]
  'progress:reset': [void, ProgressSummary]
  /** Pull flags and levels for the watched characters off PTDex. */
  'ptdex:sync': [void, PtdexSyncResult]
  /** Who everyone is: classes, level, guild and rank, cached from PTDex. */
  'roster:get': [void, RosterState]
  /** Re-read these names from PTDex, ignoring the cache. Empty means everyone. */
  'roster:refresh': [{ names?: string[] } | void, RosterState]
  'leaderboard:get': [{ force?: boolean } | void, LeaderboardResult]
  'loot:get': [void, LootData]
  'loot:reset': [void, LootData]
  'zones:get': [void, ZonesData]
  'zones:reset': [void, ZonesData]
  'mobs:get': [void, MobsData]
  'mobs:reset': [void, MobsData]
  /** Manual countdowns, plus spawn windows derived from your own kills. */
  'timers:get': [void, TimersData]
  'timers:save': [ManualTimer[], TimersData]
  /** Pin a mob so its window is listed whether or not it qualifies. */
  'timers:track': [{ mob: string; on: boolean }, TimersData]
  /** World buffs, who is on the server, and what is being auctioned. */
  'server:get': [void, ServerData]
  'server:reset': [void, ServerData]
  /** What you are targeting, and time flagged away from keyboard. */
  'presence:get': [void, PresenceData]
  /** What is currently on your characters, from their effect messages. */
  'buffs:get': [void, BuffsData]
  /** Replay every log on disk into the lifetime ledgers. Clears them first. */
  'history:rebuild': [void, HistoryResult]
  'leveling:get': [void, LevelingData]
  'leveling:reset': [{ character?: string }, LevelingData]
  'overlay:state': [void, OverlayState]
  'overlay:toggle': [{ preset: OverlayPreset; on?: boolean }, OverlayState]
  'overlay:lock': [boolean, OverlayState]
  'alerts:list': [void, AlertRule[]]
  'alerts:save': [AlertRule[], AlertRule[]]
  'alerts:test': [
    { rule: AlertRule; sample: string },
    { matched: boolean; groups: string[]; speech: string | null }
  ]
  /** An item or spell hover card, read from PTDex and cached. */
  'tooltip:get': [{ kind: TipKind; name: string }, TipResult]
  /** Open a URL in the user's browser, never in-app. */
  'shell:open': [string, void]
  /** Is a newer release published? `force` skips the cache. */
  'update:check': [{ force?: boolean } | void, UpdateStatus]
  /** Fetch the new installer. Progress arrives on `update:status`. */
  'update:download': [void, UpdateStatus]
  /** Quit and install what was downloaded. The app does not come back on its own. */
  'update:install': [void, void]
  /** Recent parsed lines for the combat log panel, newest last. */
  'combat:lines': [{ limit?: number; includeUnparsed?: boolean }, ParsedEvent[]]
}

/** Channels main pushes to the renderer. */
export interface EventMap {
  'watcher:status': WatcherStatus
  'window:maximized': boolean
  'combat:state': CombatState
  /** Appended lines only, so the renderer can grow its buffer cheaply. */
  'combat:lines': ParsedEvent[]
  /** A flag was just earned - the keys, plus the recomputed totals. */
  'progress:flagged': { keys: string[]; summary: ProgressSummary; state: ProgressState }
  'overlay:changed': OverlayState
  /** A lookup finished, or the group changed. */
  'roster:changed': RosterState
  /** A rule matched a line. The renderer makes the noise. */
  'alerts:fired': AlertHit
  /** The colour scheme changed. Sent to every window, overlays included. */
  'settings:theme': string
  /** Download progress and phase changes, pushed as they happen. */
  'update:status': UpdateStatus
}

export type InvokeChannel = keyof InvokeMap
export type EventChannel = keyof EventMap

/** Shape exposed on `window.triune` by the preload bridge. */
export interface TriuneBridge {
  invoke<C extends InvokeChannel>(channel: C, payload?: InvokeMap[C][0]): Promise<InvokeMap[C][1]>
  /** Subscribe to a push channel. Returns an unsubscribe function. */
  on<C extends EventChannel>(channel: C, listener: (payload: EventMap[C]) => void): () => void
}
