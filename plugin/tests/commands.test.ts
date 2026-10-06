import { describe, expect, test } from 'claude-code/testing'
import { SESSION, world } from './fixtures/world.ts'

const RULES = JSON.stringify({ v: 1, tzOffsetMinutes: 420, business: { name: 'Alex Doe', paymentInstructions: 'Wise' }, clients: [{ id: 'acme', name: 'ACME', paths: ['/work/acme/**'], rate: { amount: 40, currency: 'USD' }, ticketPattern: 'ACME-[0-9]+' }] })
const run = ($: any, args: string) => $.command.run({ command: 'hourslip', args })
const prompt = { text: 'x', wait: false, origin: { kind: 'composer' } } as const

describe('/hourslip', () => {
  test('tag writes a tag event and validates the client', async ($, on) => {
    const w = world(on, { files: { '/home/dev/.hourslip/rules.json': RULES } })
    await $.session.start(SESSION)
    await $.prompt.submit(prompt)
    expect((await run($, 'tag nope')).text).toMatch(/Unknown client "nope".*acme/s)
    expect((await run($, 'tag acme ACME-7 --session')).text).toMatch(/whole session/)
    const kinds = w.read('/home/dev/.hourslip/events/sess-1.jsonl')!.trim().split('\n').map(l => JSON.parse(l).kind)
    expect(kinds).toEqual(['start', 'prompt', 'tag'])
    const last = JSON.parse(w.read('/home/dev/.hourslip/events/sess-1.jsonl')!.trim().split('\n').at(-1)!)
    expect(last).toMatchObject({ kind: 'tag', tag: { client: 'acme', ticket: 'ACME-7', scope: 'session' } })
  })
  test('add appends a manual line dated today by default', async ($, on) => {
    const w = world(on, { files: { '/home/dev/.hourslip/rules.json': RULES } })
    expect((await run($, 'add 1h30 acme "Call"')).text).toMatch(/1h30.*ACME.*2026-10-05/)
    expect(JSON.parse(w.read('/home/dev/.hourslip/manual.jsonl')!.trim())).toEqual({ v: 1, date: '2026-10-05', minutes: 90, client: 'acme', ticket: null, note: 'Call' })
  })
  test('client add creates rules.json and refuses a duplicate id', async ($, on) => {
    const w = world(on)
    expect((await run($, 'client add beta "Beta Ltd" --path /work/beta/**')).text).toMatch(/Added client beta/)
    expect(JSON.parse(w.read('/home/dev/.hourslip/rules.json')!).clients[0]).toEqual({ id: 'beta', name: 'Beta Ltd', paths: ['/work/beta/**'], rate: null, ticketPattern: null })
    expect((await run($, 'client add beta "Again" --path /x/**')).text).toMatch(/already exists/)
  })
  test('export names the CSV that another program holds open, without repeating the prefix', async ($, on) => {
    // On a real host the rejection reads "hourslip: $.fs.write(<path>) failed: EBUSY"; the kit's deny reads "hourslip: $.fs.write: EBUSY".
    world(on, { files: { '/home/dev/.hourslip/rules.json': RULES }, failWritePattern: /days[.]csv$/, failWriteMessage: 'EBUSY' })
    const out = (await run($, 'export acme 2026-10')).text
    expect(out).toBe('Could not write /home/dev/.hourslip/exports/hourslip-acme-2026-10-days.csv: it is open in another program (Excel?). Close it and run export again.')
  })
  test('any other failure is reported once, without a hourslip prefix (Claude Code adds its own)', async ($, on) => {
    world(on, { files: { '/home/dev/.hourslip/rules.json': RULES }, failWrites: true, failWriteMessage: 'EACCES' })
    expect((await run($, 'add 1h acme "x"')).text).toBe('$.fs.write: EACCES')
  })
  test('client add refuses to overwrite a rules.json it cannot parse', async ($, on) => {
    const w = world(on, { files: { '/home/dev/.hourslip/rules.json': '{ broken' } })
    expect((await run($, 'client add beta "Beta" --path /b/**')).text).toMatch(/not valid JSON/)
    expect(w.read('/home/dev/.hourslip/rules.json')).toBe('{ broken')
  })
  test('export writes two CSVs and, for one client, an escaped HTML preview', async ($, on) => {
    const w = world(on, { files: { '/home/dev/.hourslip/rules.json': RULES } })
    await $.session.start(SESSION)
    await $.prompt.submit(prompt)
    const out = (await run($, 'export acme 2026-10')).text
    expect(out).toMatch(/hourslip-acme-2026-10-days\.csv/)
    expect(w.read('/home/dev/.hourslip/exports/hourslip-acme-2026-10-days.csv')).toMatch(/^﻿Date,Weekday/)
    expect(w.read('/home/dev/.hourslip/exports/hourslip-acme-2026-10-tickets.csv')).toMatch(/ACME-182/)
    expect(w.read('/home/dev/.hourslip/exports/hourslip-acme-2026-10-preview.html')).toMatch(/Made with hourslip/)
  })
  test('a transient read error on rules.json during client add changes nothing', async ($, on) => {
    const w = world(on, { files: { '/home/dev/.hourslip/rules.json': RULES }, busyOnce: /rules[.]json$/ })
    const out = (await run($, 'client add beta "Beta" --path /b/**')).text
    expect(out).toMatch(/hourslip could not read .*rules[.]json: [^]*Nothing was changed\./)
    expect(w.read('/home/dev/.hourslip/rules.json')).toBe(RULES)
    expect(w.writes).toEqual([])
  })
  test('a transient read error on manual.jsonl during add changes nothing', async ($, on) => {
    const manual = '{"v":1,"date":"2026-10-01","minutes":60,"client":"acme","ticket":null,"note":"keep"}\n'
    const w = world(on, { files: { '/home/dev/.hourslip/rules.json': RULES, '/home/dev/.hourslip/manual.jsonl': manual }, busyOnce: /manual[.]jsonl$/ })
    const out = (await run($, 'add 1h acme "Call"')).text
    expect(out).toMatch(/hourslip could not read .*manual[.]jsonl: [^]*Nothing was changed\./)
    expect(w.read('/home/dev/.hourslip/manual.jsonl')).toBe(manual)
    expect(w.writes).toEqual([])
  })
  test('a corrupt rules.json is named by tag, add and export, not reported as an unknown client', async ($, on) => {
    world(on, { files: { '/home/dev/.hourslip/rules.json': '{ broken' } })
    await $.session.start(SESSION)
    for (const args of ['tag acme', 'add 1h acme "x"', 'export acme 2026-10']) {
      const out = (await run($, args)).text
      expect(out).toMatch(/not valid JSON/)
      expect(out).toMatch(/Fix rules[.]json first/)
      expect(out).not.toMatch(/Unknown client/)
    }
  })
  test('the status line shows the new tag right after /hourslip tag', async ($, on) => {
    const w = world(on, { files: { '/home/dev/.hourslip/rules.json': RULES } })
    await $.session.start(SESSION)
    await $.prompt.submit(prompt)
    await run($, 'tag acme ACME-7')
    expect(w.statuses.at(-1)).toMatch(/ACME · ACME-7/)
  })
  test('unreadable manual lines are reported by the pane and the export, and the preview says what it lacks', async ($, on) => {
    const manual = 'not json\n{"v":1,"date":"2026-10-05","minutes":30,"client":"acme","ticket":null,"note":"ok"}\n'
    const w = world(on, { files: { '/home/dev/.hourslip/rules.json': RULES, '/home/dev/.hourslip/manual.jsonl': manual }, gitThrows: true })
    await $.session.start(SESSION)
    await $.prompt.submit(prompt)
    expect((await run($, '')).text).toMatch(/1 unreadable manual lines were skipped/)
    const out = (await run($, 'export acme 2026-10')).text
    expect(out).toMatch(/1 unreadable manual lines were skipped/)
    const html = w.read('/home/dev/.hourslip/exports/hourslip-acme-2026-10-preview.html')!
    expect(html).toMatch(/Commit titles were unavailable for 1 branch/)
    expect(html).toMatch(/1 unreadable manual lines were skipped/)
  })
  test('the pane lists this week and the tz probe answers', async ($, on) => {
    const w = world(on, { files: { '/home/dev/.hourslip/rules.json': RULES } })
    await $.session.start(SESSION)
    expect((await run($, '')).text).toMatch(/Week of 2026-10-05/)
    expect(w.panes).toEqual(['hourslip-week'])
    expect((await run($, 'tz')).text).toMatch(/UTC\+07:00 \(from rules\.json\)/)
  })
  test('anything else returns the usage', async ($, on) => {
    world(on)
    expect((await run($, 'dance')).text).toMatch(/^Usage:/)
  })
  test('the export preview escapes names and asks git only about the chosen client', async ($, on) => {
    const evil = JSON.stringify({ v: 1, tzOffsetMinutes: 420, clients: [
      { id: 'acme', name: '<script>alert(1)</script> "ACME"', paths: ['/work/acme/**'], rate: null, ticketPattern: 'ACME-[0-9]+' },
      { id: 'other', name: 'Other', paths: ['/work/other/**'], rate: null, ticketPattern: 'OTH-[0-9]+' },
    ] })
    const w = world(on, { files: { '/home/dev/.hourslip/rules.json': evil } })
    await $.session.start(SESSION)
    await $.prompt.submit(prompt)
    await run($, 'export acme 2026-10')
    const html = w.read('/home/dev/.hourslip/exports/hourslip-acme-2026-10-preview.html')!
    expect(html).not.toContain('<script>alert(1)')
    expect(html).toContain('&lt;script&gt;')
    expect(w.runs.every(argv => argv[0] === 'git')).toBe(true)
    expect(w.runs.some(argv => argv.includes('feat/ACME-182-login'))).toBe(true)
  })
  test('a failing preview still returns the CSV paths and says why', async ($, on) => {
    const w = world(on, { files: { '/home/dev/.hourslip/rules.json': RULES }, failWritePattern: /preview[.]html$/ })
    await $.session.start(SESSION)
    await $.prompt.submit(prompt)
    const out = (await run($, 'export acme 2026-10')).text
    expect(out).toMatch(/days[.]csv/)
    expect(out).toMatch(/tickets[.]csv/)
    expect(out).toMatch(/The preview could not be written: /)
    expect(w.read('/home/dev/.hourslip/exports/hourslip-acme-2026-10-days.csv')).toBeDefined()
  })
  test('a throwing git still returns the CSV paths', async ($, on) => {
    world(on, { files: { '/home/dev/.hourslip/rules.json': RULES }, gitThrows: true })
    await $.session.start(SESSION)
    await $.prompt.submit(prompt)
    const out = (await run($, 'export acme 2026-10')).text
    expect(out).toMatch(/days[.]csv/)
    expect(out).toMatch(/tickets[.]csv/)
    expect(out).toMatch(/Commit titles were unavailable|The preview could not be written/)
  })
  test('overlapping clients are called out', async ($, on) => {
    const two = JSON.stringify({ v: 1, tzOffsetMinutes: 420, clients: [
      { id: 'acme', name: 'ACME', paths: ['/work/acme/**'], rate: null, ticketPattern: null },
      { id: 'other', name: 'Other', paths: ['/work/other/**'], rate: null, ticketPattern: null },
    ] })
    const sess2 = ['prompt', 'turn-end'].map((kind, i) => JSON.stringify({ v: 1, ts: new Date(Date.parse('2026-10-05T02:03:00Z') + i * 60000).toISOString(), tz: 420, sid: 'sess-2', kind, cwd: '/work/other/x', branch: null })).join('\n') + '\n'
    world(on, { files: { '/home/dev/.hourslip/rules.json': two, '/home/dev/.hourslip/events/sess-2.jsonl': sess2 } })
    await $.session.start(SESSION)
    await $.prompt.submit(prompt)
    expect((await run($, 'export 2026-10')).text).toMatch(/Overlapping clients on 2026-10-05/)
  })
  test('the pane draws the week lines on every surface', async ($, on) => {
    world(on, { files: { '/home/dev/.hourslip/rules.json': RULES } })
    await $.session.start(SESSION)
    await $.prompt.submit(prompt)
    await run($, '')
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({
        plugin: 'hourslip', surface, component: 'Pane', requestId: 'hourslip-week',
        props: { title: 'hourslip', isFocused: false, bodyColumns: 80, placement: 'inline', scroll: { bodyRows: 20, offset: 0, total: 20 }, view: {} } as never,
        viewport: { columns: 100, rows: 30 },
      })
      expect(await ui.find({ type: 'Text', text: /Week of 2026-10-05/ })).toBeDefined()
      await ui.unmount()
    }
  })
})
