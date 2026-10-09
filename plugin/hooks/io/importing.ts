import { addDays, formatMinutes, mondayOf } from '../core/dates.ts'
import { parseEventLines, serializeLine } from '../core/lines.ts'
import { attribute, clientName } from '../core/rules.ts'
import { IMPORTED_FOOTER, weekLines } from '../core/summary.ts'
import { buildTimesheet } from '../core/timesheet.ts'
import { eventsFromRecords, type TranscriptRecord } from '../core/transcript.ts'
import type { EventLine, Rules, Timesheet } from '../core/types.ts'
import { VERSION } from '../core/version.ts'
import { IMPORTED_INDEX, readImportedIndex, readManual, readSessions } from './files.ts'
import type { ImportEngine } from './paths.ts'
import { findTranscripts, readTranscript, type TranscriptFile } from './transcripts.ts'

export type ImportReply = { text: string; openPane: boolean; pane?: { title: string; lines: string[] } }
type Ctx = { home: string; rules: Rules; today: string; tz: number }

/** A session id names a file under imported/: nothing but what Claude Code's ids are made of. */
const SID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const billable = (r: { presenceMinutes: number; manualMinutes: number }) => r.presenceMinutes + r.manualMinutes

async function names($: ImportEngine, dir: string): Promise<{ name: string; kind: string; size: number }[]> {
  try { return await $.fs.list(dir) } catch { return [] }
}

/** `1 session`, `2 sessions`. */
const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`
const skippedClause = (k: number) => (k > 0 ? `${count(k, 'transcript')} skipped (cannot be read here).` : null)
const fileSid = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.jsonl$/, '')
const lastMs = (lines: EventLine[]) => lines.reduce((m, l) => Math.max(m, Date.parse(l.ts)), -Infinity)
const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * The scan cache, `import-cache/` in the hourslip home: `index.json` (and `index.<i>.json` for each of its
 * `more` parts, when one file would pass SHARD_MAX_BYTES) lists each transcript read whole, by its listed size
 * and mtime, with the session ids its lines carry (`sids`), those of them that have events when the file is
 * read alone (`counted`, for the "folders with no client" clause), the span of its timestamped lines, whether
 * it has a prompt in a client folder (`candidate`), and the records file that holds its kept lines
 * (`records/<shard>.jsonl`, or `<shard>.<i>.jsonl` for each of `parts`; null when it has none). `failed`: it
 * needed more than a whole run to read, so it is skipped and counted until it changes. Paths, sizes, times,
 * ids, folders and branches: never transcript content.
 */
export const IMPORT_CACHE_DIR = 'import-cache'
const CACHE_V = 2
/** Far under the 4 MiB `$.fs.read` takes, header included. */
export const SHARD_MAX_BYTES = 3.5 * 1024 * 1024
/** Below this much of the hook's own time, no further transcript or step is begun (the scan stops). */
const STOP_MS = 2500
/** Below this, a transcript being read is given up part way (nothing of it kept). */
const ABORT_MS = 1000
/** --confirm writes the index after this many transcripts read, as well as when it stops or ends. */
const FLUSH_EVERY = 100

type CacheEntry = { size: number; mtimeMs: number; sids: string[]; counted: string[]; from: number | null; to: number | null; candidate: boolean; shard: string | null; parts: number; failed?: true }

/**
 * The plugin version (what counts as a prompt, how paths match) and the clients as attribution sees them
 * (ids and paths, by id): another key and the whole cache is ignored.
 */
const cacheKey = (rules: Rules) => [VERSION, rules.clients.map(c => [c.id, c.paths] as const).sort(([a], [b]) => byString(a, b))]
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isIds = (v: unknown): v is string[] => Array.isArray(v) && v.every(s => typeof s === 'string')
const SHARD = /^[0-9a-f]{16}(-[0-9]+)?$/

const cacheDir = (home: string) => `${home}/${IMPORT_CACHE_DIR}`
const indexPath = (home: string, part = 0) => `${cacheDir(home)}/index${part === 0 ? '' : `.${part}`}.json`
const shardPath = (home: string, shard: string, part: number, parts: number) => `${cacheDir(home)}/records/${shard}${parts === 1 ? '' : `.${part}`}.jsonl`
/** Every records file an entry names. */
const shardFiles = (home: string, e: CacheEntry) => (e.shard === null ? [] : Array.from({ length: e.parts }, (_, i) => shardPath(home, e.shard!, i + 1, e.parts)))

/** An index entry as read, or null when its shape is wrong (that transcript is then read again). */
function entryOf(e: any): CacheEntry | null {
  if (!e || typeof e !== 'object' || !isNum(e.size) || !isNum(e.mtimeMs) || !isIds(e.sids) || !isIds(e.counted)) return null
  if (!(e.from === null || isNum(e.from)) || !(e.to === null || isNum(e.to)) || typeof e.candidate !== 'boolean') return null
  if (!(e.shard === null || (typeof e.shard === 'string' && SHARD.test(e.shard))) || !Number.isInteger(e.parts) || (e.shard === null ? e.parts !== 0 : e.parts < 1)) return null
  if (e.failed !== undefined && (e.failed !== true || e.shard !== null)) return null
  return { size: e.size, mtimeMs: e.mtimeMs, sids: e.sids, counted: e.counted, from: e.from, to: e.to, candidate: e.candidate, shard: e.shard, parts: e.parts, ...(e.failed ? { failed: true as const } : {}) }
}

type CacheRead = { files: Map<string, CacheEntry>; texts: string[]; parts: number }

/**
 * The index's entries for this key; missing, unreadable, malformed or for another key: none. A part that is
 * missing or broken loses only its own entries. `texts` is what was read (each part), `parts` how many files.
 */
async function readCache($: ImportEngine, home: string, key: unknown): Promise<CacheRead> {
  const files = new Map<string, CacheEntry>()
  const k = JSON.stringify(key)
  let text: string
  try { text = await $.fs.read(indexPath(home)) } catch { return { files, texts: [], parts: 0 } }
  const texts = [text]
  let more = 0
  try {
    const o = JSON.parse(text)
    if (!o || typeof o !== 'object' || Array.isArray(o) || o.v !== CACHE_V || JSON.stringify(o.key) !== k || !o.files || typeof o.files !== 'object' || Array.isArray(o.files) || !Number.isInteger(o.more) || o.more < 0) return { files, texts, parts: 1 }
    more = o.more
    const take = (fs: Record<string, unknown>) => { for (const [path, e] of Object.entries(fs)) { const entry = entryOf(e); if (entry) files.set(path, entry) } }
    take(o.files)
    for (let part = 1; part <= more; part++) {
      try {
        const t = await $.fs.read(indexPath(home, part))
        texts.push(t)
        const p = JSON.parse(t)
        if (p && typeof p === 'object' && p.v === CACHE_V && JSON.stringify(p.key) === k && p.part === part && p.files && typeof p.files === 'object' && !Array.isArray(p.files)) take(p.files)
      } catch { texts.push('') }
    }
  } catch { /* not JSON: empty */ }
  return { files, texts, parts: 1 + more }
}

/** The index's files: entries in path order, split so none passes SHARD_MAX_BYTES (an entry larger than that alone fills a part). */
function indexTexts(key: unknown, entries: [string, CacheEntry][]): string[] {
  const k = JSON.stringify(key)
  const room = SHARD_MAX_BYTES - 200 - utf8Bytes(k)
  const groups: string[][] = []
  let cur: string[] = []
  let bytes = 0
  for (const [path, e] of entries) {
    const s = `${JSON.stringify(path)}:${JSON.stringify(e)}`
    const b = utf8Bytes(s) + 1
    if (cur.length > 0 && bytes + b > room) { groups.push(cur); cur = []; bytes = 0 }
    cur.push(s)
    bytes += b
  }
  groups.push(cur)
  return groups.map((g, i) => (i === 0
    ? `{"v":${CACHE_V},"key":${k},"more":${groups.length - 1},"files":{${g.join(',')}}}\n`
    : `{"v":${CACHE_V},"key":${k},"part":${i},"files":{${g.join(',')}}}\n`))
}

/** A records file's name for a transcript path: 64 bits of FNV-1a, in hex. */
function shardName(path: string): string {
  let a = 0x811c9dc5
  let b = 0x9747b28c
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193)
    b = Math.imul(b ^ c, 0x01000193)
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')
}

/** A string's length in UTF-8 bytes, as `$.fs.read`'s limit counts it. */
function utf8Bytes(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { n += 4; i++ }
    else n += 3
  }
  return n
}

const recordLine = (r: TranscriptRecord) => JSON.stringify({ ts: r.ts, sid: r.sid, cwd: r.cwd, branch: r.branch, role: r.role, uuid: r.uuid })
const isRecord = (o: any): o is TranscriptRecord => !!o && typeof o === 'object' && typeof o.ts === 'string' && !Number.isNaN(Date.parse(o.ts)) && typeof o.sid === 'string' &&
  typeof o.cwd === 'string' && (o.branch === null || typeof o.branch === 'string') && (o.role === 'prompt' || o.role === 'assistant') && (o.uuid === null || typeof o.uuid === 'string')
/** The first line of each records file: which transcript (path, size, mtime) and which part of how many. */
const header = (file: TranscriptFile, part: number, parts: number) => JSON.stringify({ v: CACHE_V, path: file.path, size: file.size, mtimeMs: file.mtimeMs, part, parts })

/** Writes a transcript's records, split so no file passes SHARD_MAX_BYTES: how many files, or why a write failed. */
async function writeShard($: ImportEngine, home: string, shard: string, file: TranscriptFile, records: TranscriptRecord[]): Promise<number | string> {
  const room = SHARD_MAX_BYTES - utf8Bytes(header(file, 99_999, 99_999)) - 1
  const groups: string[][] = []
  let cur: string[] = []
  let bytes = 0
  for (const r of records) {
    const line = recordLine(r)
    const b = utf8Bytes(line) + 1
    if (cur.length > 0 && bytes + b > room) { groups.push(cur); cur = []; bytes = 0 }
    cur.push(line)
    bytes += b
  }
  if (cur.length > 0) groups.push(cur)
  try {
    for (let i = 0; i < groups.length; i++) await $.fs.write(shardPath(home, shard, i + 1, groups.length), [header(file, i + 1, groups.length), ...groups[i]].join('\n') + '\n')
  } catch (err) {
    return reason(err)
  }
  return groups.length
}

/** A transcript's records from its records files, or null when any is missing, unreadable, malformed or another transcript's. */
async function readShard($: ImportEngine, home: string, file: TranscriptFile, e: CacheEntry): Promise<TranscriptRecord[] | null> {
  if (e.shard === null) return []
  const out: TranscriptRecord[] = []
  try {
    for (let part = 1; part <= e.parts; part++) {
      const lines = (await $.fs.read(shardPath(home, e.shard, part, e.parts))).split('\n')
      if (lines[0] !== header(file, part, e.parts)) return null
      for (let i = 1; i < lines.length; i++) {
        if (lines[i] === '') continue
        const o = JSON.parse(lines[i])
        if (!isRecord(o)) return null
        out.push({ ts: o.ts, sid: o.sid, cwd: o.cwd, branch: o.branch, role: o.role, uuid: o.uuid })
      }
    }
  } catch {
    return null
  }
  return out
}

/** Whether a sorted list holds a value in [from, to]. */
function anyWithin(sorted: number[], from: number, to: number): boolean {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] < from) lo = mid + 1
    else hi = mid
  }
  return lo < sorted.length && sorted[lo] <= to
}


/** Thrown when the hook's own time runs low: the scan stops where it is. */
class OutOfTime extends Error {}

type Scanned = { stopped: false; sessions: { sid: string; lines: EventLine[] }[]; noClient: number; skipped: number; ts: Timesheet }
/** `all`: every transcript was in hand, and the time ran out adding them up. `saveError`: a cache write failed this run. */
type Stopped = { stopped: true; scanned: number; total: number; all: boolean; saveError: string | null }

/** The short reason a write failed. */
const reason = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/^(hourslip: )+/, '').replace(/[.\s]+$/, '').slice(0, 80)

/**
 * What the import would write: the client sessions not recorded by hourslip, and what was left out; or,
 * when the hook's time runs low first, how far the scan got. `write` (--confirm only) writes the scan cache
 * as it goes (records files after each transcript read, the index now and then and at the end), so a scan
 * stopped by the time limit keeps what it read; the preview reads the cache but writes nothing.
 */
async function scan($: ImportEngine, ctx: Ctx, write: boolean): Promise<Scanned | Stopped> {
  const left = () => $.budget?.() ?? Infinity
  const low = () => left() < STOP_MS
  const recorded = new Set((await names($, `${ctx.home}/events`)).filter(e => e.kind === 'file').map(e => e.name))
  const key = cacheKey(ctx.rules)
  const cache = await readCache($, ctx.home, key)
  // This run's view of the index; --confirm writes it back, less what is `unsaved` (a preview's reads, a
  // transcript whose records could not be written) and what is no longer listed.
  const entries = cache.files
  const unsaved = new Set<string>()
  let indexTextsNow = cache.texts
  let indexParts = cache.parts
  let sinceFlush = 0
  let saveError: string | null = null
  const transcripts = await findTranscripts($)
  const listed = new Set(transcripts.map(f => f.path))
  const shardOf = new Map<string, string>()
  for (const [path, e] of entries) if (e.shard !== null) shardOf.set(e.shard, path)
  // Records files an entry no longer names (its transcript gone, changed or unreadable): emptied when the
  // index that drops them is written, unless an entry names them again by then.
  const retired = new Set<string>()
  const retire = (e: CacheEntry | undefined) => { if (e) for (const p of shardFiles(ctx.home, e)) retired.add(p) }
  const save = async (path: string, text: string) => {
    try { await $.fs.write(path, text); return true } catch (err) { saveError ??= reason(err); return false }
  }
  const flush = async () => {
    if (!write) return
    sinceFlush = 0
    for (const [path, e] of entries) if (!listed.has(path)) { retire(e); entries.delete(path) }
    const files = [...entries].filter(([path]) => !unsaved.has(path)).sort(([a], [b]) => byString(a, b))
    if (indexTextsNow.length === 0 && files.length === 0) return
    const texts = indexTexts(key, files)
    if (texts.length === indexTextsNow.length && texts.every((t, i) => t === indexTextsNow[i])) return
    // The parts first, then index.json, which says how many there are; then what nothing names any more.
    for (let i = 1; i < texts.length; i++) if (texts[i] !== indexTextsNow[i] && !(await save(indexPath(ctx.home, i), texts[i]))) return
    if (!(await save(indexPath(ctx.home), texts[0]))) return
    for (let i = texts.length; i < indexParts; i++) await save(indexPath(ctx.home, i), '')
    indexTextsNow = texts
    indexParts = texts.length
    const named = new Set([...entries.values()].flatMap(e => shardFiles(ctx.home, e)))
    for (const p of retired) if (!named.has(p)) await save(p, '')
    retired.clear()
  }
  // Few distinct cwds: each is matched against the clients once.
  const cwdClient = new Map<string, boolean>()
  const inClient = (cwd: string) => {
    let c = cwdClient.get(cwd)
    if (c === undefined) cwdClient.set(cwd, (c = attribute(ctx.rules, cwd, null).client !== null))
    return c
  }
  // Each transcript's records, once read here or loaded from its records files.
  const inHand = new Map<string, TranscriptRecord[]>()
  const failed = new Set<string>()
  const unread = new Set<string>()
  let skipped = 0
  let parsed = 0
  const current = (f: TranscriptFile) => {
    const e = entries.get(f.path)
    return e !== undefined && e.size === f.size && e.mtimeMs === f.mtimeMs
  }
  /** A transcript that cannot be read here: skipped and counted, and none of its sessions half-imported. */
  const fail = (f: TranscriptFile, sids: Iterable<string>) => {
    skipped++
    failed.add(f.path)
    // The sids of the lines read before it failed, and its file name's (all that is known of a file nothing could be read of).
    unread.add(fileSid(f.path))
    for (const sid of sids) unread.add(sid)
  }
  const parse = async (f: TranscriptFile) => {
    if (low()) throw new OutOfTime()
    const first = parsed++ === 0
    const r = await readTranscript($, f.path, () => left() < ABORT_MS)
    if (!r.ok) {
      const old = entries.get(f.path)
      if (r.stopped && !first) throw new OutOfTime()
      retire(old)
      entries.delete(f.path)
      fail(f, r.sids)
      // Given up although it had (nearly) the whole run: it would be every time. Listed as failed for this
      // size and mtime, so it is skipped and counted without being read until it changes.
      if (r.stopped) {
        const sids = [...new Set([...r.sids, fileSid(f.path)])].sort(byString)
        entries.set(f.path, { size: f.size, mtimeMs: f.mtimeMs, sids, counted: [], from: null, to: null, candidate: false, shard: null, parts: 0, failed: true })
        if (!write) unsaved.add(f.path)
      }
      return
    }
    const { meta, records } = r
    // Counted alone: the sessions that have events in this file by itself (see the spec on this edge).
    const counted = [...new Set(eventsFromRecords(records, ctx.tz).map(e => e.sid))].sort(byString)
    const entry: CacheEntry = { size: f.size, mtimeMs: f.mtimeMs, sids: [...meta.sids].sort(byString), counted, from: meta.from, to: meta.to,
      candidate: records.some(x => x.role === 'prompt' && inClient(x.cwd)), shard: null, parts: 0 }
    retire(entries.get(f.path))
    inHand.set(f.path, records)
    entries.set(f.path, entry)
    unsaved.add(f.path)
    if (!write) return
    if (records.length > 0) {
      let shard = shardName(f.path)
      for (let i = 1; shardOf.has(shard) && shardOf.get(shard) !== f.path; i++) shard = `${shardName(f.path)}-${i}`
      const parts = await writeShard($, ctx.home, shard, f, records)
      if (typeof parts === 'string') { saveError ??= parts; return }
      shardOf.set(shard, f.path)
      entry.shard = shard
      entry.parts = parts
    }
    unsaved.delete(f.path)
    if (++sinceFlush >= FLUSH_EVERY) await flush()
  }
  /** A transcript's records: in hand, from its records files, or (when those are missing or broken) read again; null if that fails. */
  const recordsOf = async (f: TranscriptFile): Promise<TranscriptRecord[] | null> => {
    const have = inHand.get(f.path)
    if (have) return have
    if (low()) throw new OutOfTime()
    const loaded = await readShard($, ctx.home, f, entries.get(f.path)!)
    if (loaded) { inHand.set(f.path, loaded); return loaded }
    await parse(f)
    return inHand.get(f.path) ?? null
  }
  let all = false
  try {
    // Every new or changed transcript is read, and only those: an unchanged one's records are in its records file.
    for (const f of transcripts) {
      if (!current(f)) await parse(f)
      else if (entries.get(f.path)!.failed) fail(f, entries.get(f.path)!.sids)
    }
    all = true
    // The transcripts taken together: each with a prompt in a client folder; the rest only when what they
    // hold could change what is imported: a session id that a taken file also carries (one session's lines
    // are taken together across files), or a span holding the time of a prompt of a candidate session taken
    // (a resumed copy repeats its original's lines, times included, and which of the two keeps them depends
    // on both). Each file pulled in may pull in more; each comes from its records file, with no parse.
    const got = new Map<string, TranscriptRecord[]>()
    const readSids = new Set<string>()
    const clientSids = new Set<string>()
    const take = async (f: TranscriptFile) => {
      const recs = await recordsOf(f)
      if (recs === null || failed.has(f.path)) return
      got.set(f.path, recs)
      for (const s of entries.get(f.path)!.sids) readSids.add(s)
      for (const r of recs) if (r.role === 'prompt' && inClient(r.cwd)) clientSids.add(r.sid)
    }
    let rest: TranscriptFile[] = []
    for (const f of transcripts) {
      if (failed.has(f.path)) continue
      if (entries.get(f.path)!.candidate) await take(f)
      else rest.push(f)
    }
    for (let pulled = true; pulled;) {
      if (low()) throw new OutOfTime()
      const times: number[] = []
      for (const recs of got.values()) for (const r of recs) if (r.role === 'prompt' && clientSids.has(r.sid)) times.push(Date.parse(r.ts))
      times.sort((a, b) => a - b)
      const stay: TranscriptFile[] = []
      const pull: TranscriptFile[] = []
      for (const f of rest) {
        if (failed.has(f.path)) continue
        const e = entries.get(f.path)!
        const shares = e.sids.some(s => readSids.has(s))
        const overlaps = e.from !== null && e.to !== null && anyWithin(times, e.from, e.to)
        ;(shares || overlaps ? pull : stay).push(f)
      }
      rest = stay
      for (const f of pull) await take(f)
      pulled = pull.length > 0
    }
    rest = rest.filter(f => !failed.has(f.path))
    const records = [...got.keys()].sort(byString).flatMap(path => got.get(path)!)
    const pick = (taken: ReadonlySet<string>) => {
      if (low()) throw new OutOfTime()
      const bySid = new Map<string, EventLine[]>()
      for (const e of eventsFromRecords(records, ctx.tz, taken)) {
        let g = bySid.get(e.sid)
        if (!g) bySid.set(e.sid, (g = []))
        g.push(e)
      }
      const sessions: { sid: string; lines: EventLine[] }[] = []
      const noClient: string[] = []
      for (const [sid, lines] of bySid) {
        if (!SID.test(sid) || recorded.has(`${sid}.jsonl`) || unread.has(sid)) continue
        if (!lines.some(l => l.kind === 'prompt' && inClient(l.cwd))) { noClient.push(sid); continue }
        sessions.push({ sid, lines })
      }
      return { sessions, noClient, seen: new Set(bySid.keys()) }
    }
    // A prompt already in an imported file this run does not rewrite (its transcript since cleaned up, or not
    // readable here) stays there: a resumed copy of it is not imported again. Dropping prompts can leave a
    // session out, whose file then keeps its prompts too, so this runs until nothing more is taken.
    const importedSids = (await names($, `${ctx.home}/imported`)).filter(e => e.kind === 'file' && e.name.endsWith('.jsonl') && e.size !== 0).map(e => e.name.slice(0, -'.jsonl'.length))
    const held = new Map<string, string[]>()
    const heldBy = async (sid: string) => {
      let ids = held.get(sid)
      if (!ids) {
        // An imported file that cannot be read is skipped by every reader too: it holds nothing.
        try { ids = parseEventLines(await $.fs.read(`${ctx.home}/imported/${sid}.jsonl`)).lines.flatMap(l => (l.turn !== undefined ? [l.turn] : [])) } catch { ids = [] }
        held.set(sid, ids)
      }
      return ids
    }
    let taken = new Set<string>()
    let { sessions, noClient, seen } = pick(taken)
    for (;;) {
      const rewritten = new Set(sessions.map(s => s.sid))
      const next = new Set<string>()
      for (const sid of importedSids) if (!rewritten.has(sid)) for (const id of await heldBy(sid)) next.add(id)
      // `taken` only grows (fewer sessions written, more files kept), so this ends.
      if (next.size === taken.size) break
      taken = next
      ;({ sessions, noClient, seen } = pick(taken))
    }
    if (low()) throw new OutOfTime()
    const ts = buildTimesheet({ sessions: sessions.map(s => s.lines), manual: [], rules: ctx.rules, from: '0000-01-01', to: '9999-12-31' })
    // The files left out share no id with a file taken here: the sessions each has by itself are counted,
    // unless recorded by hourslip since or carried by a file that failed.
    const more = new Set<string>()
    for (const f of rest) for (const sid of entries.get(f.path)?.counted ?? []) if (!seen.has(sid) && SID.test(sid) && !recorded.has(`${sid}.jsonl`) && !unread.has(sid)) more.add(sid)
    await flush()
    return { stopped: false, sessions, noClient: noClient.length + more.size, skipped, ts }
  } catch (err) {
    if (!(err instanceof OutOfTime)) throw err
    await flush()
    const scanned = transcripts.filter(f => failed.has(f.path) || current(f)).length
    return { stopped: true, scanned, total: transcripts.length, all: all && scanned === transcripts.length, saveError }
  }
}

/** The given weeks as the pane draws them, a blank line between, without the per-week imported footer. */
function weeks(ts: Timesheet, rules: Rules, mondays: string[], notes: { skipped: number; manualSkipped: number }): string[] {
  const out: string[] = []
  for (const monday of mondays) {
    if (out.length > 0) out.push('')
    out.push(...weekLines(ts, rules, monday, { ...notes, rulesError: null }).filter(l => l !== IMPORTED_FOOTER))
  }
  return out
}

export async function importPreview($: ImportEngine, ctx: Ctx): Promise<ImportReply> {
  const scanned = await scan($, ctx, false)
  if (scanned.stopped) return { text: `Scanned ${scanned.scanned} of ${scanned.total} transcripts before Claude Code's time limit for a command. Nothing written yet. Run /hourslip import --confirm to scan in steps and import when done.`, openPane: false }
  const { sessions, noClient, skipped, ts } = scanned
  const first = ts.rows[0]?.date
  const last = ts.rows.at(-1)?.date
  const perClient = new Map<string | null, number>()
  for (const r of ts.rows) perClient.set(r.client, (perClient.get(r.client) ?? 0) + billable(r))
  const order = [...ctx.rules.clients.map(c => c.id as string | null), null].filter(c => perClient.has(c))
  const parts: string[] = []
  if (sessions.length > 0 && first && last) parts.push(`Found ${count(sessions.length, 'session')} from ${first} to ${last}: ${order.map(c => `${clientName(ctx.rules, c)} ${formatMinutes(perClient.get(c)!)}`).join(', ')}.`)
  else parts.push('Found no sessions to import.')
  if (noClient > 0) parts.push(`${count(noClient, 'session')} in folders with no client (add one with /hourslip client add, then import again).`)
  const skippedText = skippedClause(skipped)
  if (skippedText) parts.push(skippedText)
  const out = [parts.join(' ')]
  if (sessions.length > 0) out.push('Nothing written yet. Import: /hourslip import --confirm')
  if (!(first !== undefined && first < addDays(ctx.today, -25))) out.push('Claude Code keeps transcripts 30 days by default (cleanupPeriodDays).')
  const text = out.join('\n')
  if (!first || !last) return { text, openPane: false }
  // The pane: the weeks of what would be imported (not imported yet, so without the --undo footer).
  const mondays: string[] = []
  for (let monday = mondayOf(first); monday <= last; monday = addDays(monday, 7)) mondays.push(monday)
  const lines = ['Import preview: nothing written yet.', '', ...weeks(ts, ctx.rules, mondays, { skipped: 0, manualSkipped: 0 })]
  return { text, openPane: true, pane: { title: 'hourslip · import preview', lines } }
}

/**
 * `imported/index.json` after writing `written`: every non-empty imported file's last event time, so readers
 * skip an old imported file without reading it (its mtime is the import's). A file imported earlier and not
 * found this time (its transcript since cleaned up) keeps its entry, or gets one from its own lines.
 */
async function writeIndex($: ImportEngine, home: string, written: { sid: string; lines: EventLine[] }[]): Promise<void> {
  const earlier = (await readImportedIndex($, home)) ?? new Map<string, number>()
  const now = new Map(written.map(s => [s.sid, lastMs(s.lines)]))
  const index = new Map<string, number>()
  for (const e of await names($, `${home}/imported`)) {
    if (e.kind !== 'file' || !e.name.endsWith('.jsonl') || e.size === 0) continue
    const sid = e.name.slice(0, -'.jsonl'.length)
    let ms = now.get(sid) ?? earlier.get(sid)
    if (ms === undefined) {
      // Not in the index: readers read such a file anyway, so a failure here only costs that.
      try { ms = lastMs(parseEventLines(await $.fs.read(`${home}/imported/${e.name}`)).lines) } catch { continue }
    }
    if (Number.isFinite(ms)) index.set(sid, ms)
  }
  for (const [sid, ms] of now) if (!index.has(sid) && Number.isFinite(ms)) index.set(sid, ms)
  const out = Object.fromEntries([...index].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  await $.fs.write(`${home}/imported/${IMPORTED_INDEX}`, JSON.stringify(out) + '\n')
}

export async function importConfirm($: ImportEngine, ctx: Ctx): Promise<ImportReply> {
  const scanned = await scan($, ctx, true)
  // Stopped by the time limit: what it read is in the scan cache, and nothing is imported yet.
  if (scanned.stopped) {
    const text = scanned.all
      ? `All ${scanned.total} transcripts scanned; Claude Code's time limit ran out while adding them up. Run /hourslip import --confirm again to import.`
      : `Scanned ${scanned.scanned} of ${scanned.total} transcripts (${scanned.total - scanned.scanned} left). Run /hourslip import --confirm again to continue; nothing is imported until the scan is complete.`
    return { text: scanned.saveError === null ? text : `${text} Progress could not be saved: ${scanned.saveError}.`, openPane: false }
  }
  const { sessions, skipped, ts } = scanned
  const skippedText = skippedClause(skipped)
  const say = (text: string) => [text, ...(skippedText ? [skippedText] : [])].join(' ')
  if (sessions.length === 0) return { text: say('Nothing to import.'), openPane: false }
  // Before any session file: the index without the sessions about to be written, so a write that fails
  // part way never leaves an entry older than a file already written (readers read a file it does not name).
  const earlier = await readImportedIndex($, ctx.home)
  if (earlier && sessions.some(s => earlier.has(s.sid))) {
    const kept = Object.fromEntries([...earlier].filter(([sid]) => !sessions.some(s => s.sid === sid)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    await $.fs.write(`${ctx.home}/imported/${IMPORTED_INDEX}`, JSON.stringify(kept) + '\n')
  }
  // One whole file per session ($.fs.write replaces it): importing again replaces the earlier import.
  for (const s of sessions) await $.fs.write(`${ctx.home}/imported/${s.sid}.jsonl`, s.lines.map(serializeLine).join('\n') + '\n')
  await writeIndex($, ctx.home, sessions)
  const total = ts.rows.reduce((sum, r) => sum + billable(r), 0)
  const text = say(`Imported ${count(sessions.length, 'session')} (${formatMinutes(total)}). Reports mark these days "from Claude Code transcripts".`)
  // The pane: every week with imported time, read back as every reader reads it (recorded overlap, 12-hour cap);
  // left out when the hook's time runs low (the import is written, and the pane shows it anyway).
  if (($.budget?.() ?? Infinity) < STOP_MS) return { text, openPane: false }
  const read = await readSessions($, ctx.home, 0)
  const manual = await readManual($, ctx.home)
  const all = buildTimesheet({ sessions: read.sessions, manual: manual.lines, rules: ctx.rules, from: '0000-01-01', to: '9999-12-31' })
  const mondays = [...new Set(all.rows.filter(r => r.imported).map(r => mondayOf(r.date)))].sort()
  if (mondays.length === 0) return { text, openPane: false }
  const lines = [...weeks(all, ctx.rules, mondays, { skipped: read.skipped, manualSkipped: manual.skipped }), '', IMPORTED_FOOTER]
  return { text, openPane: true, pane: { title: 'hourslip · imported', lines } }
}

/**
 * The engine's fs has no delete: each imported file is emptied, and every reader skips an empty one. The scan
 * cache goes too (its index written as {}, every records file emptied): it lists every session on this machine.
 */
export async function importUndo($: ImportEngine, ctx: Pick<Ctx, 'home'>): Promise<ImportReply> {
  let removed = 0
  const entries = await names($, `${ctx.home}/imported`)
  for (const e of entries) {
    if (e.kind !== 'file' || !e.name.endsWith('.jsonl') || e.size === 0) continue
    await $.fs.write(`${ctx.home}/imported/${e.name}`, '')
    removed++
  }
  if (entries.length > 0) await $.fs.write(`${ctx.home}/imported/${IMPORTED_INDEX}`, '{}\n')
  let cache = false
  for (const dir of [cacheDir(ctx.home), `${cacheDir(ctx.home)}/records`]) {
    for (const e of await names($, dir)) {
      if (e.kind !== 'file') continue
      const path = `${dir}/${e.name}`
      const empty = path === indexPath(ctx.home) ? '{}\n' : ''
      if (e.size === 0 || (empty !== '' && e.size === empty.length)) continue
      await $.fs.write(path, empty)
      cache = true
    }
  }
  const text = removed > 0 ? `Removed ${count(removed, 'imported session')}${cache ? ' and the import cache' : ''}.` : `Nothing imported.${cache ? ' Removed the import cache.' : ''}`
  return { text, openPane: false }
}
