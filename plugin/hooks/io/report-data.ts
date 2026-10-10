import { monthBounds } from '../core/dates.ts'
import { buildSnapshot, type Snapshot } from '../core/snapshot.ts'
import { buildTimesheet } from '../core/timesheet.ts'
import type { ManualLine, Rules, Timesheet } from '../core/types.ts'
import { VERSION } from '../core/version.ts'
import { readManualStrict, readSessions } from './files.ts'
import { commitsFor } from './git.ts'
import type { CommandEngine } from './paths.ts'

export type MonthData = { from: string; to: string; ts: Timesheet; manual: ManualLine[]; notes: string[] }

export async function monthData(engine: CommandEngine, home: string, rules: Rules, month: string): Promise<MonthData> {
  const { from, to } = monthBounds(month)
  const { sessions, skipped } = await readSessions(engine, home, Date.parse(`${from}T00:00:00Z`) - 86_400_000)
  const manualRead = await readManualStrict(engine, home)
  const ts = buildTimesheet({ sessions, manual: manualRead.lines, rules, from, to })
  const notes: string[] = []
  if (skipped > 0) notes.push(`${skipped} unreadable event lines were skipped.`)
  if (manualRead.skipped > 0) notes.push(`${manualRead.skipped} unreadable manual lines were skipped.`)
  if (ts.overlapDates.length) notes.push(`Overlapping clients on ${ts.overlapDates.join(', ')}: check before you bill.`)
  return { from, to, ts, manual: manualRead.lines, notes }
}

/** One client's snapshot. Only that client's branches are asked for commits: another client's titles never reach it. */
export async function snapshotFor(engine: CommandEngine, d: MonthData, rules: Rules, client: string, showCommits: boolean): Promise<{ snapshot: Snapshot; notes: string[] }> {
  const notes: string[] = []
  let commits: Record<string, string[]> = {}
  if (showCommits) {
    const sources = d.ts.ticketSources.filter(s => s.client === client)
    const r = await commitsFor(engine, sources, rules.author, d.from, d.to)
    commits = r.commits
    if (r.unavailable > 0) notes.push(`Commit titles were unavailable for ${r.unavailable} branch(es) (deleted branch, or not the CLI).`)
  }
  const snapshot = buildSnapshot({ timesheet: d.ts, manual: d.manual, rules, clientId: client, from: d.from, to: d.to, commits, showCommits, version: VERSION })
  return { snapshot, notes }
}
