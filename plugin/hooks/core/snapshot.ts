import { addDays } from './dates.ts'
import { clientName } from './rules.ts'
import type { ManualLine, Row, Rules, Timesheet } from './types.ts'

export type Snapshot = {
  v: 1
  business: { name: string; paymentInstructions: string }
  client: { name: string }
  period: { from: string; to: string }
  totals: { presenceMinutes: number; claudeMinutes: number; manualMinutes: number }
  days: { date: string; presenceMinutes: number; claudeMinutes: number; manualMinutes: number; overlap: boolean; capped: boolean; imported?: true }[]
  tickets: { ticket: string | null; presenceMinutes: number; claudeMinutes: number; branches: string[]; commits: string[] }[]
  manual: { date: string; minutes: number; note: string; ticket: string | null }[]
  invoice: { number: string; currency: string; rateCents: number; billableMinutes: number; amountCents: number; dueDate: string } | null
  showCommits: boolean
  generator: { name: 'hourslip'; version: string }
}

const sum = (rows: Row[], f: (r: Row) => number) => rows.reduce((s, r) => s + f(r), 0)

export function buildSnapshot(i: { timesheet: Timesheet; manual: ManualLine[]; rules: Rules; clientId: string; from: string; to: string; commits: Record<string, string[]>; showCommits: boolean; version: string }): Snapshot {
  const rows = i.timesheet.rows.filter(r => r.client === i.clientId && r.date >= i.from && r.date <= i.to)
  const totals = { presenceMinutes: sum(rows, r => r.presenceMinutes), claudeMinutes: sum(rows, r => r.claudeMinutes), manualMinutes: sum(rows, r => r.manualMinutes) }
  const dates = [...new Set(rows.map(r => r.date))].sort()
  const days = dates.map(date => {
    const d = rows.filter(r => r.date === date)
    return { date, presenceMinutes: sum(d, r => r.presenceMinutes), claudeMinutes: sum(d, r => r.claudeMinutes), manualMinutes: sum(d, r => r.manualMinutes), overlap: d.some(r => r.overlap), capped: d.some(r => r.capped), ...(d.some(r => r.imported) ? { imported: true as const } : {}) }
  })
  const ticketKeys = [...new Set(rows.map(r => r.ticket))].sort((a, b) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1))
  const tickets = ticketKeys.map(ticket => {
    const t = rows.filter(r => r.ticket === ticket)
    const branches = ticket === null ? [] : [...new Set(i.timesheet.ticketSources.filter(s => s.client === i.clientId && s.ticket === ticket).map(s => s.branch))].sort()
    const commits = i.showCommits && ticket !== null ? [...new Set(i.commits[ticket] ?? [])] : []
    return { ticket, presenceMinutes: sum(t, r => r.presenceMinutes), claudeMinutes: sum(t, r => r.claudeMinutes), branches, commits }
  })
  const manual = i.manual.filter(m => m.client === i.clientId && m.date >= i.from && m.date <= i.to)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map(m => ({ date: m.date, minutes: m.minutes, note: m.note, ticket: m.ticket }))
  const rate = i.rules.clients.find(c => c.id === i.clientId)?.rate ?? null
  const billableMinutes = totals.presenceMinutes + totals.manualMinutes
  const rateCents = rate ? Math.round(rate.amount * 100) : 0
  const invoice = rate ? {
    number: `${i.clientId.toUpperCase()}-${i.from.slice(0, 7)}`, currency: rate.currency, rateCents, billableMinutes,
    amountCents: Math.floor((rateCents * billableMinutes + 30) / 60), dueDate: addDays(i.to, 15),
  } : null
  return {
    v: 1, business: { name: i.rules.business.name, paymentInstructions: i.rules.business.paymentInstructions }, client: { name: clientName(i.rules, i.clientId) }, period: { from: i.from, to: i.to },
    totals, days, tickets, manual, invoice, showCommits: i.showCommits, generator: { name: 'hourslip', version: i.version },
  }
}
