import { describe, expect, test } from 'vitest'
import { currentAttribution, sessionPieces } from '../../plugin/hooks/core/presence.ts'
import { DEFAULT_RULES } from '../../plugin/hooks/core/rules.ts'
import type { EventKind, EventLine, Rules, Tag } from '../../plugin/hooks/core/types.ts'

const rules: Rules = { ...DEFAULT_RULES, clients: [{ id: 'acme', name: 'ACME', paths: ['/w/acme/**'], rate: null, ticketPattern: null }] }
const T0 = Date.parse('2026-10-05T02:00:00Z') // 09:00 at +07:00
const at = (min: number, kind: EventKind = 'prompt', extra: Partial<EventLine> = {}): EventLine =>
  ({ v: 1, ts: new Date(T0 + min * 60_000).toISOString(), tz: 420, sid: 's1', kind, cwd: '/w/acme', branch: 'feat/ACME-1', ...extra })
const mins = (p: { start: number; end: number }) => (p.end - p.start) / 60_000

describe('sessionPieces', () => {
  test('a gap of exactly 45 minutes stays one segment; 46 splits it', () => {
    expect(sessionPieces([at(0), at(45)], rules).pieces.map(mins)).toEqual([55])
    expect(sessionPieces([at(0), at(46)], rules).pieces.map(mins)).toEqual([10, 10])
  })
  test('a one-point session lasts 10 minutes', () => {
    expect(sessionPieces([at(0, 'prompt')], rules).pieces.map(mins)).toEqual([10])
  })
  test('a session with only a start line yields no pieces (start also fires on respawn and reload)', () => {
    expect(sessionPieces([at(0, 'start')], rules).pieces).toEqual([])
  })
  test('an end event inside the pad cuts it, but never below 10 minutes', () => {
    expect(sessionPieces([at(0), at(20), at(23, 'end')], rules).pieces.map(mins)).toEqual([23])
    expect(sessionPieces([at(0), at(2, 'end')], rules).pieces.map(mins)).toEqual([10])
  })
  test('a branch change splits the segment at the point it changed', () => {
    const r = sessionPieces([at(0), at(20, 'prompt', { branch: 'feat/ACME-2' }), at(30)], rules)
    expect(r.pieces.map(p => [p.ticket, mins(p)])).toEqual([['ACME-1', 20], ['ACME-2', 10], ['ACME-1', 10]])
  })
  test('a segment that crosses midnight belongs to the day it started', () => {
    const late = (min: number): EventLine => at(min, 'prompt', { ts: new Date(Date.parse('2026-10-05T16:50:00Z') + min * 60_000).toISOString() })
    const r = sessionPieces([late(0), late(30)], rules) // 23:50 to 00:30 local
    expect(r.pieces.every(p => p.date === '2026-10-05')).toBe(true)
  })
  test('a from-now tag applies after it; a session tag applies to the whole session; the later-issued tag wins', () => {
    const tag = (min: number, t: Tag) => at(min, 'tag', { tag: t })
    const fromNow = sessionPieces([at(0), tag(10, { client: 'beta', ticket: 'B-1', scope: 'from-now' }), at(20)], rules)
    expect(fromNow.pieces.map(p => [p.client, mins(p)])).toEqual([['acme', 10], ['beta', 20]])
    const whole = sessionPieces([at(0), tag(10, { client: 'beta', ticket: null, scope: 'session' }), at(20)], rules)
    expect(whole.pieces.map(p => [p.client, mins(p)])).toEqual([['beta', 30]])
    const both = sessionPieces([at(0), tag(5, { client: 'beta', ticket: null, scope: 'session' }), tag(10, { client: 'gamma', ticket: null, scope: 'from-now' }), at(20)], rules)
    expect(both.pieces.map(p => [p.client, mins(p)])).toEqual([['beta', 10], ['gamma', 20]])
  })
  test('turn spans pair by turn id, skip subagent turns, and close an open turn at the next point or after 10 minutes', () => {
    const r = sessionPieces([
      at(0, 'turn-start', { turn: 't1' }), at(3, 'turn-end', { turn: 't1' }),
      at(5, 'turn-start', { turn: 't2' }), at(6, 'turn-end', { turn: 't2', agent: 'a1' }), at(7, 'turn-end', { turn: 't2' }),
      at(8, 'turn-start', { turn: 't3' }), at(12),
      at(40, 'turn-start', { turn: 't4' }),
    ], rules)
    expect(r.turns.map(mins)).toEqual([3, 2, 4, 10])
  })
  test('ticket sources list each (client, ticket, branch, cwd) once', () => {
    expect(sessionPieces([at(0), at(5)], rules).sources).toEqual([{ client: 'acme', ticket: 'ACME-1', branch: 'feat/ACME-1', cwd: '/w/acme' }])
  })
  test('currentAttribution honours tags and falls back to rules', () => {
    const lines = [at(0), at(10, 'tag', { tag: { client: 'beta', ticket: 'B-9', scope: 'from-now' } })]
    expect(currentAttribution(lines, rules, '/w/acme', 'feat/ACME-1', T0 + 20 * 60_000)).toEqual({ client: 'beta', ticket: 'B-9' })
    expect(currentAttribution([], rules, '/w/acme', 'feat/ACME-1', T0)).toEqual({ client: 'acme', ticket: 'ACME-1' })
  })
  test('a session in a worktree outside the client folder counts through the recorded repo', () => {
    const repoRules: Rules = { ...DEFAULT_RULES, clients: [{ id: 'acme', name: 'ACME', paths: ['/w/acme/**'], rate: null, ticketPattern: 'ACME-[0-9]+' }] }
    const repo = { root: '/w/acme', remote: null }
    const at = (min: number, kind: EventLine['kind']): EventLine => ({ v: 1, ts: new Date(T0 + min * 60_000).toISOString(), tz: 0, sid: 's', kind, cwd: '/w/acme.worktrees/x', branch: 'feature/ACME-7-x', repo })
    const { pieces } = sessionPieces([at(0, 'prompt'), at(1, 'turn-start'), at(5, 'turn-end')], repoRules)
    expect(pieces.length).toBeGreaterThan(0)
    expect(pieces.every(p => p.client === 'acme' && p.ticket === 'ACME-7')).toBe(true)
    expect(currentAttribution([], repoRules, '/w/acme.worktrees/x', 'feature/ACME-7-x', T0, repo)).toEqual({ client: 'acme', ticket: 'ACME-7' })
    expect(currentAttribution([], repoRules, '/w/acme.worktrees/x', 'feature/ACME-7-x', T0)).toEqual({ client: null, ticket: null })
  })
})
