import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  hasUpdate,
  isBehind,
  readRelease,
  type UpdateStatus
} from '../src/shared/update'

/**
 * The update check.
 *
 * Getting this wrong is quiet in both directions and both are bad: too eager
 * and every user is nagged forever about a release they already have, too shy
 * and a build with a real fix in it never reaches anybody. The comparison is
 * the whole feature, so it is the thing under test.
 */

describe('comparing versions', () => {
  it('orders by each number in turn', () => {
    expect(compareVersions('0.1.0', '0.2.0')).toBe(-1)
    expect(compareVersions('0.2.0', '0.1.0')).toBe(1)
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0)
  })

  /** 10 > 9, which a string comparison gets backwards. */
  it('compares numerically, not alphabetically', () => {
    expect(compareVersions('0.9.0', '0.10.0')).toBe(-1)
    expect(compareVersions('1.0.0', '0.99.99')).toBe(1)
    expect(compareVersions('0.2.9', '0.2.10')).toBe(-1)
  })

  /** GitHub tags are `v0.1.0`; package.json says `0.1.0`. */
  it('ignores a v prefix on either side', () => {
    expect(compareVersions('v0.1.0', '0.1.0')).toBe(0)
    expect(compareVersions('0.1.0', 'V0.2.0')).toBe(-1)
  })

  it('treats a missing patch as zero', () => {
    expect(compareVersions('0.2', '0.2.0')).toBe(0)
    expect(compareVersions('1', '1.0.0')).toBe(0)
  })

  /** Semver's rule, and the intuitive one: the beta came first. */
  it('sorts a prerelease below the release it leads to', () => {
    expect(compareVersions('0.2.0-beta.1', '0.2.0')).toBe(-1)
    expect(compareVersions('0.2.0', '0.2.0-beta.1')).toBe(1)
    expect(compareVersions('0.2.0-beta.1', '0.2.0-beta.2')).toBe(-1)
  })
})

describe('deciding whether to show the banner', () => {
  it('shows it only when the published version is genuinely newer', () => {
    expect(isBehind('0.1.0', '0.2.0')).toBe(true)
    expect(isBehind('0.2.0', '0.2.0')).toBe(false)
  })

  /**
   * The dangerous direction. A running dev build ahead of the last release
   * must not be told to "update" to something older than itself.
   */
  it('never nags someone who is ahead of the published release', () => {
    expect(isBehind('0.3.0', '0.2.0')).toBe(false)
    expect(isBehind('0.2.0', '0.2.0-beta.1')).toBe(false)
  })

  /** A failed check knows nothing, and nothing is not "out of date". */
  it('shows nothing when the check never got an answer', () => {
    expect(isBehind('0.1.0', null)).toBe(false)
  })
})

describe('when the pill is shown', () => {
  const at = (phase: UpdateStatus['phase']): UpdateStatus => ({
    current: '0.1.0',
    latest: '0.2.0',
    phase,
    percent: 0,
    canSelfInstall: true,
    url: 'https://example.test',
    checkedAt: 1,
    error: null
  })

  /** Once found, it stays visible through fetching and staging. */
  it('stays up through every stage of getting the update', () => {
    expect(hasUpdate(at('available'))).toBe(true)
    expect(hasUpdate(at('downloading'))).toBe(true)
    expect(hasUpdate(at('ready'))).toBe(true)
  })

  /**
   * A failed check must not render as an update. It is the same mistake as
   * treating silence as "up to date", pointing the other way - and here it
   * would offer a download that cannot work.
   */
  it('is hidden when there is nothing to offer', () => {
    expect(hasUpdate(at('current'))).toBe(false)
    expect(hasUpdate(at('unknown'))).toBe(false)
    expect(hasUpdate(at('error'))).toBe(false)
  })
})

describe('reading the GitHub payload', () => {
  it('takes the tag and the page url', () => {
    const r = readRelease(
      JSON.stringify({ tag_name: 'v0.2.0', html_url: 'https://example.test/releases/v0.2.0' })
    )
    expect(r).toEqual({ version: '0.2.0', url: 'https://example.test/releases/v0.2.0' })
  })

  /**
   * Drafts are unpublished work. Saving one must not announce it to every
   * running copy of the app.
   */
  it('ignores drafts and prereleases', () => {
    expect(readRelease(JSON.stringify({ tag_name: 'v0.3.0', draft: true }))).toBeNull()
    expect(readRelease(JSON.stringify({ tag_name: 'v0.3.0', prerelease: true }))).toBeNull()
  })

  it('returns null rather than throwing on anything unexpected', () => {
    expect(readRelease('not json at all')).toBeNull()
    expect(readRelease('null')).toBeNull()
    expect(readRelease(JSON.stringify({ message: 'Not Found' }))).toBeNull()
    expect(readRelease(JSON.stringify({ tag_name: '' }))).toBeNull()
  })
})
