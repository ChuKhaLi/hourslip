import { parseCommand } from '../core/args.ts'
import { csvName } from '../core/names.ts'
import { daysCsv, ticketsCsv } from '../core/csv.ts'
import { addDays, localDate, mondayOf, monthBounds } from '../core/dates.ts'
import { renderReport } from '../core/report.ts'
import { DEFAULT_RULES, clientName } from '../core/rules.ts'
import { buildSnapshot } from '../core/snapshot.ts'
import { weekLines } from '../core/summary.ts'
import { buildTimesheet } from '../core/timesheet.ts'
import { ReadError, appendManual, readManual, readManualStrict, readRules, readRulesStrict, readSessions, writeRules } from './files.ts'
import { refreshStatus } from './status.ts'
import { commitsFor } from './git.ts'
import { homeDir, type CommandEngine, type PaneEngine } from './paths.ts'
import type { Recorder } from './recorder.ts'

const VERSION = '0.1.1'

async function context($: PaneEngine | CommandEngine, strict = false) {
  const home = await homeDir($)
  // Commands that write (or export) must not mistake an unreadable rules.json for a missing one.
  const r = strict ? await readRulesStrict($ as CommandEngine, home) : await readRules($, home)
  const rules = r.ok ? r.rules : DEFAULT_RULES
  const now = await $.clock.now()
  const tz = rules.tzOffsetMinutes ?? -new Date().getTimezoneOffset()
  return { home, r, rules, today: localDate(now, tz) }
}

export async function paneLines($: PaneEngine): Promise<string[]> {
  const { home, r, rules, today } = await context($)
  const monday = mondayOf(today)
  const { sessions, skipped } = await readSessions($, home, Date.parse(`${monday}T00:00:00Z`) - 86_400_000)
  const manual = await readManual($, home)
  const ts = buildTimesheet({ sessions, manual: manual.lines, rules, from: monday, to: addDays(monday, 6) })
  return weekLines(ts, rules, monday, { skipped, manualSkipped: manual.skipped, rulesError: r.ok ? null : r.error })
}

const offset = (m: number) => `UTC${m < 0 ? '-' : '+'}${String(Math.floor(Math.abs(m) / 60)).padStart(2, '0')}:${String(Math.abs(m) % 60).padStart(2, '0')}`

/** An engine rejection's text without the "hourslip: " the engine put in front: Claude Code prefixes command output itself. */
export const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/^(hourslip: )+/, '')

/** Writes one export file; on failure says which, and names the usual cause when another program (Excel) holds it open. */
async function writeExport($: CommandEngine, path: string, text: string): Promise<string | null> {
  try {
    await $.fs.write(path, text)
    return null
  } catch (err) {
    const msg = errorText(err)
    if (/\b(EBUSY|EPERM)\b/.test(msg)) return `Could not write ${path}: it is open in another program (Excel?). Close it and run export again.`
    return `Could not write ${path}: ${msg}`
  }
}

export async function runCommand($: CommandEngine, recorder: Recorder, args: string): Promise<{ text: string; openPane: boolean }> {
  try {
    return await run($, recorder, args)
  } catch (err) {
    if (err instanceof ReadError) return { text: err.message, openPane: false }
    throw err
  }
}

async function run($: CommandEngine, recorder: Recorder, args: string): Promise<{ text: string; openPane: boolean }> {
  const cmd = parseCommand(args)
  const { home, r, rules, today } = await context($, cmd.kind !== 'pane' && cmd.kind !== 'tz' && cmd.kind !== 'error')
  const rulesBroken = !r.ok ? `${r.error}. Fix rules.json first.` : null
  const known = (id: string) => rules.clients.some(c => c.id === id)
  const unknown = (id: string) => `Unknown client "${id}". Known: ${rules.clients.map(c => c.id).join(', ') || 'none yet (add one with /hourslip client add)'}.`

  switch (cmd.kind) {
    case 'error': return { text: cmd.message, openPane: false }
    case 'pane': return { text: (await paneLines($)).join('\n'), openPane: true }
    case 'tz': {
      const fromRules = rules.tzOffsetMinutes !== null
      const m = fromRules ? rules.tzOffsetMinutes! : -new Date().getTimezoneOffset()
      return { text: `hourslip records ${offset(m)} (${fromRules ? 'from rules.json' : 'from the module clock'}). If that is not your zone, set "tzOffsetMinutes" in ${home}/rules.json.`, openPane: false }
    }
    case 'tag': {
      if (rulesBroken) return { text: rulesBroken, openPane: false }
      if (!known(cmd.client)) return { text: unknown(cmd.client), openPane: false }
      const line = await recorder.record($, 'tag', { tag: { client: cmd.client, ticket: cmd.ticket, scope: cmd.scope } })
      if (!line) return { text: 'hourslip could not record the tag (see the status line).', openPane: false }
      await refreshStatus($, recorder)
      return { text: `Tagged ${cmd.scope === 'session' ? 'the whole session' : 'this session from now'}: ${clientName(rules, cmd.client)}${cmd.ticket ? ` · ${cmd.ticket}` : ''}.`, openPane: false }
    }
    case 'add': {
      if (rulesBroken) return { text: rulesBroken, openPane: false }
      if (!known(cmd.client)) return { text: unknown(cmd.client), openPane: false }
      const date = cmd.date ?? today
      await appendManual($, home, { v: 1, date, minutes: cmd.minutes, client: cmd.client, ticket: cmd.ticket, note: cmd.note })
      return { text: `Added ${Math.floor(cmd.minutes / 60)}h${String(cmd.minutes % 60).padStart(2, '0')} by hand for ${clientName(rules, cmd.client)} on ${date}. Reports label it "added by hand".`, openPane: false }
    }
    case 'client-add': {
      if (!r.ok) return { text: `${r.error}. Fix it first; hourslip will not overwrite it.`, openPane: false }
      if (known(cmd.id)) return { text: `Client ${cmd.id} already exists. Edit ${home}/rules.json to change it.`, openPane: false }
      await writeRules($, home, { ...rules, clients: [...rules.clients, { id: cmd.id, name: cmd.name, paths: cmd.paths, rate: cmd.rate, ticketPattern: null }] })
      return { text: `Added client ${cmd.id} (${cmd.name}) for ${cmd.paths.join(', ')}.`, openPane: false }
    }
    case 'export': {
      if (rulesBroken) return { text: rulesBroken, openPane: false }
      if (cmd.client !== null && !known(cmd.client)) return { text: unknown(cmd.client), openPane: false }
      const month = cmd.month ?? today.slice(0, 7)
      const { from, to } = monthBounds(month)
      const { sessions, skipped } = await readSessions($, home, Date.parse(`${from}T00:00:00Z`) - 86_400_000)
      const manualRead = await readManualStrict($, home)
      const manual = manualRead.lines
      const ts = buildTimesheet({ sessions, manual, rules, from, to })
      const scope = cmd.client ?? undefined
      const base = `${home}/exports/${csvName(cmd.client, month)}`
      for (const [path, text] of [[`${base}-days.csv`, daysCsv(ts, rules, scope, from, to)], [`${base}-tickets.csv`, ticketsCsv(ts, rules, manual, scope, from, to)]]) {
        const failed = await writeExport($, path, text)
        if (failed) return { text: failed, openPane: false }
      }
      const written = [`${base}-days.csv`, `${base}-tickets.csv`]
      // What the CSVs and the preview lack, in one list: the preview shows it in its banner (never in the snapshot).
      const notes: string[] = []
      if (skipped > 0) notes.push(`${skipped} unreadable event lines were skipped.`)
      if (manualRead.skipped > 0) notes.push(`${manualRead.skipped} unreadable manual lines were skipped.`)
      if (ts.overlapDates.length) notes.push(`Overlapping clients on ${ts.overlapDates.join(', ')}: check before you bill.`)
      if (cmd.client !== null) {
        // The CSVs are already written: a failing preview must not hide them.
        try {
          // Only the chosen client's sources: another client's commit titles must never reach this preview.
          const sources = ts.ticketSources.filter(s => s.client === cmd.client)
          const { commits, unavailable } = await commitsFor($, sources, rules.author, from, to)
          if (unavailable > 0) notes.unshift(`Commit titles were unavailable for ${unavailable} branch(es) (deleted branch, or not the CLI).`)
          const snapshot = buildSnapshot({ timesheet: ts, manual, rules, clientId: cmd.client, from, to, commits, showCommits: true, version: VERSION })
          await $.fs.write(`${base}-preview.html`, renderReport(snapshot, { banner: ['Preview: this is what your client will see.', ...notes] }))
          written.push(`${base}-preview.html`)
        } catch (err) {
          notes.push(`The preview could not be written: ${errorText(err)}`)
        }
      }
      return { text: ['Exported:', ...written.map(p => `  ${p}`), ...notes].join('\n'), openPane: false }
    }
  }
}
