import { describe, expect, test } from 'claude-code/testing'
import { commitsFor } from '../hooks/io/git.ts'
import { SESSION, fakeGit, world } from './fixtures/world.ts'

const EVENTS = '/home/dev/.hourslip/events/sess-1.jsonl'
const linesOf = (text: string | undefined) => (text ?? '').trim().split('\n').map(l => JSON.parse(l))

describe('recorder', () => {
  test('session.start and a prompt append lines with branch, cwd and no prompt text', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await $.prompt.submit({ text: 'SECRET PROMPT TEXT', wait: false, origin: { kind: 'composer' } })
    const lines = linesOf(w.read(EVENTS))
    expect(lines.map(l => l.kind)).toEqual(['start', 'prompt'])
    expect(lines[1]).toMatchObject({ v: 1, sid: 'sess-1', cwd: '/work/acme/api', branch: 'feat/ACME-182-login', ts: '2026-10-05T02:00:00.000Z' })
    expect(w.read(EVENTS)).not.toContain('SECRET')
  })
  test('a reload keeps lines already on disk (spec 5.1; Review Focus 3)', async ($, on) => {
    const earlier = JSON.stringify({ v: 1, ts: '2026-10-05T01:00:00.000Z', tz: 420, sid: 'sess-1', kind: 'prompt', cwd: '/work/acme/api', branch: null })
    const w = world(on, { files: { [EVENTS]: earlier + '\n' } })
    await $.prompt.submit({ text: 'x', wait: false, origin: { kind: 'composer' } })
    expect(linesOf(w.read(EVENTS)).map(l => l.ts)).toEqual(['2026-10-05T01:00:00.000Z', '2026-10-05T02:00:00.000Z'])
  })
  test('turn.complete records turn-end with the agent id for subagent turns', async ($, on) => {
    const w = world(on)
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', agentId: 'a1', reason: 'answer' })
    expect(linesOf(w.read(EVENTS))[0]).toMatchObject({ kind: 'turn-end', turn: 't1', agent: 'a1' })
  })
  test('a failing disk never throws out of a hook, sets ⏱ ! once, and toasts once', async ($, on) => {
    const w = world(on, { failWrites: true })
    await $.session.start(SESSION)
    await $.prompt.submit({ text: 'x', wait: false, origin: { kind: 'composer' } })
    expect(w.statuses.at(-1)).toBe('⏱ !')
    expect(w.toasts.filter(t => t.includes('hourslip')).length).toBe(1)
  })
  test('no repository records branch null', async ($, on) => {
    const w = world(on, { branchHead: null })
    await $.prompt.submit({ text: 'x', wait: false, origin: { kind: 'composer' } })
    expect(linesOf(w.read(EVENTS))[0].branch).toBeNull()
  })
  test('a transient read error after a reload never truncates the session file', async ($, on) => {
    const earlier = JSON.stringify({ v: 1, ts: '2026-10-05T01:00:00.000Z', tz: 420, sid: 'sess-1', kind: 'prompt', cwd: '/work/acme/api', branch: null })
    const w = world(on, { files: { [EVENTS]: earlier + '\n' }, busyReads: 1 })
    await $.prompt.submit({ text: 'x', wait: false, origin: { kind: 'composer' } })
    expect(w.statuses.at(-1)).toBe('⏱ !')
    expect(w.read(EVENTS)).toBe(earlier + '\n')
    await $.prompt.submit({ text: 'y', wait: false, origin: { kind: 'composer' } })
    expect(linesOf(w.read(EVENTS)).map(l => l.ts)).toEqual(['2026-10-05T01:00:00.000Z', '2026-10-05T02:00:00.000Z'])
  })
})

describe('commitsFor', () => {
  test('a branch that looks like an option is never given to git', async () => {
    const g = fakeGit()
    const r = await commitsFor(g.engine, [{ client: 'acme', ticket: 'ACME-1', branch: '--output=x', cwd: '/work/acme/api' }], 'Dev', '2026-10-01', '2026-10-05')
    expect(r.unavailable).toBe(1)
    expect(g.runs.some(argv => argv.some(a => a.includes('--output')))).toBe(false)
  })
  test('a normal branch ends the argv after --end-of-options and the author is literal', async () => {
    const g = fakeGit()
    const r = await commitsFor(g.engine, [{ client: 'acme', ticket: 'ACME-1', branch: 'feat/ACME-1-x', cwd: '/work/acme/api' }], 'a.b (dev)', '2026-10-01', '2026-10-05')
    expect(r.commits['ACME-1']).toEqual(['fix login', 'add tests'])
    const argv = g.runs[0]
    expect(argv.slice(-2)).toEqual(['--end-of-options', 'feat/ACME-1-x'])
    expect(argv).toContain('--fixed-strings')
    expect(argv).toContain('--author=a.b (dev)')
  })
})
