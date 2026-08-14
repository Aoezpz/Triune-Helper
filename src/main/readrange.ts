import { createReadStream } from 'node:fs'

/**
 * Read `[start, end)` of a file as UTF-8.
 *
 * Shared by the live tail and the history rebuild, which want the same thing
 * for opposite reasons: the tail reads the few kilobytes since last time, the
 * rebuild reads everything. Both open the file read-only and neither ever
 * writes, which is the promise the whole app rests on.
 */
export function readRange(path: string, start: number, end: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (end <= start) {
      resolve('')
      return
    }
    const chunks: Buffer[] = []
    const stream = createReadStream(path, { start, end: end - 1 })
    stream.on('data', (c) => chunks.push(c as Buffer))
    stream.on('error', reject)
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}
