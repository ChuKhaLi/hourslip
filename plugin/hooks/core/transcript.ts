import type { EventLine } from './types.ts'

export type TranscriptParse = { events: EventLine[]; skipped: number }

/**
 * A transcript line `transcriptEvents` reads, with only what it reads (and what `imported/` stores): never
 * any content. The import's records cache keeps these, one per line.
 */
export type TranscriptRecord = { ts: string; sid: string; cwd: string; branch: string | null; role: 'prompt' | 'assistant'; uuid: string | null }

type Rec = { ts: string; ms: number; cwd: string; branch: string | null; role: 'prompt' | 'assistant'; key: string; uuid: string | null; n: number }

/** A user line whose text starts so is a local command's output, not a typed prompt. */
const LOCAL_OUTPUT = ['<local-command-stdout>', '<local-command-stderr>']

/**
 * What the import's scan cache needs of a transcript, gathered while its lines are read (one parse): every
 * session id its lines carry and the span of its timestamped lines (records or not).
 */
export type TranscriptMeta = { sids: Set<string>; from: number | null; to: number | null }
export const emptyMeta = (): TranscriptMeta => ({ sids: new Set(), from: null, to: null })

/** What a line is to `transcriptEvents`: malformed (counted as skipped), ignored, or a record. */
const MALFORMED = 0
const IGNORED = 1
type Read = TranscriptRecord | typeof MALFORMED | typeof IGNORED

/** One parse of a line: its record, or why there is none; what it tells goes to `meta` when given. */
function readLine(line: string, meta: TranscriptMeta | undefined): Read {
  if (line.trim() === '') return IGNORED
  let o: any
  try { o = JSON.parse(line) } catch { return MALFORMED }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return MALFORMED
  const sid = typeof o.sessionId === 'string' ? o.sessionId : null
  const ms = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN
  const m = o.message
  const c = m && typeof m === 'object' ? m.content : undefined
  const prompt = o.type === 'user' && typeof c === 'string' && o.isMeta !== true && o.isSidechain !== true && !LOCAL_OUTPUT.some(p => c.startsWith(p))
  if (meta) {
    if (sid !== null) meta.sids.add(sid)
    if (!Number.isNaN(ms)) {
      if (meta.from === null || ms < meta.from) meta.from = ms
      if (meta.to === null || ms > meta.to) meta.to = ms
    }
  }
  if (sid === null || Number.isNaN(ms) || typeof o.type !== 'string') return MALFORMED
  if (o.isSidechain === true) return IGNORED
  const role = prompt ? 'prompt' : o.type === 'assistant' ? 'assistant' : null
  if (role === null) return IGNORED
  return { ts: o.timestamp, sid, cwd: typeof o.cwd === 'string' ? o.cwd : '', branch: typeof o.gitBranch === 'string' ? o.gitBranch : null, role, uuid: typeof o.uuid === 'string' && o.uuid !== '' ? o.uuid : null }
}

/**
 * A line's record (what `transcriptEvents` reads of it), or null for a line it ignores or skips, after the
 * line's session id and time reach `meta` when given. Parse each line once and keep the
 * records: `eventsFromRecords` gives `transcriptEvents`'s events from them, as often as needed.
 */
export function transcriptRecordInto(line: string, meta?: TranscriptMeta): TranscriptRecord | null {
  const r = readLine(line, meta)
  return typeof r === 'object' ? r : null
}

// Only timestamp, sessionId, cwd, gitBranch (and uuid, for de-duplication) are read from a line;
// message text is inspected for its kind only and never kept. The result does not depend on line order.
// A resumed session's file repeats the earlier session's lines (same uuids, the new sessionId): a uuid seen
// under several sids is kept only under the sid that started first (earliest line), then the one that ended
// first (the copies run on past the original's end), then by sid; so each line is counted once.
// `taken`: prompt uuids already imported under a session this run does not rewrite (its transcript gone or
// unreadable); such a prompt and its turn are dropped from every session, so a copy never counts them again.
export function transcriptEvents(lines: Iterable<string>, tz: number, taken: ReadonlySet<string> = new Set()): TranscriptParse {
  const records: TranscriptRecord[] = []
  let skipped = 0
  for (const line of lines) {
    const r = readLine(line, undefined)
    if (r === MALFORMED) skipped++
    else if (r !== IGNORED) records.push(r)
  }
  return { events: eventsFromRecords(records, tz, taken), skipped }
}

/** `transcriptEvents`'s events from records already read (in line order, files one after another). */
export function eventsFromRecords(records: Iterable<TranscriptRecord>, tz: number, taken: ReadonlySet<string> = new Set()): EventLine[] {
  const bySid = new Map<string, Map<string, Rec>>()
  const sidsOf = new Map<string, Set<string>>()
  let n = 0
  for (const r of records) {
    const ms = Date.parse(r.ts)
    if (Number.isNaN(ms)) continue
    const { sid, uuid, role } = r
    const key = uuid !== null ? 'u:' + uuid : `t:${ms}:${role}`
    let g = bySid.get(sid)
    if (!g) bySid.set(sid, (g = new Map()))
    if (g.has(key)) continue
    g.set(key, { ts: r.ts, ms, cwd: r.cwd, branch: r.branch, role, key, uuid, n: n++ })
    if (uuid !== null) {
      let s = sidsOf.get(uuid)
      if (!s) sidsOf.set(uuid, (s = new Set()))
      s.add(sid)
    }
  }
  // Each sid's span over its own lines, before any is given away: who started first, then who ended first.
  const span = new Map<string, { min: number; max: number }>()
  for (const [sid, g] of bySid) {
    let min = Infinity, max = -Infinity
    for (const r of g.values()) { if (r.ms < min) min = r.ms; if (r.ms > max) max = r.ms }
    span.set(sid, { min, max })
  }
  const owner = (sids: Set<string>) => [...sids].sort((a, b) => span.get(a)!.min - span.get(b)!.min || span.get(a)!.max - span.get(b)!.max || (a < b ? -1 : a > b ? 1 : 0))[0]
  for (const [uuid, sids] of sidsOf) {
    if (sids.size < 2) continue
    const keep = owner(sids)
    for (const sid of sids) if (sid !== keep) bySid.get(sid)!.delete('u:' + uuid)
  }
  const events: EventLine[] = []
  for (const sid of [...bySid.keys()].sort()) {
    const recs = [...bySid.get(sid)!.values()].sort((a, b) => a.ms - b.ms || (a.role === b.role ? a.n - b.n : a.role === 'prompt' ? -1 : 1))
    // One id per turn on its prompt and both its events (presence counts Claude time by it; a later import
    // reads it back to know which prompts are taken): the prompt's uuid, else sid and time.
    const mk = (kind: EventLine['kind'], r: Rec, turn: string): EventLine => ({ v: 1, ts: r.ts, tz, sid, kind, cwd: r.cwd, branch: r.branch, turn, src: 'transcript' })
    const turnOf = (r: Rec) => r.uuid ?? `${sid}:${r.ms}`
    let prompt: Rec | undefined
    let first: Rec | undefined
    let last: Rec | undefined
    const flush = () => {
      if (prompt && first && last) events.push(mk('turn-start', first, turnOf(prompt)), mk('turn-end', last, turnOf(prompt)))
      first = last = undefined
    }
    for (const r of recs) {
      if (r.role === 'prompt') {
        flush()
        // A taken prompt's replies go with it: none is given to the prompt before.
        if (r.uuid !== null && taken.has(r.uuid)) { prompt = undefined; continue }
        events.push(mk('prompt', r, turnOf(r)))
        prompt = r
      } else if (prompt) { first ??= r; last = r }
    }
    flush()
  }
  return events
}

/**
 * Lines back together from pieces of text. Each piece is looked at once (only it is searched for newlines;
 * what is pending is kept in parts and joined when its line ends), so a long line in many small pieces costs
 * time in its length, not its length times the pieces. `scanned` is how many characters were searched.
 */
export function lineSplitter(): { push(chunk: string): string[]; end(): string[]; scanned(): number } {
  let pending: string[] = []
  let scanned = 0
  const strip = (s: string) => (s.endsWith('\r') ? s.slice(0, -1) : s)
  return {
    push(chunk) {
      scanned += chunk.length
      let i = chunk.indexOf('\n')
      if (i < 0) {
        if (chunk !== '') pending.push(chunk)
        return []
      }
      pending.push(chunk.slice(0, i))
      const out = [strip(pending.join(''))]
      pending = []
      let start = i + 1
      while ((i = chunk.indexOf('\n', start)) >= 0) {
        out.push(strip(chunk.slice(start, i)))
        start = i + 1
      }
      if (start < chunk.length) pending.push(chunk.slice(start))
      return out
    },
    end() {
      const rest = strip(pending.join(''))
      pending = []
      return rest === '' ? [] : [rest]
    },
    scanned: () => scanned,
  }
}
