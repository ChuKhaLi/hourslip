import { describe, expect, test } from 'claude-code/testing'
import { SESSION, world } from './fixtures/world.ts'

const RULES = JSON.stringify({ v: 1, tzOffsetMinutes: 420, clients: [{ id: 'acme', name: 'ACME', paths: ['/work/acme/**'], ticketPattern: 'ACME-\\d+' }] })
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
  test('after a recording failure clears, the normal text returns', async ($, on) => {
    const w = world(on, { cwd: '/elsewhere', files: { '/home/dev/.hourslip/rules.json': RULES }, failWritesOnce: true })
    await $.session.start(SESSION)
    expect(w.statuses.at(-1)).toBe('⏱ !')
    await $.prompt.submit(prompt)
    expect(w.statuses.at(-1)).toBe('⏱ unassigned · 0h10 today')
  })
})
