import { emptyMeta, lineSplitter, transcriptRecordInto, type TranscriptMeta, type TranscriptRecord } from '../core/transcript.ts'
import { claudeDir, type ImportEngine } from './paths.ts'

/** What `$.fs.read` refuses above (its declaration): such a transcript is read through `$.process.spawn`. */
export const MAX_READ = 4 * 1024 * 1024

type FindEngine = Pick<ImportEngine, 'env'> & { fs: Pick<ImportEngine['fs'], 'list'> }
type ReadEngine = Pick<ImportEngine, 'env' | 'process'> & { fs: Pick<ImportEngine['fs'], 'read' | 'stat'> }

/** A transcript file as its folder's listing gives it. */
export type TranscriptFile = { path: string; size: number; mtimeMs: number }

/** Every `projects/<folder>/<file>.jsonl` under the Claude Code config dir with its listed size and mtime, sorted by path; none when the dir is missing. */
export async function findTranscripts($: FindEngine): Promise<TranscriptFile[]> {
  const root = `${await claudeDir($)}/projects`
  let folders: { name: string; kind: string }[]
  try { folders = await $.fs.list(root) } catch { return [] }
  const out: TranscriptFile[] = []
  for (const folder of folders) {
    if (folder.kind !== 'dir') continue
    let entries: { name: string; kind: string; size: number; mtimeMs: number }[]
    try { entries = await $.fs.list(`${root}/${folder.name}`) } catch { continue }
    for (const e of entries) if (e.kind === 'file' && e.name.endsWith('.jsonl')) out.push({ path: `${root}/${folder.name}/${e.name}`, size: e.size, mtimeMs: e.mtimeMs })
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/**
 * A transcript's records (each kept line read once), or a failure with the session ids of the lines read
 * before it failed (maybe none), or `stopped`: the caller's `stop` said to stop part way (nothing of it kept
 * but the session ids of the lines read so far).
 */
export type TranscriptRead =
  | { ok: true; records: TranscriptRecord[]; meta: TranscriptMeta }
  | { ok: false; stopped: false; sids: Set<string> }
  | { ok: false; stopped: true; sids: Set<string> }

/** How often (in lines) a read asks `stop`; a reader also asks at each piece. */
const STOP_EVERY = 5000

/** Each line read into `meta`, its record (if any) into `out`; false when `stop` said to stop. */
function readLines(lines: Iterable<string>, meta: TranscriptMeta, out: TranscriptRecord[], stop: () => boolean): boolean {
  let i = 0
  for (const line of lines) {
    if (++i % STOP_EVERY === 0 && stop()) return false
    const r = transcriptRecordInto(line, meta)
    if (r) out.push(r)
  }
  return true
}

/**
 * One transcript's records, read as its lines come (no message text is kept), or a failure when it cannot
 * be read here: over 4 MiB (or refused by `$.fs.read`) with no working `$.process.spawn`, a path cmd could
 * misread (Windows), or a reader that fails or stops early. A failure is never part of a file. `stop` is
 * asked now and then while it reads (the hook's time running out): then nothing of the file is kept.
 */
export async function readTranscript($: ReadEngine, path: string, stop: () => boolean = () => false): Promise<TranscriptRead> {
  let size: number | undefined
  try { size = (await $.fs.stat(path)).size } catch { /* no stat here: try the read, and the reader if it refuses */ }
  if (size === undefined || size <= MAX_READ) {
    let text: string | undefined
    try { text = await $.fs.read(path) } catch { /* over 4 MiB after all, or unreadable: the reader below */ }
    if (text !== undefined) {
      const meta = emptyMeta()
      const records: TranscriptRecord[] = []
      if (!readLines(text.split('\n'), meta, records, stop)) return { ok: false, stopped: true, sids: meta.sids }
      return { ok: true, records, meta }
    }
  }
  return spawnRead($, path, stop)
}

/** What cmd.exe reads as syntax even inside an argument (`%`, `!` expand; the rest split or redirect), and control characters. */
const CMD_UNSAFE = /[&|<>^%!()"\u0000-\u001f\u007f]/
/** Claude Code's project folders and session files are named from these alone. */
const PLAIN_NAME = /^[A-Za-z0-9._-]+$/

/** On Windows, a path `cmd /c type` takes as written: no cmd syntax anywhere, plain project-folder and file names. */
export function windowsReadable(path: string): boolean {
  const parts = path.split('/')
  return !CMD_UNSAFE.test(path) && parts.length >= 2 && PLAIN_NAME.test(parts[parts.length - 1]) && PLAIN_NAME.test(parts[parts.length - 2])
}

async function spawnRead($: ReadEngine, path: string, stop: () => boolean): Promise<TranscriptRead> {
  const windows = (await $.env.os()) === 'Windows_NT'
  const records: TranscriptRecord[] = []
  const meta = emptyMeta()
  // The ids of the lines read before a failure: such a session is never half-imported from another file.
  const failed = (): TranscriptRead => ({ ok: false, stopped: false, sids: meta.sids })
  // cmd parses its command line even from argv: a path it could misread is never handed to it.
  if (windows && !windowsReadable(path)) return failed()
  // By argv, never a shell string; `type` wants the native separator. /d: no AutoRun; /v:off: no `!` expansion.
  const argv = windows ? ['cmd', '/d', '/v:off', '/c', 'type', path.replace(/\//g, '\\')] : ['cat', path]
  let it: AsyncIterator<{ stream: string; text: string }, { code: number | null; signal: string | null }> | undefined
  let done = false
  try {
    // Called, never read as a value: the directory's check reads `$.noun.method` only as a call.
    it = $.process.spawn?.({ argv })
    if (!it) return failed()
    const split = lineSplitter()
    for (;;) {
      const r = await it.next()
      if (r.done) {
        done = true
        if (!r.value || r.value.code !== 0 || r.value.signal !== null) return failed()
        break
      }
      if (stop()) return { ok: false, stopped: true, sids: meta.sids }
      // Pieces are text as it came (never a cut character): only lines need putting back together.
      if (r.value.stream === 'stdout' && !readLines(split.push(r.value.text), meta, records, stop)) return { ok: false, stopped: true, sids: meta.sids }
    }
    readLines(split.end(), meta, records, () => false)
    return { ok: true, records, meta }
  } catch {
    return failed()
  } finally {
    // Leaving the loop early ends the child.
    if (it && !done) try { await it.return?.() } catch { /* already gone */ }
  }
}
