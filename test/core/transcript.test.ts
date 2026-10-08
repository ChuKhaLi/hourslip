import { describe, expect, test } from 'vitest'
import { DEFAULT_RULES } from '../../plugin/hooks/core/rules.ts'
import { buildTimesheet } from '../../plugin/hooks/core/timesheet.ts'
import { lineSplitter, slimTranscriptLine, transcriptEvents } from '../../plugin/hooks/core/transcript.ts'
import type { Rules } from '../../plugin/hooks/core/types.ts'

const SID = '11111111-2222-3333-4444-555555555555'
const L = (o: object) => JSON.stringify(o)
const user = (ts: string, content: unknown, extra: object = {}) => L({ type: 'user', timestamp: ts, sessionId: SID, cwd: 'F:/work/acme', gitBranch: 'feat/ACME-1-x', message: { role: 'user', content }, ...extra })
const asst = (ts: string) => L({ type: 'assistant', timestamp: ts, sessionId: SID, cwd: 'F:/work/acme', gitBranch: 'feat/ACME-1-x', message: { role: 'assistant', content: [{ type: 'text', text: 'SECRET-REPLY' }] } })

describe('transcriptEvents', () => {
  test('a typed prompt and its turn become prompt, turn-start, turn-end', () => {
    const r = transcriptEvents([user('2026-09-10T09:00:00.000Z', 'SECRET-PROMPT'), asst('2026-09-10T09:00:05.000Z'), asst('2026-09-10T09:02:00.000Z')], 420)
    expect(r.events.map(e => [e.kind, e.ts])).toEqual([['prompt', '2026-09-10T09:00:00.000Z'], ['turn-start', '2026-09-10T09:00:05.000Z'], ['turn-end', '2026-09-10T09:02:00.000Z']])
    expect(r.events.every(e => e.src === 'transcript' && e.sid === SID && e.cwd === 'F:/work/acme' && e.branch === 'feat/ACME-1-x' && e.tz === 420)).toBe(true)
  })
  test('meta, sidechain, array content and unknown types are not prompts', () => {
    const r = transcriptEvents([
      user('2026-09-10T09:00:00.000Z', 'x', { isMeta: true }),
      user('2026-09-10T09:01:00.000Z', 'x', { isSidechain: true }),
      user('2026-09-10T09:02:00.000Z', [{ type: 'tool_result', content: 'SECRET' }]),
      L({ type: 'summary', summary: 'SECRET', timestamp: '2026-09-10T09:03:00.000Z', sessionId: SID }),
    ], 420)
    expect(r.events.filter(e => e.kind === 'prompt')).toEqual([])
  })
  test('malformed lines are skipped and counted', () => {
    expect(transcriptEvents(['{not json', '', L({ type: 'user' })], 0).skipped).toBe(2)
  })
  test('the last assistant line before the next prompt ends the turn', () => {
    const r = transcriptEvents([user('2026-09-10T09:00:00.000Z', 'a'), asst('2026-09-10T09:00:05.000Z'), asst('2026-09-10T09:01:00.000Z'), user('2026-09-10T09:30:00.000Z', 'b'), asst('2026-09-10T09:30:04.000Z')], 0)
    expect(r.events.map(e => e.kind)).toEqual(['prompt', 'turn-start', 'turn-end', 'prompt', 'turn-start', 'turn-end'])
  })
  test('no prompt or reply text survives anywhere in the output', () => {
    const r = transcriptEvents([user('2026-09-10T09:00:00.000Z', 'SECRET-PROMPT'), asst('2026-09-10T09:00:05.000Z')], 0)
    expect(JSON.stringify(r)).not.toMatch(/SECRET/)
  })
  test('a null gitBranch stays null; a missing cwd is an empty string', () => {
    const r = transcriptEvents([L({ type: 'user', timestamp: '2026-09-10T09:00:00.000Z', sessionId: SID, gitBranch: null, message: { content: 'a' } })], 0)
    expect(r.events[0]).toMatchObject({ cwd: '', branch: null })
  })
})

describe('transcriptEvents order and filtering', () => {
  const A = [user('2026-09-10T09:00:00.000Z', 'a', { uuid: 'u1' }), asst('2026-09-10T09:00:05.000Z'), asst('2026-09-10T09:01:00.000Z')]
  const B = [user('2026-09-10T09:30:00.000Z', 'b', { uuid: 'u2' }), asst('2026-09-10T09:30:04.000Z')]
  test('the same session split across two inputs gives the same events in either order', () => {
    const fwd = transcriptEvents([...A, ...B], 0)
    expect(transcriptEvents([...B, ...A], 0)).toEqual(fwd)
    expect(fwd.events.map(e => e.kind)).toEqual(['prompt', 'turn-start', 'turn-end', 'prompt', 'turn-start', 'turn-end'])
  })
  test('a turn split across inputs read in reverse still pairs with its prompt', () => {
    expect(transcriptEvents([A[1], A[2], A[0]], 0)).toEqual(transcriptEvents(A, 0))
  })
  test('lines duplicated in two files give one event', () => {
    expect(transcriptEvents([...A, ...B, ...A], 0)).toEqual(transcriptEvents([...A, ...B], 0))
  })
  test('interleaved sids stay separate', () => {
    const S2 = 'aaaaaaaa-2222-3333-4444-555555555555'
    const other = L({ type: 'user', timestamp: '2026-09-10T09:00:02.000Z', sessionId: S2, message: { content: 'z' } })
    const r = transcriptEvents([A[0], other, A[1], A[2]], 0)
    expect(r.events.map(e => [e.sid, e.kind])).toEqual([[SID, 'prompt'], [SID, 'turn-start'], [SID, 'turn-end'], [S2, 'prompt']])
  })
  test('assistant lines before the first prompt and sidechain assistant lines are ignored', () => {
    const side = L({ type: 'assistant', isSidechain: true, timestamp: '2026-09-10T09:05:00.000Z', sessionId: SID, message: {} })
    const r = transcriptEvents([asst('2026-09-10T08:00:00.000Z'), ...A, side], 0)
    expect(r.events.map(e => [e.kind, e.ts])).toEqual([['prompt', '2026-09-10T09:00:00.000Z'], ['turn-start', '2026-09-10T09:00:05.000Z'], ['turn-end', '2026-09-10T09:01:00.000Z']])
  })
  test('a junk timestamp is skipped', () => {
    const r = transcriptEvents([L({ type: 'user', timestamp: 'junk', sessionId: SID, message: { content: 'a' } })], 0)
    expect(r).toEqual({ events: [], skipped: 1 })
  })
  test('local command output is not a prompt; a command echo is', () => {
    const r = transcriptEvents([user('2026-09-10T09:00:00.000Z', '<local-command-stdout>x</local-command-stdout>'), user('2026-09-10T09:01:00.000Z', '<local-command-stderr>x'), user('2026-09-10T09:02:00.000Z', '<command-name>/foo</command-name>')], 0)
    expect(r.events.map(e => e.ts)).toEqual(['2026-09-10T09:02:00.000Z'])
  })
})

describe('transcriptEvents turn ids (Claude time)', () => {
  const RULES: Rules = { ...DEFAULT_RULES, tzOffsetMinutes: 0, clients: [{ id: 'acme', name: 'ACME', paths: ['F:/work/acme/**'], rate: null, ticketPattern: null }] }
  test('each turn carries one id on its prompt and both of its events: the prompt uuid, else sid:prompt ms', () => {
    const r = transcriptEvents([user('2026-09-10T09:00:00.000Z', 'a', { uuid: 'u1' }), asst('2026-09-10T09:00:05.000Z'), asst('2026-09-10T09:01:00.000Z'), user('2026-09-10T09:30:00.000Z', 'b'), asst('2026-09-10T09:30:04.000Z'), user('2026-09-10T09:50:00.000Z', 'c', { uuid: 'u3' })], 0)
    const b = `${SID}:${Date.parse('2026-09-10T09:30:00.000Z')}`
    expect(r.events.map(e => [e.kind, e.turn])).toEqual([
      ['prompt', 'u1'], ['turn-start', 'u1'], ['turn-end', 'u1'],
      ['prompt', b], ['turn-start', b], ['turn-end', b],
      ['prompt', 'u3'],
    ])
  })
  test('buildTimesheet over imported events gives Claude time', () => {
    const r = transcriptEvents([user('2026-09-10T09:00:00.000Z', 'a', { uuid: 'u1' }), asst('2026-09-10T09:00:05.000Z'), asst('2026-09-10T09:40:00.000Z')], 0)
    const ts = buildTimesheet({ sessions: [r.events], manual: [], rules: RULES, from: '2026-09-01', to: '2026-09-30' })
    expect(ts.rows.reduce((s, row) => s + row.claudeMinutes, 0)).toBeGreaterThan(0)
  })
})

describe('transcriptEvents across resumed sessions', () => {
  const B = 'bbbbbbbb-2222-3333-4444-555555555555'
  const A = '00000000-2222-3333-4444-555555555555'
  const Z = 'ffffffff-2222-3333-4444-555555555555'
  const line = (sid: string, type: 'user' | 'assistant', ts: string, uuid: string) =>
    L({ type, timestamp: ts, sessionId: sid, uuid, cwd: 'F:/work/acme', gitBranch: 'main', message: { content: type === 'user' ? 'p' : [] } })
  const orig = (sid: string) => [line(sid, 'user', '2026-09-10T09:00:00.000Z', 'a1'), line(sid, 'assistant', '2026-09-10T09:00:05.000Z', 'a2'), line(sid, 'assistant', '2026-09-10T09:20:00.000Z', 'a3')]
  // The resumed session's file repeats the original's lines (same uuids, its own sessionId), then goes on.
  const resumed = (from: string, sid: string) => [...orig(from).map(l => l.replace(from, sid)), line(sid, 'user', '2026-09-11T10:00:00.000Z', 'b1'), line(sid, 'assistant', '2026-09-11T10:00:05.000Z', 'b2')]
  const kinds = (r: ReturnType<typeof transcriptEvents>, sid: string) => r.events.filter(e => e.sid === sid).map(e => [e.kind, e.ts])
  for (const [name, first, second] of [['the resumed sid sorts after', A, B], ['the resumed sid sorts before', Z, B]] as const) {
    test(`a uuid under two sids belongs to the original session (${name})`, () => {
      const r = transcriptEvents([...orig(first), ...resumed(first, second)], 0)
      expect(kinds(r, first)).toEqual([['prompt', '2026-09-10T09:00:00.000Z'], ['turn-start', '2026-09-10T09:00:05.000Z'], ['turn-end', '2026-09-10T09:20:00.000Z']])
      expect(kinds(r, second)).toEqual([['prompt', '2026-09-11T10:00:00.000Z'], ['turn-start', '2026-09-11T10:00:05.000Z'], ['turn-end', '2026-09-11T10:00:05.000Z']])
      expect(transcriptEvents([...resumed(first, second)].reverse().concat([...orig(first)].reverse()), 0)).toEqual(r)
    })
  }
  test('a prompt uuid already taken (imported under another session) is dropped with its turn, from every session', () => {
    // Two copies of A's lines (A resumed twice), each going on with lines of its own.
    const z = resumed(A, Z).map(l => l.replace(/"uuid":"b/, '"uuid":"z'))
    const r = transcriptEvents([...resumed(A, B), ...z], 0, new Set(['a1']))
    expect(kinds(r, A)).toEqual([])
    expect(kinds(r, B)).toEqual([['prompt', '2026-09-11T10:00:00.000Z'], ['turn-start', '2026-09-11T10:00:05.000Z'], ['turn-end', '2026-09-11T10:00:05.000Z']])
    expect(kinds(r, Z)).toEqual(kinds(r, B))
    expect(transcriptEvents([...z, ...resumed(A, B)].reverse(), 0, new Set(['a1']))).toEqual(r)
    // A lone copy (the original's file gone): the same.
    expect(kinds(transcriptEvents(resumed(A, B), 0, new Set(['a1'])), B)).toEqual(kinds(r, B))
    // Only a uuid is ever taken: a sid:ms id names its own session.
    expect(kinds(transcriptEvents(resumed(A, B), 0, new Set([`${B}:${Date.parse('2026-09-11T10:00:00.000Z')}`])), B)).toHaveLength(6)
  })
})

describe('lineSplitter', () => {
  test('reassembles a line split across chunks and keeps CRLF out', () => {
    const s = lineSplitter()
    expect(s.push('{"a":1}\r\n{"b"')).toEqual(['{"a":1}'])
    expect(s.push(':2}\n')).toEqual(['{"b":2}'])
    expect(s.end()).toEqual([])
  })
  test('a CR at the end of one chunk and LF at the start of the next', () => {
    const CR = String.fromCharCode(13), LF = String.fromCharCode(10)
    const s = lineSplitter()
    expect(s.push('a' + CR)).toEqual([])
    expect(s.push(LF + 'b' + LF)).toEqual(['a', 'b'])
  })
  test('end() returns a last line with no newline', () => {
    const s = lineSplitter(); s.push('x')
    expect(s.end()).toEqual(['x'])
  })
})

describe('slimTranscriptLine', () => {
  const lines = [
    user('2026-09-10T09:00:00.000Z', 'SECRET-PROMPT', { uuid: 'u1' }),
    asst('2026-09-10T09:00:05.000Z'),
    user('2026-09-10T09:00:06.000Z', '<local-command-stdout>SECRET</local-command-stdout>'),
    user('2026-09-10T09:00:07.000Z', '<local-command-stderr>SECRET</local-command-stderr>'),
    user('2026-09-10T09:01:00.000Z', 'x', { isMeta: true }),
    user('2026-09-10T09:02:00.000Z', 'x', { isSidechain: true }),
    user('2026-09-10T09:03:00.000Z', [{ type: 'tool_result', content: 'SECRET' }]),
    user('2026-09-10T09:30:00.000Z', 'SECRET-2', { uuid: 'u2' }),
    asst('2026-09-10T09:30:04.000Z'),
    '{not json SECRET', '', '   ', '3', 'null', '[1]', L({ type: 'user' }), L({ type: 'user', timestamp: 'x', sessionId: SID, message: 'SECRET' }),
  ]
  test('gives transcriptEvents the same result as the full line', () => {
    expect(transcriptEvents(lines.map(slimTranscriptLine), 420)).toEqual(transcriptEvents(lines, 420))
  })
  test('keeps no prompt or reply text', () => {
    expect(lines.map(slimTranscriptLine).join('\n')).not.toMatch(/SECRET/)
  })
})
