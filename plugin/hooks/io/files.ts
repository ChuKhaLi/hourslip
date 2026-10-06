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
async function readStrict($: StrictReadEngine, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path)
  } catch (err) {
    let missing = false
    try { missing = (await $.fs.exists(path)) === false } catch { /* cannot tell: treat as unreadable */ }
    if (missing) return null
    throw new ReadError(path, err)
  }
}

/** For callers that may write afterwards: a missing file is the default, an unreadable one throws ReadError. */
export async function readRulesStrict($: StrictReadEngine, home: string): Promise<RulesResult> {
  const text = await readStrict($, `${home}/rules.json`)
  return text === null ? { ok: true, rules: DEFAULT_RULES } : parseRules(text)
}

export async function readManualStrict($: StrictReadEngine, home: string): Promise<{ lines: ManualLine[]; skipped: number }> {
  const text = await readStrict($, `${home}/manual.jsonl`)
  return text === null ? { lines: [], skipped: 0 } : parseManualLines(text)
}

async function readText($: ReadEngine, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
}

export async function readRules($: ReadEngine, home: string): Promise<RulesResult> {
  const text = await readText($, `${home}/rules.json`)
  return text === null ? { ok: true, rules: DEFAULT_RULES } : parseRules(text)
}

export async function writeRules($: WriteEngine, home: string, rules: Rules): Promise<void> {
  await $.fs.write(`${home}/rules.json`, JSON.stringify(rules, null, 2) + '\n')
}

export async function readSessions($: SessionsEngine, home: string, sinceMs: number): Promise<{ sessions: EventLine[][]; skipped: number }> {
  let entries: { name: string; kind: string; mtimeMs: number }[] = []
  try { entries = await $.fs.list(`${home}/events`) } catch { return { sessions: [], skipped: 0 } }
  const sessions: EventLine[][] = []
  let skipped = 0
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.jsonl') || entry.mtimeMs < sinceMs) continue
    const text = await readText($, `${home}/events/${entry.name}`)
    if (text === null) continue
    const parsed = parseEventLines(text)
    sessions.push(parsed.lines)
    skipped += parsed.skipped
  }
  return { sessions, skipped }
}

export async function readManual($: ReadEngine, home: string): Promise<{ lines: ManualLine[]; skipped: number }> {
  const text = await readText($, `${home}/manual.jsonl`)
  return text === null ? { lines: [], skipped: 0 } : parseManualLines(text)
}

export async function appendManual($: AppendEngine, home: string, line: ManualLine): Promise<void> {
  const text = (await readStrict($, `${home}/manual.jsonl`)) ?? ''
  await $.fs.write(`${home}/manual.jsonl`, `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${serializeLine(line)}\n`)
}
