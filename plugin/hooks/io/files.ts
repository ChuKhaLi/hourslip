import { parseEventLines, parseManualLines, serializeLine } from '../core/lines.ts'
import { DEFAULT_RULES, parseRules, type RulesResult } from '../core/rules.ts'
import type { EventLine, ManualLine, Rules } from '../core/types.ts'
import type { AppendEngine, ReadEngine, SessionsEngine, StrictReadEngine, WriteEngine } from './paths.ts'

/** A file that exists but could not be read. Callers that would write afterwards must stop. */
export class ReadError extends Error {
  constructor(readonly path: string, cause: unknown) {
    super(`hourslip could not read ${path}: ${cause instanceof Error ? cause.message : String(cause)}. Nothing was changed.`)
  }
}

/** null only when the file is missing; any other failure throws ReadError. */
async function readStrict(engine: StrictReadEngine, path: string): Promise<string | null> {
  try {
    return await engine.fs.read(path)
  } catch (err) {
    let missing = false
    try { missing = (await engine.fs.exists(path)) === false } catch { /* cannot tell: treat as unreadable */ }
    if (missing) return null
    throw new ReadError(path, err)
  }
}

/** For callers that may write afterwards: a missing file is the default, an unreadable one throws ReadError. */
export async function readRulesStrict(engine: StrictReadEngine, home: string): Promise<RulesResult> {
  const text = await readStrict(engine, `${home}/rules.json`)
  return text === null ? { ok: true, rules: DEFAULT_RULES } : parseRules(text)
}

export async function readManualStrict(engine: StrictReadEngine, home: string): Promise<{ lines: ManualLine[]; skipped: number }> {
  const text = await readStrict(engine, `${home}/manual.jsonl`)
  return text === null ? { lines: [], skipped: 0 } : parseManualLines(text)
}

async function readText(engine: ReadEngine, path: string): Promise<string | null> {
  try {
    return await engine.fs.read(path)
  } catch {
    return null
  }
}

export async function readRules(engine: ReadEngine, home: string): Promise<RulesResult> {
  const text = await readText(engine, `${home}/rules.json`)
  return text === null ? { ok: true, rules: DEFAULT_RULES } : parseRules(text)
}

export async function writeRules(engine: WriteEngine, home: string, rules: Rules): Promise<void> {
  await engine.fs.write(`${home}/rules.json`, JSON.stringify(rules, null, 2) + '\n')
}

async function listOrNone(engine: SessionsEngine, dir: string): Promise<{ name: string; kind: string; size: number; mtimeMs: number }[]> {
  try { return await engine.fs.list(dir) } catch { return [] }
}

/** `imported/index.json`: each imported session's last event time, written by `import --confirm`. */
export const IMPORTED_INDEX = 'index.json'

/** The imported sessions' last event times, or null when the index is missing or unreadable. */
export async function readImportedIndex(engine: ReadEngine, home: string): Promise<Map<string, number> | null> {
  const text = await readText(engine, `${home}/imported/${IMPORTED_INDEX}`)
  if (text === null) return null
  try {
    const o = JSON.parse(text)
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null
    const out = new Map<string, number>()
    for (const [sid, ms] of Object.entries(o)) if (typeof ms === 'number' && Number.isFinite(ms)) out.set(sid, ms)
    return out
  } catch {
    return null
  }
}

/**
 * Recorded sessions (`events/`) and imported ones (`imported/`). An imported session that also has
 * `events/<sid>.jsonl` is read from `events/` only; an empty imported file (what `import --undo` leaves) is none.
 * A recorded file older than `sinceMs` (its mtime) is left out. An imported file's mtime is the import's time,
 * so the index's last event time says instead; a file the index does not name is read, and every one when
 * the index is missing or unreadable.
 */
export async function readSessions(engine: SessionsEngine, home: string, sinceMs: number): Promise<{ sessions: EventLine[][]; skipped: number }> {
  const recorded = (await listOrNone(engine, `${home}/events`)).filter(e => e.kind === 'file' && e.name.endsWith('.jsonl'))
  const recordedNames = new Set(recorded.map(e => e.name))
  const imported = (await listOrNone(engine, `${home}/imported`)).filter(e => e.kind === 'file' && e.name.endsWith('.jsonl') && !recordedNames.has(e.name) && e.size !== 0)
  const index = imported.length > 0 ? await readImportedIndex(engine, home) : null
  const sessions: EventLine[][] = []
  let skipped = 0
  for (const [dir, entries, isImported] of [['events', recorded, false], ['imported', imported, true]] as const) {
    for (const entry of entries) {
      if (isImported) {
        const last = index?.get(entry.name.slice(0, -'.jsonl'.length))
        if (last !== undefined && last < sinceMs) continue
      } else if (entry.mtimeMs < sinceMs) continue
      const text = await readText(engine, `${home}/${dir}/${entry.name}`)
      if (text === null) continue
      const parsed = parseEventLines(text)
      if (isImported && parsed.lines.length === 0 && parsed.skipped === 0) continue
      sessions.push(parsed.lines)
      skipped += parsed.skipped
    }
  }
  return { sessions, skipped }
}

export async function readManual(engine: ReadEngine, home: string): Promise<{ lines: ManualLine[]; skipped: number }> {
  const text = await readText(engine, `${home}/manual.jsonl`)
  return text === null ? { lines: [], skipped: 0 } : parseManualLines(text)
}

export async function appendManual(engine: AppendEngine, home: string, line: ManualLine): Promise<void> {
  const text = (await readStrict(engine, `${home}/manual.jsonl`)) ?? ''
  await engine.fs.write(`${home}/manual.jsonl`, `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${serializeLine(line)}\n`)
}
