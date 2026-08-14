import { net } from 'electron'

/**
 * The app's only way out to the network.
 *
 * Electron's `net` rather than `fetch` or `https`: it goes through Chromium's
 * stack, so it inherits the system proxy and certificate store, which matters
 * for anyone playing from behind a corporate network or a VPN.
 *
 * Every caller is a read of a public PTDex page. Nothing here writes anything
 * anywhere, and no credential is ever attached.
 */
/**
 * A request that never settles is worse than one that fails.
 *
 * Everything upstream of this shows a pending state while it waits - the party
 * strip says "looking up…", a tooltip shows a spinner, a sync button stays
 * disabled - and all of them wait forever if the socket simply hangs, which is
 * the normal failure mode of a site that is up but wedged. Chromium's own
 * timeout is measured in minutes, so this one is explicit.
 */
const TIMEOUT_MS = 12_000

/** A PTDex page is tens of kilobytes. Anything past this is not what we asked for. */
const MAX_BYTES = 4 * 1024 * 1024

export function request(
  url: string,
  form?: Record<string, string>,
  /** Extra request headers. The GitHub API wants an Accept and a User-Agent. */
  headers?: Record<string, string>
): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = form ? new URLSearchParams(form).toString() : null
    const req = net.request({ url, method: body ? 'POST' : 'GET' })
    if (body) req.setHeader('Content-Type', 'application/x-www-form-urlencoded')
    for (const [k, v] of Object.entries(headers ?? {})) req.setHeader(k, v)

    let done = false
    const finish = (err: Error | null, text?: string): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (err) reject(err)
      else resolve(text as string)
    }

    const timer = setTimeout(() => {
      finish(new Error(`Timed out after ${TIMEOUT_MS / 1000}s`))
      try {
        req.abort()
      } catch {
        // Already finished or already aborted; nothing to do.
      }
    }, TIMEOUT_MS)
    // Node keeps the process alive for a pending timer; this one must not hold
    // a quit open while a slow request drains.
    timer.unref?.()

    const chunks: Buffer[] = []
    let size = 0

    req.on('response', (res) => {
      if (res.statusCode < 200 || res.statusCode >= 400) {
        finish(new Error(`${res.statusCode} ${res.statusMessage ?? ''}`.trim()))
        res.on('data', () => {})
        return
      }
      res.on('data', (c) => {
        if (done) return
        const buf = Buffer.from(c)
        size += buf.length
        if (size > MAX_BYTES) {
          finish(new Error('Response too large'))
          try {
            req.abort()
          } catch {
            // See above.
          }
          return
        }
        chunks.push(buf)
      })
      res.on('end', () => finish(null, Buffer.concat(chunks).toString('utf8')))
      res.on('error', (e: Error) => finish(e))
    })
    req.on('error', (e) => finish(e))
    if (body) req.write(body)
    req.end()
  })
}

/** Trim a URL's trailing slash so `${base}/path` never doubles up. */
export const root = (base: string): string => base.replace(/\/$/, '')

/** Collapse whitespace the way HTML does, so scraped text compares cleanly. */
export const clean = (s: string | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()
