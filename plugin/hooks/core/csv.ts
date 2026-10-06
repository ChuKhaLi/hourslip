import { addDays, weekdayIndex } from './dates.ts'
import { clientName } from './rules.ts'
import type { ManualLine, Row, Rules, Timesheet } from './types.ts'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function toCsv(rows: string[][], locale: 'en' | 'vi'): string {
  const sep = locale === 'vi' ? ';' : ','
  const cell = (v: string) => (v.includes(sep) || v.includes('"') || v.includes('\n') || v.includes('\r') ? `"${v.replace(/"/g, '""')}"` : v)
  return '﻿' + rows.map(r => r.map(cell).join(sep) + '\r\n').join('')
}

const hours = (minutes: number, locale: 'en' | 'vi') => {
  const s = (minutes / 60).toFixed(2)
  return locale === 'vi' ? s.replace('.', ',') : s
}

const pick = (ts: Timesheet, client: string | null | undefined, from: string, to: string): Row[] =>
  ts.rows.filter(r => r.date >= from && r.date <= to && (client === undefined || r.client === client))

export function daysCsv(ts: Timesheet, rules: Rules, client: string | null | undefined, from: string, to: string): string {
  const L = rules.csv
  const rows = pick(ts, client, from, to)
  const out: string[][] = [['Date', 'Weekday', 'Client', 'Measured hours', 'Claude hours', 'Manual hours', 'Total billable hours', 'Flags']]
  const line = (date: string, c: string | null, rs: Row[]) => {
    const p = rs.reduce((s, r) => s + r.presenceMinutes, 0)
    const cl = rs.reduce((s, r) => s + r.claudeMinutes, 0)
    const m = rs.reduce((s, r) => s + r.manualMinutes, 0)
    const flags = [rs.some(r => r.overlap) ? 'overlap' : '', rs.some(r => r.capped) ? 'capped' : ''].filter(Boolean).join(' ')
    out.push([date, DAYS[weekdayIndex(date)], clientName(rules, c), hours(p, L), hours(cl, L), hours(m, L), hours(p + m, L), flags])
  }
  if (client !== undefined) {
    for (let d = from; d <= to; d = addDays(d, 1)) line(d, client, rows.filter(r => r.date === d))
  } else {
    const keys = [...new Set(rows.map(r => JSON.stringify([r.date, r.client])))]
    for (const k of keys) {
      const [date, c] = JSON.parse(k) as [string, string | null]
      line(date, c, rows.filter(r => r.date === date && r.client === c))
    }
  }
  return toCsv(out, L)
}

export function ticketsCsv(ts: Timesheet, rules: Rules, manual: ManualLine[], client: string | null | undefined, from: string, to: string): string {
  const L = rules.csv
  const out: string[][] = [['Date', 'Client', 'Ticket', 'Measured hours', 'Claude hours', 'Manual hours', 'Notes']]
  for (const r of pick(ts, client, from, to)) {
    const notes = manual.filter(m => m.date === r.date && m.client === r.client && m.ticket === r.ticket).map(m => `${m.note} (added by hand)`).join('; ')
    out.push([r.date, clientName(rules, r.client), r.ticket ?? '', hours(r.presenceMinutes, L), hours(r.claudeMinutes, L), hours(r.manualMinutes, L), notes])
  }
  return toCsv(out, L)
}
