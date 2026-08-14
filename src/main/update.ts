import { app } from 'electron'
import electronUpdater from 'electron-updater'
import {
  CHECK_TTL_MS,
  isBehind,
  readRelease,
  RELEASES_API,
  RELEASES_PAGE,
  type UpdatePhase,
  type UpdateStatus
} from '@shared/update'
import { request } from './http'

// electron-updater is CommonJS; the named export is not reachable through the
// ESM interop, so it comes off the default object.
const { autoUpdater } = electronUpdater

/**
 * Finding, fetching and staging a new version.
 *
 * Two engines behind one status object:
 *
 *   packaged  - electron-updater, which reads `latest.yml` from the newest
 *               GitHub release, downloads the installer, verifies its hash and
 *               swaps the app in on quit.
 *   dev       - a plain read of the GitHub releases API. There is no packaged
 *               installer to replace in a dev run, so the UI falls back to
 *               offering the release page. This exists so the whole flow is
 *               developable without cutting a release for every change.
 *
 * Nothing is automatic. `autoDownload` is off and `autoInstallOnAppQuit` is
 * off, so the app never spends someone's bandwidth or replaces its own binary
 * without a click. That is the difference between an update the user chose and
 * one that happened to them.
 */
export class Updates {
  private latest: string | null = null
  private url = RELEASES_PAGE
  private checkedAt: number | null = null
  private error: string | null = null
  private phase: UpdatePhase = 'unknown'
  private percent = 0
  private inflight: Promise<UpdateStatus> | null = null

  /** Packaged only: a dev run has no installer to swap. */
  private readonly selfInstall = app.isPackaged

  constructor(private readonly onChange: (s: UpdateStatus) => void) {
    if (!this.selfInstall) return

    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    // The app is unsigned, so there is no publisher name to check a downloaded
    // installer against. electron-updater would otherwise refuse the update on
    // Windows. The download is still verified by the SHA-512 in latest.yml,
    // which is what actually protects against a corrupted or swapped file.
    autoUpdater.forceDevUpdateConfig = false

    autoUpdater.on('update-available', (info) => {
      this.latest = info.version
      this.checkedAt = Date.now()
      this.error = null
      this.set('available')
    })
    autoUpdater.on('update-not-available', (info) => {
      this.latest = info.version
      this.checkedAt = Date.now()
      this.error = null
      this.set('current')
    })
    autoUpdater.on('download-progress', (p) => {
      this.percent = Math.round(p.percent)
      this.set('downloading')
    })
    autoUpdater.on('update-downloaded', () => {
      this.percent = 100
      this.set('ready')
    })
    autoUpdater.on('error', (err) => {
      // Never leaves the user stuck on a spinner. The release page is still
      // offered, so a broken updater degrades to the manual route rather than
      // to nothing.
      this.error = `${err.message} — you can still install it by hand from the release page`
      this.set('error')
    })
  }

  private get current(): string {
    return app.getVersion()
  }

  private set(phase: UpdatePhase): void {
    this.phase = phase
    this.onChange(this.status())
  }

  status(): UpdateStatus {
    return {
      current: this.current,
      latest: this.latest,
      phase: this.phase,
      percent: this.percent,
      canSelfInstall: this.selfInstall,
      url: this.url,
      checkedAt: this.checkedAt,
      error: this.error
    }
  }

  /**
   * Look, unless we looked recently.
   *
   * `force` is the Preferences button, which should mean "ask now" rather than
   * "tell me the cached answer again". Concurrent callers share one request, so
   * a page mounting twice does not spend two of the hour's sixty.
   */
  async check(opts: { force?: boolean } = {}): Promise<UpdateStatus> {
    // A download in flight, or one already staged, is not re-checked - that
    // would throw away the progress to ask a question we know the answer to.
    if (this.phase === 'downloading' || this.phase === 'ready') return this.status()

    const fresh = this.checkedAt !== null && Date.now() - this.checkedAt < CHECK_TTL_MS
    if (!opts.force && fresh) return this.status()
    if (this.inflight) return this.inflight

    this.inflight = this.selfInstall ? this.checkPackaged() : this.checkViaApi()
    try {
      return await this.inflight
    } finally {
      this.inflight = null
    }
  }

  private async checkPackaged(): Promise<UpdateStatus> {
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      this.error = `Could not check for updates: ${(err as Error).message}`
      this.set('error')
    }
    return this.status()
  }

  /** The dev path: read the releases API directly and report, but don't fetch. */
  private async checkViaApi(): Promise<UpdateStatus> {
    try {
      const json = await request(RELEASES_API, undefined, {
        Accept: 'application/vnd.github+json',
        // GitHub rejects API requests with no user agent.
        'User-Agent': `Triune-Helper/${this.current}`
      })
      const release = readRelease(json)

      if (!release) {
        // A published release exists but it is a draft or a prerelease, or the
        // payload was not what we expected. Either way we know nothing new,
        // and saying "up to date" would be inventing an answer.
        this.error = 'GitHub replied, but with no published release to compare against'
        this.set('error')
        return this.status()
      }

      this.latest = release.version
      this.url = release.url
      this.checkedAt = Date.now()
      this.error = null
      this.set(isBehind(this.current, release.version) ? 'available' : 'current')
    } catch (err) {
      // The previous good answer is kept. Being briefly offline should not
      // retract an update notice the user has already been shown.
      this.error = `Could not reach GitHub: ${(err as Error).message}`
      this.set('error')
    }
    return this.status()
  }

  /** Fetch the installer. Only meaningful in a packaged build. */
  async download(): Promise<UpdateStatus> {
    if (!this.selfInstall || this.phase !== 'available') return this.status()
    this.percent = 0
    this.set('downloading')
    try {
      await autoUpdater.downloadUpdate()
    } catch (err) {
      this.error = `Download failed: ${(err as Error).message} — the release page still works`
      this.set('error')
    }
    return this.status()
  }

  /**
   * Quit and install what was downloaded.
   *
   * Only ever reached from a button the user pressed while a staged update was
   * sitting there. Returns nothing because the process is gone.
   */
  install(): void {
    if (!this.selfInstall || this.phase !== 'ready') return
    // isSilent false: the NSIS installer shows its progress. This app is
    // unsigned, and a window appearing is what tells someone the thing they
    // clicked is what is running.
    autoUpdater.quitAndInstall(false, true)
  }
}
