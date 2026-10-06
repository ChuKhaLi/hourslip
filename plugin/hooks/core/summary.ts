import { addDays, formatMinutes, weekdayIndex } from './dates.ts'
import { clientName } from './rules.ts'
import type { Attribution, Row, Rules, Timesheet } from './types.ts'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const billable = (r: Row) => r.presenceMinutes + r.manualMinutes

export function statusText(ts: Timesheet, rules: Rules, attr: Attribution, today: string): string {
  const minutes = ts.rows.filter(r => r.date === today && r.client === attr.client).reduce((s, r) => s + billable(r), 0)
  if (attr.client === null) return `⏱ unassigned · ${formatMinutes(minutes)} today`
  const parts = [clientName(rules, attr.client), ...(attr.ticket ? [attr.ticket] : []), `${formatMinutes(minutes)} today`]
  return `⏱ ${parts.join(' · ')}`
}

function byClient(rows: Row[]): Map<string | null, { billable: number; claude: number }> {
  const m = new Map<string | null, { billable: number; claude: number }>()
  for (const r of rows) {
    const c = m.get(r.client) ?? { billable: 0, claude: 0 }
    c.billable += billable(r)
    c.claude += r.claudeMinutes
    m.set(r.client, c)
  }
  return new Map([...m].sort(([a], [b]) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1)))
}

export function weekLines(ts: Timesheet, rules: Rules, monday: string, notes: { skipped: number; manualSkipped: number; rulesError: string | null }): string[] {
  const sunday = addDays(monday, 6)
  const week = ts.rows.filter(r => r.date >= monday && r.date <= sunday)
  const out = [`Week of ${monday}`]
  if (week.length === 0) out.push('No time recorded this week.')
  else {
    for (let i = 0; i < 7; i++) {
      const date = addDays(monday, i)
      const day = week.filter(r => r.date === date)
      if (day.length === 0) continue
      const cells = [...byClient(day)].map(([c, v]) => c === null ? `Unassigned ${formatMinutes(v.billable)}` : `${clientName(rules, c)} ${formatMinutes(v.billable)} (Claude ${formatMinutes(v.claude)})`)
      out.push(`${DAYS[weekdayIndex(date)]} ${date.slice(5)}  ${cells.join(' · ')}`)
    }
    out.push(`Total      ${[...byClient(week)].map(([c, v]) => `${clientName(rules, c)} ${formatMinutes(v.billable)}`).join(' · ')}`)
    const overlaps = [...new Set(week.filter(r => r.overlap).map(r => r.date.slice(5)))]
    if (overlaps.length) out.push(`⚠ Overlapping clients on ${overlaps.join(', ')}: check before you bill.`)
  }
  if (notes.skipped > 0) out.push(`⚠ ${notes.skipped} unreadable event lines were skipped.`)
  if (notes.manualSkipped > 0) out.push(`⚠ ${notes.manualSkipped} unreadable manual lines were skipped.`)
  if (notes.rulesError) out.push(`⚠ ${notes.rulesError}. Everything is Unassigned until it is fixed.`)
  return out
}
