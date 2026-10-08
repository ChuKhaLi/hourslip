import { addDays, formatMinutes, mondayOf } from '../core/dates.ts'
import { parseEventLines, serializeLine } from '../core/lines.ts'
import { attribute, clientName } from '../core/rules.ts'
import { IMPORTED_FOOTER, weekLines } from '../core/summary.ts'
import { buildTimesheet } from '../core/timesheet.ts'
import { transcriptEvents } from '../core/transcript.ts'
import type { EventLine, Rules, Timesheet } from '../core/types.ts'
import { IMPORTED_INDEX, readImportedIndex, readManual, readSessions } from './files.ts'
import type { ImportEngine } from './paths.ts'
import { findTranscripts, readTranscript } from './transcripts.ts'

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

/** The session id a slimmed line carries, if any. */
function sidOf(line: string): string | null {
  try {
    const o = JSON.parse(line)
    return o && typeof o === 'object' && typeof o.sessionId === 'string' ? o.sessionId : null
  } catch {
    return null
  }
}

/** What the import would write: the client sessions not recorded by hourslip, and what was left out. */
async function scan($: ImportEngine, ctx: Ctx) {
  const recorded = new Set((await names($, `${ctx.home}/events`)).filter(e => e.kind === 'file').map(e => e.name))
  const slim: string[] = []
  const unread = new Set<string>()
  let skipped = 0
  for (const path of await findTranscripts($)) {
    const read = await readTranscript($, path)
    if (!read.ok) {
      skipped++
      // A session a failed file carries is never half-imported from another file of it: the sids of the lines
      // read before it failed, and its file name's (all that is known of a file nothing could be read of).
      unread.add(fileSid(path))
      for (const line of read.partial) {
        const sid = sidOf(line)
        if (sid !== null) unread.add(sid)
      }
      continue
    }
    for (const line of read.lines) slim.push(line)
  }
  const pick = (taken: ReadonlySet<string>) => {
    const bySid = new Map<string, EventLine[]>()
    for (const e of transcriptEvents(slim, ctx.tz, taken).events) {
      let g = bySid.get(e.sid)
      if (!g) bySid.set(e.sid, (g = []))
      g.push(e)
    }
    const sessions: { sid: string; lines: EventLine[] }[] = []
    let noClient = 0
    for (const [sid, lines] of bySid) {
      if (!SID.test(sid) || recorded.has(`${sid}.jsonl`) || unread.has(sid)) continue
      if (!lines.some(l => l.kind === 'prompt' && attribute(ctx.rules, l.cwd, null).client !== null)) { noClient++; continue }
      sessions.push({ sid, lines })
    }
    return { sessions, noClient }
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
  let { sessions, noClient } = pick(taken)
  for (;;) {
    const rewritten = new Set(sessions.map(s => s.sid))
    const next = new Set<string>()
    for (const sid of importedSids) if (!rewritten.has(sid)) for (const id of await heldBy(sid)) next.add(id)
    // `taken` only grows (fewer sessions written, more files kept), so this ends.
    if (next.size === taken.size) break
    taken = next
    ;({ sessions, noClient } = pick(taken))
  }
  const ts = buildTimesheet({ sessions: sessions.map(s => s.lines), manual: [], rules: ctx.rules, from: '0000-01-01', to: '9999-12-31' })
  return { sessions, noClient, skipped, ts }
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
  const { sessions, noClient, skipped, ts } = await scan($, ctx)
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
  const { sessions, skipped, ts } = await scan($, ctx)
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
  // The pane: every week with imported time, read back as every reader reads it (recorded overlap, 12-hour cap).
  const read = await readSessions($, ctx.home, 0)
  const manual = await readManual($, ctx.home)
  const all = buildTimesheet({ sessions: read.sessions, manual: manual.lines, rules: ctx.rules, from: '0000-01-01', to: '9999-12-31' })
  const mondays = [...new Set(all.rows.filter(r => r.imported).map(r => mondayOf(r.date)))].sort()
  if (mondays.length === 0) return { text, openPane: false }
  const lines = [...weeks(all, ctx.rules, mondays, { skipped: read.skipped, manualSkipped: manual.skipped }), '', IMPORTED_FOOTER]
  return { text, openPane: true, pane: { title: 'hourslip · imported', lines } }
}

/** The engine's fs has no delete: each imported file is emptied, and every reader skips an empty one. */
export async function importUndo($: ImportEngine, ctx: Pick<Ctx, 'home'>): Promise<ImportReply> {
  let removed = 0
  const entries = await names($, `${ctx.home}/imported`)
  for (const e of entries) {
    if (e.kind !== 'file' || !e.name.endsWith('.jsonl') || e.size === 0) continue
    await $.fs.write(`${ctx.home}/imported/${e.name}`, '')
    removed++
  }
  if (entries.length > 0) await $.fs.write(`${ctx.home}/imported/${IMPORTED_INDEX}`, '{}\n')
  return { text: removed > 0 ? `Removed ${count(removed, 'imported session')}.` : 'Nothing imported.', openPane: false }
}
