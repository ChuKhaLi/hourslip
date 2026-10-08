import type { EventLine } from './types.ts'

export type TranscriptParse = { events: EventLine[]; skipped: number }

type Rec = { ts: string; ms: number; cwd: string; branch: string | null; role: 'prompt' | 'assistant'; key: string; uuid: string | null; n: number }

/** A user line whose text starts so is a local command's output, not a typed prompt. */
const LOCAL_OUTPUT = ['<local-command-stdout>', '<local-command-stderr>']

/**
 * The part of a transcript line that `transcriptEvents` reads, with the message text gone: a typed prompt's
 * text becomes '' (or the local-command marker), any other content []. So the io layer can hold every
 * transcript's lines at once without holding what was said. `transcriptEvents` gives the same result on it.
 */
export function slimTranscriptLine(line: string): string {
  if (line.trim() === '') return ''
  let o: any
  try { o = JSON.parse(line) } catch { return '{' }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return 'null'
  const m = o.message
  const c = m && typeof m === 'object' ? m.content : undefined
  const content = typeof c === 'string' ? (LOCAL_OUTPUT.find(p => c.startsWith(p)) ?? '') : c === undefined ? undefined : []
  const keep = (v: unknown) => (typeof v === 'string' || typeof v === 'boolean' || v === null ? v : undefined)
  return JSON.stringify({
    type: keep(o.type), timestamp: keep(o.timestamp), sessionId: keep(o.sessionId), cwd: keep(o.cwd), gitBranch: keep(o.gitBranch),
    uuid: keep(o.uuid), isMeta: keep(o.isMeta), isSidechain: keep(o.isSidechain),
    message: m && typeof m === 'object' ? { content } : undefined,
  })
}

// Only timestamp, sessionId, cwd, gitBranch (and uuid, for de-duplication) are read from a line;
// message text is inspected for its kind only and never kept. The result does not depend on line order.
// A resumed session's file repeats the earlier session's lines (same uuids, the new sessionId): a uuid seen
// under several sids is kept only under the sid that started first (earliest line), then the one that ended
// first (the copies run on past the original's end), then by sid; so each line is counted once.
// `taken`: prompt uuids already imported under a session this run does not rewrite (its transcript gone or
// unreadable); such a prompt and its turn are dropped from every session, so a copy never counts them again.
export function transcriptEvents(lines: Iterable<string>, tz: number, taken: ReadonlySet<string> = new Set()): TranscriptParse {
  const bySid = new Map<string, Map<string, Rec>>()
  const sidsOf = new Map<string, Set<string>>()
  let skipped = 0
  let n = 0
  for (const line of lines) {
    if (line.trim() === '') continue
    let o: any
    try { o = JSON.parse(line) } catch { skipped++; continue }
    if (!o || typeof o !== 'object' || typeof o.timestamp !== 'string' || typeof o.sessionId !== 'string' || typeof o.type !== 'string') { skipped++; continue }
    const ms = Date.parse(o.timestamp)
    if (Number.isNaN(ms)) { skipped++; continue }
    if (o.isSidechain === true) continue
    let role: Rec['role']
    if (o.type === 'user') {
      const c = o.message?.content
      if (typeof c !== 'string' || o.isMeta === true) continue
      if (LOCAL_OUTPUT.some(p => c.startsWith(p))) continue
      role = 'prompt'
    } else if (o.type === 'assistant') role = 'assistant'
    else continue
    const sid: string = o.sessionId
    const uuid = typeof o.uuid === 'string' && o.uuid !== '' ? o.uuid : null
    const key = uuid !== null ? 'u:' + uuid : `t:${ms}:${role}`
    let g = bySid.get(sid)
    if (!g) bySid.set(sid, (g = new Map()))
    if (g.has(key)) continue
    g.set(key, { ts: o.timestamp, ms, cwd: typeof o.cwd === 'string' ? o.cwd : '', branch: typeof o.gitBranch === 'string' ? o.gitBranch : null, role, key, uuid, n: n++ })
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
  return { events, skipped }
}

export function lineSplitter(): { push(chunk: string): string[]; end(): string[] } {
  let buf = ''
  const strip = (s: string) => (s.endsWith('\r') ? s.slice(0, -1) : s)
  return {
    push(chunk) {
      buf += chunk
      const parts = buf.split('\n')
      buf = parts.pop()!
      return parts.map(strip)
    },
    end() {
      const rest = strip(buf)
      buf = ''
      return rest === '' ? [] : [rest]
    },
  }
}
