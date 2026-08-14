/**
 * The raid boards, as the app models them.
 *
 * PTDex owns this data - the game server records every ranked clear itself via
 * QueryServ (see leaderboard_pel_ingest.py), so the app never computes or
 * submits any of it. This is a read-only window onto the site, so you can see
 * where the records stand without leaving the game.
 */

export type Bracket = 'Solo' | 'Duo' | 'Trio'

export interface BoardRow {
  bracket: Bracket | string
  /** "Firesword + Fireshield" - the site already joins group names. */
  names: string
  when: string
  /** Formatted as the site formats it: "0:12", "100,058". */
  value: string
  /** Unit shown beside the value, when the site prints one ("dps"). */
  unit: string | null
  /** Which board this row belongs to: speed, dps, first. */
  kind: string
  /** Deep link back to the encounter on PTDex. */
  encounterId: number | null
}

export interface Board {
  title: string
  note: string | null
  rows: BoardRow[]
}

export interface BossBoards {
  key: string
  name: string
  icon: string | null
  /** The accent the site gives this boss, reused so the two agree. */
  accent: string | null
  meta: string | null
  boards: Board[]
  url: string
}

export interface LeaderboardTotal {
  value: string
  label: string
}

export interface LeaderboardData {
  totals: LeaderboardTotal[]
  bosses: BossBoards[]
  /** Epoch ms this snapshot was fetched. */
  fetchedAt: number
  source: string
}

export interface LeaderboardResult {
  data: LeaderboardData | null
  /** Populated when the fetch or the parse failed; the UI shows it verbatim. */
  error: string | null
  /** True while a fetch is in flight and we're showing a cached copy. */
  stale: boolean
}
