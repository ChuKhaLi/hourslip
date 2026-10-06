import { describe, expect, test } from 'vitest'
import { DEFAULT_RULES } from '../../plugin/hooks/core/rules.ts'
import { statusText, weekLines } from '../../plugin/hooks/core/summary.ts'
import type { Row, Rules, Timesheet } from '../../plugin/hooks/core/types.ts'

const rules: Rules = { ...DEFAULT_RULES, clients: [{ id: 'acme', name: 'ACME', paths: [], rate: null, ticketPattern: null }] }
const row = (date: string, client: string | null, presence: number, extra: Partial<Row> = {}): Row =>
  ({ date, client, ticket: null, presenceMinutes: presence, claudeMinutes: 0, manualMinutes: 0, overlap: false, capped: false, ...extra })
const ts = (rows: Row[]): Timesheet => ({ rows, ticketSources: [], overlapDates: [...new Set(rows.filter(r => r.overlap).map(r => r.date))], cappedDates: [] })

describe('statusText', () => {
  test('client, ticket and today\'s presence plus manual for that client', () => {
    const t = ts([row('2026-10-05', 'acme', 120, { manualMinutes: 14 }), row('2026-10-05', null, 40), row('2026-10-04', 'acme', 99)])
    expect(statusText(t, rules, { client: 'acme', ticket: 'ACME-182' }, '2026-10-05')).toBe('⏱ ACME · ACME-182 · 2h14 today')
    expect(statusText(t, rules, { client: null, ticket: null }, '2026-10-05')).toBe('⏱ unassigned · 0h40 today')
  })
})

describe('weekLines', () => {
  test('one line per day with work, a total, and warnings', () => {
    const t = ts([row('2026-10-05', 'acme', 134, { claudeMinutes: 62 }), row('2026-10-05', null, 40), row('2026-10-07', 'acme', 60, { overlap: true })])
    expect(weekLines(t, rules, '2026-10-05', { skipped: 2, manualSkipped: 1, rulesError: null })).toEqual([
      'Week of 2026-10-05',
      'Mon 10-05  ACME 2h14 (Claude 1h02) · Unassigned 0h40',
      'Wed 10-07  ACME 1h00 (Claude 0h00)',
      'Total      ACME 3h14 · Unassigned 0h40',
      '⚠ Overlapping clients on 10-07: check before you bill.',
      '⚠ 2 unreadable event lines were skipped.',
      '⚠ 1 unreadable manual lines were skipped.',
    ])
  })
  test('an empty week and a rules error', () => {
    expect(weekLines(ts([]), rules, '2026-10-05', { skipped: 0, manualSkipped: 0, rulesError: 'rules.json is not valid JSON (line 4)' })).toEqual([
      'Week of 2026-10-05',
      'No time recorded this week.',
      '⚠ rules.json is not valid JSON (line 4). Everything is Unassigned until it is fixed.',
    ])
  })
})
