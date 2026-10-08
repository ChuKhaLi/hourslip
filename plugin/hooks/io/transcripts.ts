import { lineSplitter, slimTranscriptLine } from '../core/transcript.ts'
import { claudeDir, type ImportEngine } from './paths.ts'

/** What `$.fs.read` refuses above (its declaration): such a transcript is read through `$.process.spawn`. */
export const MAX_READ = 4 * 1024 * 1024

type FindEngine = Pick<ImportEngine, 'env'> & { fs: Pick<ImportEngine['fs'], 'list'> }
type ReadEngine = Pick<ImportEngine, 'env' | 'process'> & { fs: Pick<ImportEngine['fs'], 'read' | 'stat'> }

/** Every `projects/<folder>/<file>.jsonl` under the Claude Code config dir, sorted; none when the dir is missing. */
export async function findTranscripts($: FindEngine): Promise<string[]> {
  const root = `${await claudeDir($)}/projects`
  let folders: { name: string; kind: string }[]
  try { folders = await $.fs.list(root) } catch { return [] }
  const out: string[] = []
  for (const folder of folders) {
    if (folder.kind !== 'dir') continue
    let entries: { name: string; kind: string }[]
    try { entries = await $.fs.list(`${root}/${folder.name}`) } catch { continue }
    for (const e of entries) if (e.kind === 'file' && e.name.endsWith('.jsonl')) out.push(`${root}/${folder.name}/${e.name}`)
  }
  return out.sort()
}

/** A transcript's lines, or, when it could not be read whole, the lines read before it failed (maybe none). */
export type TranscriptRead = { ok: true; lines: string[] } | { ok: false; partial: string[] }

/**
 * One transcript's lines, slimmed as they are read (no message text is kept), or a failure when it cannot
 * be read here: over 4 MiB (or refused by `$.fs.read`) with no working `$.process.spawn`, a path cmd could
 * misread (Windows), or a reader that fails or stops early. A failure is never part of a file.
 */
export async function readTranscript($: ReadEngine, path: string): Promise<TranscriptRead> {
  let size: number | undefined
  try { size = (await $.fs.stat(path)).size } catch { /* no stat here: try the read, and the reader if it refuses */ }
  if (size === undefined || size <= MAX_READ) {
    try {
      return { ok: true, lines: (await $.fs.read(path)).split('\n').map(slimTranscriptLine) }
    } catch { /* over 4 MiB after all, or unreadable: the reader below */ }
  }
  return spawnRead($, path)
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

async function spawnRead($: ReadEngine, path: string): Promise<TranscriptRead> {
  const windows = (await $.env.os()) === 'Windows_NT'
  const out: string[] = []
  const failed: TranscriptRead = { ok: false, partial: out }
  // cmd parses its command line even from argv: a path it could misread is never handed to it.
  if (windows && !windowsReadable(path)) return failed
  // By argv, never a shell string; `type` wants the native separator. /d: no AutoRun; /v:off: no `!` expansion.
  const argv = windows ? ['cmd', '/d', '/v:off', '/c', 'type', path.replace(/\//g, '\\')] : ['cat', path]
  let it: AsyncIterator<{ stream: string; text: string }, { code: number | null; signal: string | null }> | undefined
  let done = false
  try {
    if (!$.process.spawn) return failed
    it = $.process.spawn({ argv })
    const split = lineSplitter()
    for (;;) {
      const r = await it.next()
      if (r.done) {
        done = true
        if (!r.value || r.value.code !== 0 || r.value.signal !== null) return failed
        break
      }
      // Pieces are text as it came (never a cut character): only lines need putting back together.
      if (r.value.stream === 'stdout') for (const line of split.push(r.value.text)) out.push(slimTranscriptLine(line))
    }
    for (const line of split.end()) out.push(slimTranscriptLine(line))
    return { ok: true, lines: out }
  } catch {
    return failed
  } finally {
    // Leaving the loop early ends the child.
    if (it && !done) try { await it.return?.() } catch { /* already gone */ }
  }
}
