import { describe, expect, test } from 'vitest'
import { DEFAULT_RULES } from '../../plugin/hooks/core/rules.ts'
import { buildTimesheet } from '../../plugin/hooks/core/timesheet.ts'
import type { EventLine, Rules } from '../../plugin/hooks/core/types.ts'

const rules: Rules = {
  ...DEFAULT_RULES,
  clients: [
    { id: 'acme', name: 'ACME', paths: ['/w/acme/**'], rate: null, ticketPattern: null },
    { id: 'beta', name: 'Beta', paths: ['/w/beta/**'], rate: null, ticketPattern: null },
  ],
}
const T0 = Date.parse('2026-10-05T02:00:00Z')
const p = (sid: string, min: number, cwd = '/w/acme', extra: Partial<EventLine> = {}): EventLine =>
  ({ v: 1, ts: new Date(T0 + min * 60_000).toISOString(), tz: 420, sid, kind: 'prompt', cwd, branch: null, ...extra })
const build = (sessions: EventLine[][], manual = []) => buildTimesheet({ sessions, manual, rules, from: '2026-10-01', to: '2026-10-31' })

describe('buildTimesheet', () => {
  test('two windows on the same client bill the overlap once', () => {
    const t = build([[p('a', 0), p('a', 30)], [p('b', 10), p('b', 40)]])
    expect(t.rows).toEqual([{ date: '2026-10-05', client: 'acme', ticket: null, presenceMinutes: 50, claudeMinutes: 0, manualMinutes: 0, overlap: false, capped: false }])
    expect(t.overlapDates).toEqual([])
  })
  test('two windows on different clients split the overlap equally and flag it', () => {
    const t = build([[p('a', 0), p('a', 30)], [p('b', 20, '/w/beta'), p('b', 40, '/w/beta')]])
    const by = Object.fromEntries(t.rows.map(r => [r.client, r]))
    // acme alone 0-20, shared 20-40 split, beta alone 40-50
    expect(by.acme.presenceMinutes).toBe(30)
    expect(by.beta.presenceMinutes).toBe(20)
    expect(by.acme.overlap && by.beta.overlap).toBe(true)
    expect(t.overlapDates).toEqual(['2026-10-05'])
  })
  test('a day over 12 hours is scaled down proportionally and flagged', () => {
    const many = (sid: string, cwd: string) => Array.from({ length: 25 }, (_, i) => p(sid, i * 30, cwd))
    const t = build([many('a', '/w/acme'), many('b', '/w/beta').map(l => ({ ...l, ts: new Date(Date.parse(l.ts) + 1000).toISOString() }))])
    const total = t.rows.reduce((s, r) => s + r.presenceMinutes, 0)
    expect(total).toBe(720)
    expect(t.rows.every(r => r.capped)).toBe(true)
    expect(t.cappedDates).toEqual(['2026-10-05'])
  })
  test('a capped day sums to exactly 720 even when every scaled share ends in .5', () => {
    const four: Rules = { ...DEFAULT_RULES, clients: ['c1', 'c2', 'c3', 'c4'].map(id => ({ id, name: id, paths: [`/w/${id}/**`], rate: null, ticketPattern: null })) }
    const base = Date.parse('2026-10-04T17:00:00Z') // 00:00 local
    const lens = [361, 361, 361, 357] // 1440 min total, scale 0.5 -> 180.5, 180.5, 180.5, 178.5
    let offset = 0
    const sessions = lens.map((len, i) => {
      const mk = (min: number): EventLine => ({ v: 1, ts: new Date(base + (offset + min) * 60_000).toISOString(), tz: 420, sid: `s${i}`, kind: 'prompt', cwd: `/w/c${i + 1}`, branch: null })
      const minsAt = [...Array.from({ length: Math.floor((len - 11) / 30) + 1 }, (_, k) => k * 30), len - 10]
      const lines = minsAt.map(mk)
      offset += len
      return lines
    })
    const t = buildTimesheet({ sessions, manual: [], rules: four, from: '2026-10-01', to: '2026-10-31' })
    expect(t.rows.reduce((s, r) => s + r.presenceMinutes, 0)).toBe(720)
    expect(t.rows.every(r => r.capped)).toBe(true)
  })
  test('rounding is per (date, client) by largest remainder: merged cross-ticket time is not overstated', () => {
    const ev = (sid: string, min: number, extra: Partial<EventLine>) => p(sid, min, '/w/acme', extra)
    const A = [ev('a', 0, { branch: 'feat/ACME-1-x' }), ev('a', 30, { branch: 'feat/ACME-1-x' }), ev('a', 60, { kind: 'tag', tag: { client: 'acme', ticket: 'ACME-7', scope: 'from-now' } }), ev('a', 70, {}), ev('a', 75, { kind: 'end' })]
    const B = [ev('b', 20, { branch: 'feat/ACME-2-y' }), ev('b', 35, { branch: 'feat/ACME-2-y' }), ev('b', 55, { branch: 'feat/ACME-2-y' }), ev('b', 55, { kind: 'end' })]
    const t = build([A, B])
    const by = Object.fromEntries(t.rows.map(r => [r.ticket, r.presenceMinutes]))
    expect(Object.keys(by).sort()).toEqual(['ACME-1', 'ACME-2', 'ACME-7'])
    expect(t.rows.reduce((s, r) => s + r.presenceMinutes, 0)).toBe(75)
    expect(by['ACME-7']).toBe(15)
  })
  test('same client, two tickets overlapping half a minute each still sum to the merged time', () => {
    const a = [p('a', 0, '/w/acme', { branch: 'feat/ACME-1-x' }), p('a', 10, '/w/acme', { kind: 'end' })]
    const b = [p('b', 9, '/w/acme', { branch: 'feat/ACME-2-y' }), p('b', 19, '/w/acme', { kind: 'end' })]
    const t = build([a, b])
    expect(t.rows).toHaveLength(2)
    expect(t.rows.reduce((s, r) => s + r.presenceMinutes, 0)).toBe(19)
    expect(t.rows.some(r => r.overlap)).toBe(false)
  })
  test('Unassigned never competes: it keeps its full time and raises no overlap flag', () => {
    const a = [p('a', 0), p('a', 20), p('a', 20, '/w/acme', { kind: 'end' })]
    const u = [p('u', 0, '/x'), p('u', 20, '/x'), p('u', 20, '/x', { kind: 'end' })]
    const t = build([a, u])
    const by = Object.fromEntries(t.rows.map(r => [String(r.client), r]))
    expect(by.acme.presenceMinutes).toBe(20)
    expect(by.null.presenceMinutes).toBe(20)
    expect(by.acme.overlap || by.null.overlap).toBe(false)
    expect(t.overlapDates).toEqual([])
  })
  test('the 12h cap counts assigned clients only', () => {
    const acme = Array.from({ length: 25 }, (_, i) => p('a', i * 30))
    const u = [0, 30, 60, 90].map(m => p('u', m, '/x')).concat(p('u', 100, '/x', { kind: 'end' }))
    const t = build([acme, u])
    const a = t.rows.filter(r => r.client === 'acme')
    const n = t.rows.filter(r => r.client === null)
    expect(a.reduce((s, r) => s + r.presenceMinutes, 0)).toBe(720)
    expect(a.every(r => r.capped)).toBe(true)
    expect(n.reduce((s, r) => s + r.presenceMinutes, 0)).toBe(100)
    expect(n.some(r => r.capped)).toBe(false)
  })
  test('manual minutes land on their own key, and rows outside the period are dropped', () => {
    const t = buildTimesheet({
      sessions: [[p('a', 0)]],
      manual: [{ v: 1, date: '2026-10-05', minutes: 60, client: 'acme', ticket: 'ACME-9', note: 'call' }, { v: 1, date: '2026-09-30', minutes: 30, client: 'acme', ticket: null, note: 'old' }],
      rules, from: '2026-10-01', to: '2026-10-31',
    })
    expect(t.rows.map(r => [r.ticket, r.presenceMinutes, r.manualMinutes])).toEqual([['ACME-9', 0, 60], [null, 10, 0]])
  })
  test('Claude minutes come from turn spans', () => {
    const t = build([[p('a', 0, '/w/acme', { kind: 'turn-start', turn: 't' }), p('a', 7, '/w/acme', { kind: 'turn-end', turn: 't' })]])
    expect(t.rows[0].claudeMinutes).toBe(7)
  })
  test('rows sort by date, then client with Unassigned last, then ticket', () => {
    const t = build([[p('a', 0, '/x')], [p('b', 0, '/w/beta')], [p('c', 0, '/w/acme')]])
    expect(t.rows.map(r => r.client)).toEqual(['acme', 'beta', null])
  })
})
