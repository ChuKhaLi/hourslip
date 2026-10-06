import { describe, expect, test } from 'vitest'
import { DEFAULT_RULES } from '../../plugin/hooks/core/rules.ts'
import { buildSnapshot } from '../../plugin/hooks/core/snapshot.ts'
import type { Rules, Timesheet } from '../../plugin/hooks/core/types.ts'

const rules: Rules = {
  ...DEFAULT_RULES,
  business: { name: 'Alex Doe', paymentInstructions: 'Wise' },
  clients: [
    { id: 'acme', name: 'ACME Corp', paths: [], rate: { amount: 40, currency: 'USD' }, ticketPattern: null },
    { id: 'beta', name: 'Beta', paths: [], rate: null, ticketPattern: null },
  ],
}
const ts: Timesheet = {
  rows: [
    { date: '2026-10-05', client: 'acme', ticket: 'A-1', presenceMinutes: 61, claudeMinutes: 20, manualMinutes: 0, overlap: false, capped: false },
    { date: '2026-10-06', client: 'acme', ticket: null, presenceMinutes: 0, claudeMinutes: 0, manualMinutes: 30, overlap: true, capped: false },
    { date: '2026-10-06', client: 'beta', ticket: null, presenceMinutes: 50, claudeMinutes: 0, manualMinutes: 0, overlap: true, capped: false },
  ],
  ticketSources: [{ client: 'acme', ticket: 'A-1', branch: 'feat/A-1', cwd: '/w' }, { client: 'beta', ticket: 'A-1', branch: 'x', cwd: '/b' }],
  overlapDates: ['2026-10-06'], cappedDates: [],
}
const input = { timesheet: ts, manual: [{ v: 1 as const, date: '2026-10-06', minutes: 30, client: 'acme', ticket: null, note: 'Call' }], rules, from: '2026-10-01', to: '2026-10-31', commits: { 'A-1': ['Add login', 'Add login'] }, showCommits: true, version: '0.1.0' }

describe('buildSnapshot', () => {
  test('keeps only the chosen client and computes totals, days, tickets, manual', () => {
    const s = buildSnapshot({ ...input, clientId: 'acme' })
    expect(s.client).toEqual({ name: 'ACME Corp' })
    expect(s.totals).toEqual({ presenceMinutes: 61, claudeMinutes: 20, manualMinutes: 30 })
    expect(s.days.map(d => [d.date, d.overlap])).toEqual([['2026-10-05', false], ['2026-10-06', true]])
    expect(s.tickets).toEqual([
      { ticket: 'A-1', presenceMinutes: 61, claudeMinutes: 20, branches: ['feat/A-1'], commits: ['Add login'] },
      { ticket: null, presenceMinutes: 0, claudeMinutes: 0, branches: [], commits: [] },
    ])
    expect(s.manual).toEqual([{ date: '2026-10-06', minutes: 30, note: 'Call', ticket: null }])
    expect(JSON.stringify(s)).not.toContain('Beta')
  })
  test('invoice in integer cents, half-up, due 15 days after the period', () => {
    const s = buildSnapshot({ ...input, clientId: 'acme' })
    // 91 billable minutes at 4000 cents/h = 6066.67 -> 6067
    expect(s.invoice).toEqual({ number: 'ACME-2026-10', currency: 'USD', rateCents: 4000, billableMinutes: 91, amountCents: 6067, dueDate: '2026-11-15' })
    expect(buildSnapshot({ ...input, clientId: 'beta' }).invoice).toBeNull()
  })
  test('showCommits false empties every commit list', () => {
    expect(buildSnapshot({ ...input, clientId: 'acme', showCommits: false }).tickets[0].commits).toEqual([])
  })
  test('business does not leak extra keys from rules', () => {
    const rulesWithSecret = { ...rules, business: { ...rules.business, secret: 'x' } as Rules['business'] }
    const s = buildSnapshot({ ...input, clientId: 'acme', rules: rulesWithSecret })
    expect(JSON.stringify(s)).not.toContain('secret')
  })
  test('invoice rounding: 0.1 USD/h with 7 billable minutes rounds to 1 cent', () => {
    const lowRateRules = { ...rules, clients: [{ id: 'acme', name: 'ACME Corp', paths: [], rate: { amount: 0.1, currency: 'USD' }, ticketPattern: null }] }
    const lowRateTs = { rows: [{ date: '2026-10-05', client: 'acme', ticket: null, presenceMinutes: 7, claudeMinutes: 0, manualMinutes: 0, overlap: false, capped: false }], ticketSources: [], overlapDates: [], cappedDates: [] }
    const s = buildSnapshot({ timesheet: lowRateTs, manual: [], rules: lowRateRules, clientId: 'acme', from: '2026-10-01', to: '2026-10-31', commits: {}, showCommits: false, version: '0.1.0' })
    // 0.1 * 100 = 10 cents/h, 7 minutes = 10 * 7 / 60 = 1.166... -> 1
    expect(s.invoice?.amountCents).toBe(1)
  })
  test('invoice rounding: exact half-cent tie rounds up', () => {
    const halfRateRules = { ...rules, clients: [{ id: 'acme', name: 'ACME Corp', paths: [], rate: { amount: 0.03, currency: 'USD' }, ticketPattern: null }] }
    const halfRateTs = { rows: [{ date: '2026-10-05', client: 'acme', ticket: null, presenceMinutes: 10, claudeMinutes: 0, manualMinutes: 0, overlap: false, capped: false }], ticketSources: [], overlapDates: [], cappedDates: [] }
    const s = buildSnapshot({ timesheet: halfRateTs, manual: [], rules: halfRateRules, clientId: 'acme', from: '2026-10-01', to: '2026-10-31', commits: {}, showCommits: false, version: '0.1.0' })
    // 0.03 * 100 = 3 cents/h, 10 minutes = 3 * 10 / 60 = 0.5 -> 1
    expect(s.invoice?.amountCents).toBe(1)
  })
})
