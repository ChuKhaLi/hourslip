import { describe, expect, test } from 'claude-code/testing'
import { SESSION, world } from './fixtures/world.ts'

const RULES = JSON.stringify({ v: 1, tzOffsetMinutes: 420, clients: [{ id: 'acme', name: 'ACME', paths: ['/work/acme/**'], ticketPattern: 'ACME-\\d+' }] })
const run = ($: any, args: string) => $.command.run({ command: 'hourslip', args })
const prompt = { text: 'x', wait: false, origin: { kind: 'composer' } } as const

describe('status line', () => {
  test('shows client, ticket and today after the first prompt', async ($, on) => {
    const w = world(on, { files: { '/home/dev/.hourslip/rules.json': RULES } })
    await $.session.start(SESSION)
    await $.prompt.submit(prompt)
    expect(w.statuses.at(-1)).toBe('⏱ ACME · ACME-182 · 0h10 today')
  })
  test('unassigned outside every client path', async ($, on) => {
    const w = world(on, { cwd: '/elsewhere', files: { '/home/dev/.hourslip/rules.json': RULES } })
    await $.session.start(SESSION)
    await $.prompt.submit(prompt)
    expect(w.statuses.at(-1)).toBe('⏱ unassigned · 0h10 today')
  })
  test('a broken rules.json still draws a status (everything Unassigned) and never throws', async ($, on) => {
    const w = world(on, { files: { '/home/dev/.hourslip/rules.json': '{ "v": 1, }' } })
    await $.session.start(SESSION)
    await $.prompt.submit(prompt)
    expect(w.statuses.at(-1)).toBe('⏱ unassigned · 0h10 today')
  })
  test('session.start alone is not presence: 0h00', async ($, on) => {
    const w = world(on, { cwd: '/elsewhere', files: { '/home/dev/.hourslip/rules.json': RULES } })
    await $.session.start(SESSION)
    expect(w.statuses.at(-1)).toBe('⏱ unassigned · 0h00 today')
  })
  test('in a worktree outside the client folder: the client and the worktree ticket', async ($, on) => {
    const w = world(on, {
      cwd: '/work/acme.worktrees/x',
      repo: { root: '/work/acme', remote: null },
      files: { '/home/dev/.hourslip/rules.json': RULES, '/work/acme.worktrees/x/.git': 'gitdir: /work/acme/.git/worktrees/x\n', '/work/acme/.git/worktrees/x/HEAD': 'ref: refs/heads/feature/ACME-7-x\n' },
    })
    await $.session.start(SESSION)
    await $.prompt.submit(prompt)
    expect(w.statuses.at(-1)).toBe('⏱ ACME · ACME-7 · 0h10 today')
  })
  test('a clone anywhere counts for the client that names its remote', async ($, on) => {
    const rules = JSON.stringify({ v: 1, tzOffsetMinutes: 420, clients: [{ id: 'acme', name: 'ACME', paths: [], repos: ['github.com/acme/*'], ticketPattern: 'ACME-[0-9]+' }] })
    const w = world(on, {
      cwd: '/tmp/clone',
      repo: { root: '/tmp/clone', remote: 'git@github.com:Acme/App.git' },
      files: { '/home/dev/.hourslip/rules.json': rules, '/tmp/clone/.git/HEAD': 'ref: refs/heads/feat/ACME-3\n' },
    })
    await $.session.start(SESSION)
    await $.prompt.submit(prompt)
    expect(w.statuses.at(-1)).toBe('⏱ ACME · ACME-3 · 0h10 today')
  })
  test('/hourslip add redraws the status line with the added time, before the next prompt', async ($, on) => {
    const w = world(on, { files: { '/home/dev/.hourslip/rules.json': RULES } })
    await $.session.start(SESSION)
    await $.prompt.submit(prompt)
    expect(w.statuses.at(-1)).toBe('⏱ ACME · ACME-182 · 0h10 today')
    const out = await run($, 'add 30m acme "Call"')
    expect(out.text).toMatch(/Added 0h30 by hand for ACME/)
    expect(w.statuses.at(-1)).toBe('⏱ ACME · ACME-182 · 0h40 today')
  })
  test('a command that fails still redraws, and its reply is unchanged', async ($, on) => {
    const w = world(on, { files: { '/home/dev/.hourslip/rules.json': RULES } })
    await $.session.start(SESSION)
    await $.prompt.submit(prompt)
    const before = w.statuses.length
    const out = await run($, 'add 30m nope "x"')
    expect(out.text).toMatch(/Unknown client "nope"/)
    expect(w.statuses.length).toBe(before + 1)
    expect(w.statuses.at(-1)).toBe('⏱ ACME · ACME-182 · 0h10 today')
  })
  test('after a recording failure clears, the normal text returns', async ($, on) => {
    const w = world(on, { cwd: '/elsewhere', files: { '/home/dev/.hourslip/rules.json': RULES }, failWritesOnce: true })
    await $.session.start(SESSION)
    expect(w.statuses.at(-1)).toBe('⏱ !')
    await $.prompt.submit(prompt)
    expect(w.statuses.at(-1)).toBe('⏱ unassigned · 0h10 today')
  })
})
