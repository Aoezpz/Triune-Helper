import type { RawLine } from './types'

/**
 * EverQuest stamps every line `[Wed Aug 11 19:44:02 2026] `, in the client
 * machine's local time and only to the second. That one-second granularity is
 * why every line also carries a `seq`: within a second the file order is the
 * only ordering information that exists, and DPS windows depend on it.
 */
const LINE = /^\[(\w{3}) (\w{3}) {1,2}(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})\] ?(.*)$/

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
}

/**
 * Tokenises one line. Returns null for anything without a valid timestamp -
 * blank lines, and the occasional torn line when we read a file mid-write.
 */
export function tokenize(line: string, source: string, seq: number): RawLine | null {
  const m = LINE.exec(line)
  if (!m) return null

  const month = MONTHS[m[2]]
  if (month === undefined) return null

  const ts = new Date(
    Number(m[7]),
    month,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6])
  ).getTime()

  if (Number.isNaN(ts)) return null

  return { ts, body: m[8], raw: line, source, seq }
}

/**
 * Tokenises a chunk of text, keeping a running sequence number across calls so
 * ordering survives the boundaries between reads.
 */
export function tokenizeChunk(text: string, source: string, startSeq = 0): { lines: RawLine[]; nextSeq: number } {
  const lines: RawLine[] = []
  let seq = startSeq
  for (const raw of text.split('\n')) {
    const trimmed = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (!trimmed) continue
    const tok = tokenize(trimmed, source, seq)
    if (tok) {
      lines.push(tok)
      seq++
    }
  }
  return { lines, nextSeq: seq }
}
