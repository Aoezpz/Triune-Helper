/**
 * "Is there a newer build than the one I am running?" - and then fetching it.
 *
 * Nothing here downloads or installs; this file is the pure half, so the
 * version comparison can be tested without a network or an Electron. The doing
 * lives in main/update.ts.
 *
 * The flow is deliberately one click at a time rather than silent. The app
 * never downloads without being asked and never restarts without being asked,
 * because a companion app that swaps its own binary out from under someone
 * mid-raid has misjudged whose machine it is on. What the user gets is: a pill
 * saying a version exists, a click to fetch it, a progress number, and a second
 * click to restart into it.
 */

/** Where the check looks. Public, unauthenticated, read-only. */
export const RELEASES_API = 'https://api.github.com/repos/Aoezpz/Triune-Helper/releases/latest'
export const RELEASES_PAGE = 'https://github.com/Aoezpz/Triune-Helper/releases/latest'

/**
 * How long a successful answer is trusted.
 *
 * Unauthenticated GitHub allows 60 requests an hour per IP, and this app may be
 * left open all day. One check on launch and one every six hours after is far
 * inside that, and nobody needs to know about a release within minutes.
 */
export const CHECK_TTL_MS = 6 * 60 * 60 * 1000

/**
 * Where the update is up to.
 *
 * One field rather than a handful of booleans, because the states are mutually
 * exclusive and a set of flags lets you write "downloading and up to date".
 */
export type UpdatePhase =
  | 'unknown' // not looked yet, or checking is switched off
  | 'current' // looked, nothing newer
  | 'available' // newer exists, not fetched
  | 'downloading'
  | 'ready' // fetched and staged; installs on restart
  | 'error'

export interface UpdateStatus {
  /** The version this build reports. */
  current: string
  /** Newest published version, or null if we have not managed to look. */
  latest: string | null
  phase: UpdatePhase
  /** 0-100 while downloading, otherwise 0. */
  percent: number
  /**
   * Whether this build can fetch and install by itself.
   *
   * False in a dev run, where there is no packaged installer to replace and
   * electron-updater has nothing to work with. The UI falls back to opening the
   * release page, so the feature is still exercisable while developing rather
   * than being a blank space until it is packaged.
   */
  canSelfInstall: boolean
  /** Release page for the newest version - the manual way in, always offered. */
  url: string
  /** Epoch ms of the last successful look, or null. */
  checkedAt: number | null
  /**
   * Why the last look failed, in words, or null.
   *
   * Shown rather than swallowed: "could not reach GitHub" and "you are up to
   * date" are completely different facts, and a silent failure presents the
   * first as the second.
   */
  error: string | null
}

/** True when there is a newer version, whatever stage of fetching it is at. */
export function hasUpdate(s: UpdateStatus): boolean {
  return s.phase === 'available' || s.phase === 'downloading' || s.phase === 'ready'
}

/**
 * Split a version into comparable parts.
 *
 * Handles the `v` prefix GitHub tags carry, and a `-beta.2` style suffix. A
 * missing patch counts as zero, so `0.2` and `0.2.0` are the same version.
 */
function parts(version: string): { nums: number[]; pre: string } {
  const trimmed = version.trim().replace(/^v/i, '')
  const [core, ...rest] = trimmed.split('-')
  const nums = core.split('.').map((n) => {
    const v = Number.parseInt(n, 10)
    return Number.isFinite(v) ? v : 0
  })
  while (nums.length < 3) nums.push(0)
  return { nums, pre: rest.join('-') }
}

/**
 * -1 if a < b, 0 if equal, 1 if a > b.
 *
 * A prerelease sorts BELOW the release it leads to, which is the semver rule
 * and also the intuitive one: 0.2.0-beta.1 came before 0.2.0.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parts(a)
  const pb = parts(b)

  const len = Math.max(pa.nums.length, pb.nums.length)
  for (let i = 0; i < len; i++) {
    const x = pa.nums[i] ?? 0
    const y = pb.nums[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }

  // Same numbers. No prerelease outranks any prerelease.
  if (pa.pre === pb.pre) return 0
  if (!pa.pre) return 1
  if (!pb.pre) return -1
  return pa.pre < pb.pre ? -1 : 1
}

/** True when `latest` is a version worth telling the user about. */
export function isBehind(current: string, latest: string | null): boolean {
  if (!latest) return false
  return compareVersions(current, latest) < 0
}

/**
 * The shape of the GitHub payload we care about, and nothing else.
 *
 * Drafts and prereleases are skipped: publishing a draft should not tell every
 * running copy of the app that it is out of date.
 */
export function readRelease(json: string): { version: string; url: string } | null {
  let body: unknown
  try {
    body = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof body !== 'object' || body === null) return null

  const r = body as { tag_name?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown }
  if (r.draft === true || r.prerelease === true) return null
  if (typeof r.tag_name !== 'string' || !r.tag_name) return null

  return {
    version: r.tag_name.replace(/^v/i, ''),
    url: typeof r.html_url === 'string' && r.html_url ? r.html_url : RELEASES_PAGE
  }
}
