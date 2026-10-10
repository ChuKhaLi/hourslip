import { parseCommand, tokenize } from '../core/args.ts'
import { csvName } from '../core/names.ts'
import { daysCsv, ticketsCsv } from '../core/csv.ts'
import { addDays, localDate, mondayOf } from '../core/dates.ts'
import { publishedLines } from '../core/publish.ts'
import { renderReport } from '../core/report.ts'
import { DEFAULT_RULES, clientName } from '../core/rules.ts'
import { weekLines } from '../core/summary.ts'
import { buildTimesheet } from '../core/timesheet.ts'
import { ReadError, appendManual, readManual, readRules, readRulesStrict, readSessions, writeRules } from './files.ts'
import { monthData, snapshotFor } from './report-data.ts'
import { importConfirm, importPreview, importUndo, type ImportReply } from './importing.ts'
import { homeDir, type CommandEngine, type ImportEngine, type PaneEngine, type PublishEngine } from './paths.ts'
import { keyForget, keyInfo, keySet, keyShow, portal, publish, refreshStatuses, subscribe, unpublish } from './publishing.ts'
import type { Recorder } from './recorder.ts'

async function context(engine: PaneEngine | CommandEngine, strict = false) {
  const home = await homeDir(engine)
  // Commands that write (or export) must not mistake an unreadable rules.json for a missing one.
  const r = strict ? await readRulesStrict(engine as CommandEngine, home) : await readRules(engine, home)
  const rules = r.ok ? r.rules : DEFAULT_RULES
  const now = await engine.clock.now()
  const tz = rules.tzOffsetMinutes ?? -new Date().getTimezoneOffset()
  return { home, r, rules, today: localDate(now, tz) }
}

export async function paneLines(engine: PaneEngine): Promise<string[]> {
  const { home, r, rules, today } = await context(engine)
  const monday = mondayOf(today)
  const { sessions, skipped } = await readSessions(engine, home, Date.parse(`${monday}T00:00:00Z`) - 86_400_000)
  const manual = await readManual(engine, home)
  const ts = buildTimesheet({ sessions, manual: manual.lines, rules, from: monday, to: addDays(monday, 6) })
  return weekLines(ts, rules, monday, { skipped, manualSkipped: manual.skipped, rulesError: r.ok ? null : r.error })
}

const offset = (m: number) => `UTC${m < 0 ? '-' : '+'}${String(Math.floor(Math.abs(m) / 60)).padStart(2, '0')}:${String(Math.abs(m) % 60).padStart(2, '0')}`

/** An engine rejection's text without the "hourslip: " the engine put in front: Claude Code prefixes command output itself. */
export const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/^(hourslip: )+/, '')

/** Writes one export file; on failure says which, and names the usual cause when another program (Excel) holds it open. */
async function writeExport(engine: CommandEngine, path: string, text: string): Promise<string | null> {
  try {
    await engine.fs.write(path, text)
    return null
  } catch (err) {
    const msg = errorText(err)
    if (/\b(EBUSY|EPERM)\b/.test(msg)) return `Could not write ${path}: it is open in another program (Excel?). Close it and run export again.`
    return `Could not write ${path}: ${msg}`
  }
}

/** `/hourslip`'s engine: everything a subcommand reaches, the import's transcripts included. */
export type HourslipEngine = PublishEngine & ImportEngine

export async function runCommand(engine: HourslipEngine, recorder: Recorder, args: string): Promise<ImportReply> {
  try {
    return await run(engine, recorder, args)
  } catch (err) {
    if (err instanceof ReadError) return { text: err.message, openPane: false }
    // The publishing commands answer in text whatever goes wrong; the older ones keep today's behaviour.
    if (['publish', 'unpublish', 'subscribe', 'portal', 'key', 'import'].includes(tokenize(args)[0] ?? '')) return { text: errorText(err), openPane: false }
    throw err
  }
}

async function run(engine: HourslipEngine, recorder: Recorder, args: string): Promise<ImportReply> {
  const cmd = parseCommand(args)
  const { home, r, rules, today } = await context(engine, cmd.kind !== 'pane' && cmd.kind !== 'tz' && cmd.kind !== 'error')
  const rulesBroken = !r.ok ? `${r.error}. Fix rules.json first.` : null
  const known = (id: string) => rules.clients.some(c => c.id === id)
  const unknown = (id: string) => `Unknown client "${id}". Known: ${rules.clients.map(c => c.id).join(', ') || 'none yet (add one with /hourslip client add)'}.`

  switch (cmd.kind) {
    case 'error': return { text: cmd.message, openPane: false }
    case 'pane': {
      let published: string[] = []
      try { published = publishedLines(await refreshStatuses(engine)) } catch { /* never block the pane */ }
      return { text: [...(await paneLines(engine)), ...(published.length ? ['', ...published] : [])].join('\n'), openPane: true }
    }
    case 'tz': {
      const fromRules = rules.tzOffsetMinutes !== null
      const m = fromRules ? rules.tzOffsetMinutes! : -new Date().getTimezoneOffset()
      return { text: `hourslip records ${offset(m)} (${fromRules ? 'from rules.json' : 'from the module clock'}). If that is not your zone, set "tzOffsetMinutes" in ${home}/rules.json.`, openPane: false }
    }
    case 'tag': {
      if (rulesBroken) return { text: rulesBroken, openPane: false }
      if (!known(cmd.client)) return { text: unknown(cmd.client), openPane: false }
      const line = await recorder.record(engine, 'tag', { tag: { client: cmd.client, ticket: cmd.ticket, scope: cmd.scope } })
      if (!line) return { text: 'hourslip could not record the tag (see the status line).', openPane: false }
      return { text: `Tagged ${cmd.scope === 'session' ? 'the whole session' : 'this session from now'}: ${clientName(rules, cmd.client)}${cmd.ticket ? ` · ${cmd.ticket}` : ''}.`, openPane: false }
    }
    case 'add': {
      if (rulesBroken) return { text: rulesBroken, openPane: false }
      if (!known(cmd.client)) return { text: unknown(cmd.client), openPane: false }
      const date = cmd.date ?? today
      await appendManual(engine, home, { v: 1, date, minutes: cmd.minutes, client: cmd.client, ticket: cmd.ticket, note: cmd.note })
      return { text: `Added ${Math.floor(cmd.minutes / 60)}h${String(cmd.minutes % 60).padStart(2, '0')} by hand for ${clientName(rules, cmd.client)} on ${date}. Reports label it "added by hand".`, openPane: false }
    }
    case 'client-add': {
      if (!r.ok) return { text: `${r.error}. Fix it first; hourslip will not overwrite it.`, openPane: false }
      if (known(cmd.id)) return { text: `Client ${cmd.id} already exists. Edit ${home}/rules.json to change it.`, openPane: false }
      await writeRules(engine, home, { ...rules, clients: [...rules.clients, { id: cmd.id, name: cmd.name, paths: cmd.paths, rate: cmd.rate, ticketPattern: null }] })
      return { text: `Added client ${cmd.id} (${cmd.name}) for ${cmd.paths.join(', ')}.`, openPane: false }
    }
    case 'export': {
      if (rulesBroken) return { text: rulesBroken, openPane: false }
      if (cmd.client !== null && !known(cmd.client)) return { text: unknown(cmd.client), openPane: false }
      const month = cmd.month ?? today.slice(0, 7)
      const data = await monthData(engine, home, rules, month)
      const { from, to, ts, manual } = data
      const scope = cmd.client ?? undefined
      const base = `${home}/exports/${csvName(cmd.client, month)}`
      for (const [path, text] of [[`${base}-days.csv`, daysCsv(ts, rules, scope, from, to)], [`${base}-tickets.csv`, ticketsCsv(ts, rules, manual, scope, from, to)]]) {
        const failed = await writeExport(engine, path, text)
        if (failed) return { text: failed, openPane: false }
      }
      const written = [`${base}-days.csv`, `${base}-tickets.csv`]
      // What the CSVs and the preview lack, in one list: the preview shows it in its banner (never in the snapshot).
      const notes = [...data.notes]
      if (cmd.client !== null) {
        // The CSVs are already written: a failing preview must not hide them.
        try {
          const { snapshot, notes: commitNotes } = await snapshotFor(engine, data, rules, cmd.client, true)
          notes.unshift(...commitNotes)
          await engine.fs.write(`${base}-preview.html`, renderReport(snapshot, { banner: ['Preview: this is what your client will see.', ...notes] }))
          written.push(`${base}-preview.html`)
        } catch (err) {
          notes.push(`The preview could not be written: ${errorText(err)}`)
        }
      }
      return { text: ['Exported:', ...written.map(p => `  ${p}`), ...notes].join('\n'), openPane: false }
    }
    case 'publish': {
      if (rulesBroken) return { text: rulesBroken, openPane: false }
      if (!known(cmd.client)) return { text: unknown(cmd.client), openPane: false }
      return publish(engine, { home, rules, today }, cmd)
    }
    case 'import': {
      if (cmd.mode === 'undo') return importUndo(engine, { home })
      if (rulesBroken) return { text: rulesBroken, openPane: false }
      const ctx = { home, rules, today, tz: rules.tzOffsetMinutes ?? -new Date().getTimezoneOffset() }
      return cmd.mode === 'confirm' ? importConfirm(engine, ctx) : importPreview(engine, ctx)
    }
    case 'subscribe': return subscribe(engine, cmd.plan)
    case 'portal': return portal(engine)
    case 'unpublish': return unpublish(engine, cmd.client, cmd.month)
    case 'key': return keyInfo(engine)
    case 'key-show': return keyShow(engine)
    case 'key-set': return keySet(engine, cmd.key)
    case 'key-forget': return keyForget(engine)
  }
}
