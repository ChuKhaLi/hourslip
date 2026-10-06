import { describe, expect, test } from 'vitest'
import { daysCsv, ticketsCsv, toCsv } from '../../plugin/hooks/core/csv.ts'
import { DEFAULT_RULES } from '../../plugin/hooks/core/rules.ts'
import type { Rules, Timesheet } from '../../plugin/hooks/core/types.ts'

const rules: Rules = { ...DEFAULT_RULES, clients: [{ id: 'acme', name: 'ACME; "Corp"\nLtd', paths: [], rate: null, ticketPattern: null }] }
const ts: Timesheet = {
  rows: [
    { date: '2026-10-05', client: 'acme', ticket: 'A-1', presenceMinutes: 90, claudeMinutes: 30, manualMinutes: 0, overlap: false, capped: false },
    { date: '2026-10-05', client: 'acme', ticket: null, presenceMinutes: 0, claudeMinutes: 0, manualMinutes: 45, overlap: true, capped: false },
  ],
  ticketSources: [], overlapDates: ['2026-10-05'], cappedDates: [],
}

describe('toCsv', () => {
  test('BOM, CRLF, quoting of separator, quote and newline', () => {
    expect(toCsv([['a', 'b;c'], ['x"y', 'l1\nl2']], 'vi')).toBe('﻿a;"b;c"\r\n"x""y";"l1\nl2"\r\n')
    expect(toCsv([['a', 'b,c']], 'en')).toBe('﻿a,"b,c"\r\n')
  })
})

describe('daysCsv', () => {
  test('one client: every calendar day in the period, hours in the locale', () => {
    const csv = daysCsv(ts, { ...rules, csv: 'vi' }, 'acme', '2026-10-04', '2026-10-05')
    expect(csv.split('\r\n')).toEqual([
      '﻿Date;Weekday;Client;Measured hours;Claude hours;Manual hours;Total billable hours;Flags',
      '2026-10-04;Sun;"ACME; ""Corp""\nLtd";0,00;0,00;0,00;0,00;',
      '2026-10-05;Mon;"ACME; ""Corp""\nLtd";1,50;0,50;0,75;2,25;overlap',
      '',
    ])
  })
  test('all clients: only days with work, en locale', () => {
    const csv = daysCsv(ts, rules, undefined, '2026-10-04', '2026-10-05')
    expect(csv.split('\r\n')[1]).toBe('2026-10-05,Mon,"ACME; ""Corp""\nLtd",1.50,0.50,0.75,2.25,overlap')
  })
})

describe('ticketsCsv', () => {
  test('one line per day x client x ticket, manual notes joined', () => {
    const csv = ticketsCsv(ts, rules, [{ v: 1, date: '2026-10-05', minutes: 45, client: 'acme', ticket: null, note: 'Call' }], 'acme', '2026-10-01', '2026-10-31')
    expect(csv.split('\r\n')).toEqual([
      '﻿Date,Client,Ticket,Measured hours,Claude hours,Manual hours,Notes',
      '2026-10-05,"ACME; ""Corp""\nLtd",A-1,1.50,0.50,0.00,',
      '2026-10-05,"ACME; ""Corp""\nLtd",,0.00,0.00,0.75,Call (added by hand)',
      '',
    ])
  })
})
