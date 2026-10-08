import { describe, expect, test } from 'claude-code/testing'
import { SESSION, type SpawnAnswer, world } from './fixtures/world.ts'

const RULES = JSON.stringify({ v: 1, tzOffsetMinutes: 420, clients: [{ id: 'acme', name: 'ACME Corp', paths: ['F:/work/acme/**'], rate: null, ticketPattern: null }] })
const run = async ($: any, args: string): Promise<string> => (await $.command.run({ command: 'hourslip', args })).text
const H = '/home/dev/.hourslip'
const P = '/home/dev/.claude/projects'

const SID = '11111111-2222-3333-4444-555555555555'
const SID2 = '22222222-2222-3333-4444-555555555555'
const L = (o: object) => JSON.stringify(o)
const NL = String.fromCharCode(10)
const user = (sid: string, ts: string, content: unknown, cwd = 'F:/work/acme') => L({ type: 'user', timestamp: ts, sessionId: sid, cwd, gitBranch: 'feat/ACME-1-x', message: { role: 'user', content } })
const asst = (sid: string, ts: string, cwd = 'F:/work/acme') => L({ type: 'assistant', timestamp: ts, sessionId: sid, cwd, gitBranch: 'feat/ACME-1-x', message: { role: 'assistant', content: [{ type: 'text', text: 'SECRET-REPLY' }] } })
/** One typed prompt and its turn, on `day` at 09:00Z. */
const transcript = (sid: string, day = '2026-09-10', cwd = 'F:/work/acme', prompt = 'SECRET-PROMPT') =>
  [user(sid, `${day}T09:00:00.000Z`, prompt, cwd), asst(sid, `${day}T09:00:05.000Z`, cwd), asst(sid, `${day}T09:40:00.000Z`, cwd)].join('\n') + '\n'
const recorded = (sid: string, day: string) => ['prompt', 'turn-start', 'turn-end'].map((kind, i) =>
  L({ v: 1, ts: `${day}T09:${['00:00', '00:05', '40:00'][i]}.000Z`, tz: 420, sid, kind, cwd: 'F:/work/acme', branch: 'feat/ACME-1-x' })).join('\n') + '\n'

/** The imported session files (`imported/index.json` beside them is the index). */
const importedKeys = (w: { files: Map<string, string> }) => [...w.files.keys()].filter(k => k.startsWith(`${H}/imported/`) && k.endsWith('.jsonl')).sort()
const lines = (text: string | undefined) => (text ?? '').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
const SEPT_11 = Date.parse('2026-09-11T02:00:00Z')

describe('/hourslip import', () => {
  test('preview names what it found, writes nothing, and opens the pane', async ($, on) => {
    const w = world(on, { files: { [`${H}/rules.json`]: RULES, [`${P}/F--work-acme/${SID}.jsonl`]: transcript(SID) } })
    const out = await run($, 'import')
    expect(out).toContain('Found 1 session from 2026-09-10 to 2026-09-10: ACME Corp 0h50.')
    expect(out).toContain('Nothing written yet. Import: /hourslip import --confirm')
    expect(out).not.toMatch(/SECRET/)
    expect(importedKeys(w)).toEqual([])
    expect(w.writes).toEqual([])
    expect(w.panes).toContain('hourslip-week')
    expect(w.titles.at(-1)).toBe('hourslip · import preview')
    expect(w.paneLines()).toEqual(['Import preview: nothing written yet.', '', 'Week of 2026-09-07', 'Thu 09-10  ACME Corp 0h50 (Claude 0h40) · imported', 'Total      ACME Corp 0h50'])
  })
  test('--confirm writes imported/<sid>.jsonl without prompt text; the pane marks the day', async ($, on) => {
    const w = world(on, { now: SEPT_11, files: { [`${H}/rules.json`]: RULES, [`${P}/F--work-acme/${SID}.jsonl`]: transcript(SID) } })
    const out = await run($, 'import --confirm')
    expect(out).toBe('Imported 1 session (0h50). Reports mark these days "from Claude Code transcripts".')
    const text = w.read(`${H}/imported/${SID}.jsonl`)!
    expect(text).not.toMatch(/SECRET/)
    expect(text.trim().split('\n').every(l => l.includes('"src":"transcript"'))).toBe(true)
    expect(lines(text).map(l => l.kind)).toEqual(['prompt', 'turn-start', 'turn-end'])
    expect(importedKeys(w)).toEqual([`${H}/imported/${SID}.jsonl`])
    expect([...w.files.keys()].some(k => k.startsWith(`${H}/events/`))).toBe(false)
    // The confirm pane: every week with imported time, built from what was written.
    expect(w.titles.at(-1)).toBe('hourslip · imported')
    expect(w.paneLines()).toEqual(['Week of 2026-09-07', 'Thu 09-10  ACME Corp 0h50 (Claude 0h40) · imported', 'Total      ACME Corp 0h50', '', 'imported: from Claude Code transcripts (/hourslip import --undo removes them)'])
    const pane = await run($, '')
    expect(pane).toMatch(/Thu 09-10  ACME Corp 0h50 \(Claude 0h40\) · imported/)
  })
  test('--confirm twice gives the same files and the same pane totals', async ($, on) => {
    const w = world(on, { now: SEPT_11, files: { [`${H}/rules.json`]: RULES, [`${P}/F--work-acme/${SID}.jsonl`]: transcript(SID) } })
    const first = await run($, 'import --confirm')
    const keys = importedKeys(w)
    const content = w.read(`${H}/imported/${SID}.jsonl`)
    const pane = await run($, '')
    expect(await run($, 'import --confirm')).toBe(first)
    expect(importedKeys(w)).toEqual(keys)
    expect(w.read(`${H}/imported/${SID}.jsonl`)).toBe(content)
    expect(await run($, '')).toBe(pane)
  })
  test('a session that hourslip recorded (events/<sid>.jsonl) is not imported', async ($, on) => {
    const w = world(on, { files: {
      [`${H}/rules.json`]: RULES,
      [`${P}/F--work-acme/${SID}.jsonl`]: transcript(SID),
      [`${P}/F--work-acme/${SID2}.jsonl`]: transcript(SID2, '2026-09-11'),
      [`${H}/events/${SID2}.jsonl`]: recorded(SID2, '2026-09-11'),
    } })
    expect(await run($, 'import')).toContain('Found 1 session from 2026-09-10 to 2026-09-10')
    await run($, 'import --confirm')
    expect(importedKeys(w)).toEqual([`${H}/imported/${SID}.jsonl`])
  })
  test('readers take a session in both events/ and imported/ from events/ only', async ($, on) => {
    const only = world(on, { now: SEPT_11, files: { [`${H}/rules.json`]: RULES, [`${H}/events/${SID2}.jsonl`]: recorded(SID2, '2026-09-10') } })
    const expected = await run($, '')
    expect(expected).toMatch(/ACME Corp [1-9]|ACME Corp 0h[1-9]/)
    only.files.set(`${H}/imported/${SID2}.jsonl`, recorded(SID2, '2026-09-10').replace(/\}\n/g, ',"src":"transcript"}\n'))
    expect(await run($, '')).toBe(expected)
  })
  test('--undo empties every imported file; a second --undo finds nothing', async ($, on) => {
    const w = world(on, { now: SEPT_11, files: { [`${H}/rules.json`]: RULES, [`${P}/F--work-acme/${SID}.jsonl`]: transcript(SID) } })
    const before = await run($, '')
    await run($, 'import --confirm')
    expect(await run($, 'import --undo')).toBe('Removed 1 imported session.')
    // The engine's fs has no delete: an imported file is emptied, and readers skip an empty one.
    for (const k of importedKeys(w)) expect(w.files.get(k)).toBe('')
    expect(await run($, '')).toBe(before)
    expect(await run($, 'import --undo')).toBe('Nothing imported.')
    expect(await run($, 'import --confirm')).toMatch(/^Imported 1 session \(/)
    expect(lines(w.read(`${H}/imported/${SID}.jsonl`))).toHaveLength(3)
  })
  test('--undo with nothing ever imported', async ($, on) => {
    world(on, { files: { [`${H}/rules.json`]: RULES } })
    expect(await run($, 'import --undo')).toBe('Nothing imported.')
  })
  test('a folder with no client is counted, not imported', async ($, on) => {
    const w = world(on, { files: { [`${H}/rules.json`]: RULES, [`${P}/F--work-acme/${SID}.jsonl`]: transcript(SID), [`${P}/F--work-other/${SID2}.jsonl`]: transcript(SID2, '2026-09-10', 'F:/work/other') } })
    expect(await run($, 'import')).toContain('Found 1 session from 2026-09-10 to 2026-09-10: ACME Corp')
    expect(await run($, 'import')).toContain('1 session in folders with no client (add one with /hourslip client add, then import again).')
    await run($, 'import --confirm')
    expect(importedKeys(w)).toEqual([`${H}/imported/${SID}.jsonl`])
  })
  test('the 30-day sentence appears only when nothing found is older than 25 days', async ($, on) => {
    const w = world(on, { files: { [`${H}/rules.json`]: RULES, [`${P}/F--work-acme/${SID}.jsonl`]: transcript(SID, '2026-10-01') } })
    expect(await run($, 'import')).toContain('Claude Code keeps transcripts 30 days by default (cleanupPeriodDays).')
    w.files.set(`${P}/F--work-acme/${SID2}.jsonl`, transcript(SID2, '2026-09-01'))
    expect(await run($, 'import')).not.toContain('cleanupPeriodDays')
  })
  test('CLAUDE_CONFIG_DIR is where transcripts are read from', async ($, on) => {
    const w = world(on, { env: { CLAUDE_CONFIG_DIR: '/cfg' }, files: { [`${H}/rules.json`]: RULES, [`/cfg/projects/F--work-acme/${SID}.jsonl`]: transcript(SID), [`${P}/F--work-acme/${SID2}.jsonl`]: transcript(SID2) } })
    await run($, 'import --confirm')
    expect(importedKeys(w)).toEqual([`${H}/imported/${SID}.jsonl`])
  })
})

describe('/hourslip import, resumed sessions and the index', () => {
  const U = (sid: string, ts: string, content: unknown, uuid: string) => L({ type: 'user', timestamp: ts, sessionId: sid, uuid, cwd: 'F:/work/acme', gitBranch: 'feat/ACME-1-x', message: { role: 'user', content } })
  const A = (sid: string, ts: string, uuid: string) => L({ type: 'assistant', timestamp: ts, sessionId: sid, uuid, cwd: 'F:/work/acme', gitBranch: 'feat/ACME-1-x', message: { role: 'assistant', content: [] } })
  const orig = (sid: string) => [U(sid, '2026-09-10T09:00:00.000Z', 'p', 'a1'), A(sid, '2026-09-10T09:00:05.000Z', 'a2'), A(sid, '2026-09-10T09:40:00.000Z', 'a3')]
  // Resuming SID in SID2: SID2's file repeats SID's lines (same uuids, SID2's sessionId), then goes on.
  const resumed = [...orig(SID2), U(SID2, '2026-09-11T09:00:00.000Z', 'q', 'b1'), A(SID2, '2026-09-11T09:00:05.000Z', 'b2'), A(SID2, '2026-09-11T09:40:00.000Z', 'b3')].join(NL) + NL
  test('a resumed session counts the lines it repeats once, under the session they came from', async ($, on) => {
    const w = world(on, { now: SEPT_11, files: { [`${H}/rules.json`]: RULES, [`${P}/F--work-acme/${SID}.jsonl`]: orig(SID).join(NL) + NL, [`${P}/F--work-acme/${SID2}.jsonl`]: resumed } })
    expect(await run($, 'import')).toContain('Found 2 sessions from 2026-09-10 to 2026-09-11: ACME Corp 1h40.')
    expect(await run($, 'import --confirm')).toBe('Imported 2 sessions (1h40). Reports mark these days "from Claude Code transcripts".')
    expect(lines(w.read(`${H}/imported/${SID}.jsonl`)).map(l => l.ts.slice(0, 10))).toEqual(['2026-09-10', '2026-09-10', '2026-09-10'])
    expect(lines(w.read(`${H}/imported/${SID2}.jsonl`)).map(l => l.ts.slice(0, 10))).toEqual(['2026-09-11', '2026-09-11', '2026-09-11'])
    expect(await run($, 'import --undo')).toBe('Removed 2 imported sessions.')
  })
  // A first import gives SID its lines and SID2 only its own; then SID's transcript goes away or cannot be read.
  for (const [name, gone] of [
    ['deleted (cleanupPeriodDays)', (f: Map<string, string>) => { f.delete(`${P}/F--work-acme/${SID}.jsonl`) }],
    ['over 4 MiB with no process.spawn', (f: Map<string, string>) => { f.set(`${P}/F--work-acme/${SID}.jsonl`, [...orig(SID), U(SID, '2026-09-10T09:50:00.000Z', 'SECRET '.repeat(700_000), 'a9')].join(NL) + NL) }],
  ] as const) {
    test(`importing again after the original transcript is ${name} leaves the resumed copy's lines where they were`, async ($, on) => {
      const w = world(on, { now: SEPT_11, files: { [`${H}/rules.json`]: RULES, [`${P}/F--work-acme/${SID}.jsonl`]: orig(SID).join(NL) + NL, [`${P}/F--work-acme/${SID2}.jsonl`]: resumed } })
      await run($, 'import --confirm')
      const a = w.read(`${H}/imported/${SID}.jsonl`)
      const b = w.read(`${H}/imported/${SID2}.jsonl`)
      const pane = await run($, '')
      expect(pane).toMatch(/Total {6}ACME Corp 1h40/)
      gone(w.files)
      expect(await run($, 'import')).toContain('Found 1 session from 2026-09-11 to 2026-09-11: ACME Corp 0h50.')
      expect(await run($, 'import --confirm')).toMatch(/^Imported 1 session \(0h50\)\./)
      expect(w.read(`${H}/imported/${SID}.jsonl`)).toBe(a)
      expect(w.read(`${H}/imported/${SID2}.jsonl`)).toBe(b)
      expect(await run($, '')).toBe(pane)
      // And again: the same.
      await run($, 'import --confirm')
      expect(w.read(`${H}/imported/${SID2}.jsonl`)).toBe(b)
      expect(await run($, '')).toBe(pane)
    })
  }
  test('a session whose every line another imported file holds is not written', async ($, on) => {
    const w = world(on, { now: SEPT_11, files: { [`${H}/rules.json`]: RULES, [`${P}/F--work-acme/${SID}.jsonl`]: orig(SID).join(NL) + NL } })
    await run($, 'import --confirm')
    // SID resumed in SID2 and closed at once: SID2's file is only SID's lines; then SID's transcript is gone.
    w.files.delete(`${P}/F--work-acme/${SID}.jsonl`)
    w.files.set(`${P}/F--work-acme/${SID2}.jsonl`, orig(SID2).join(NL) + NL)
    expect(await run($, 'import --confirm')).toBe('Nothing to import.')
    expect(importedKeys(w)).toEqual([`${H}/imported/${SID}.jsonl`])
  })
  test('a failed session write never leaves an index entry older than a file written before it', async ($, on) => {
    let failing = false
    const failWritePattern = { test: (p: string) => failing && p.endsWith(`${SID2}.jsonl`) } as unknown as RegExp
    // Both imported 20 days before the clock (T0 = 2026-10-05), so the status line skips them by the index.
    const w = world(on, { failWritePattern, files: { [`${H}/rules.json`]: RULES, [`${P}/F--work-acme/${SID}.jsonl`]: transcript(SID, '2026-09-15'), [`${P}/F--work-acme/${SID2}.jsonl`]: transcript(SID2, '2026-09-15') } })
    await run($, 'import --confirm')
    // SID goes on today; importing again writes SID's file, then fails on SID2's.
    w.files.set(`${P}/F--work-acme/${SID}.jsonl`, transcript(SID, '2026-09-15') + transcript(SID, '2026-10-05'))
    failing = true
    await run($, 'import --confirm').catch(() => {})
    failing = false
    expect(lines(w.read(`${H}/imported/${SID}.jsonl`))).toHaveLength(6)
    w.reads.length = 0
    await $.session.start(SESSION)
    await $.prompt.submit({ text: 'x', wait: false, origin: { kind: 'composer' } })
    expect(w.reads).toContain(`${H}/imported/${SID}.jsonl`)
  })
  test('--confirm writes the index; the status line no longer reads an old imported session, the pane and export still show it', async ($, on) => {
    // 20 days before the clock (T0 = 2026-10-05); the world's files all have mtime T0, as a fresh import would.
    const w = world(on, { files: { [`${H}/rules.json`]: RULES, [`${P}/F--work-acme/${SID}.jsonl`]: transcript(SID, '2026-09-15') } })
    await run($, 'import --confirm')
    expect(JSON.parse(w.read(`${H}/imported/index.json`)!)).toEqual({ [SID]: Date.parse('2026-09-15T09:40:00.000Z') })
    expect(w.paneLines()).toContain('Tue 09-15  ACME Corp 0h50 (Claude 0h40) · imported')
    w.reads.length = 0
    await $.session.start(SESSION)
    await $.prompt.submit({ text: 'x', wait: false, origin: { kind: 'composer' } })
    expect(w.statuses.length).toBeGreaterThan(0)
    expect(w.reads.some(r => r.startsWith(`${H}/events/`))).toBe(true)
    expect(w.reads).not.toContain(`${H}/imported/${SID}.jsonl`)
    await run($, 'export acme 2026-09')
    expect(w.read(`${H}/exports/hourslip-acme-2026-09-days.csv`)).toMatch(/2026-09-15.*imported/)
    expect(await run($, 'import --undo')).toBe('Removed 1 imported session.')
    expect(w.read(`${H}/imported/index.json`)).toBe('{}' + NL)
  })
  test('with no index (or an unreadable one) every imported file is read', async ($, on) => {
    const w = world(on, { now: SEPT_11, files: { [`${H}/rules.json`]: RULES, [`${P}/F--work-acme/${SID}.jsonl`]: transcript(SID) } })
    await run($, 'import --confirm')
    const before = await run($, '')
    expect(before).toMatch(/Thu 09-10  ACME Corp 0h50/)
    w.files.delete(`${H}/imported/index.json`)
    expect(await run($, '')).toBe(before)
    w.files.set(`${H}/imported/index.json`, '{not json')
    expect(await run($, '')).toBe(before)
  })
})

describe('/hourslip import, large transcripts', () => {
  const BIG = '2'.repeat(8) + '-3333-3333-4444-555555555555'
  const cafe = 'F:/work/acme/café'
  // Over 4 MiB, almost all of it prompt text.
  const big = transcript(BIG, '2026-09-10', cafe, 'SECRET '.repeat(700_000))
  const files = { [`${H}/rules.json`]: RULES, [`${P}/F--work-acme-caf-/${BIG}.jsonl`]: big }
  /** Pieces that cut a line and leave `é` alone in a piece of its own. */
  const pieces: SpawnAnswer = text => {
    const e = text.indexOf('é')
    const mid = Math.floor(text.length / 2)
    return { pieces: [text.slice(0, e), text.slice(e, e + 1), text.slice(e + 1, mid), text.slice(mid)] }
  }

  test('with no process.spawn the file is skipped and counted', async ($, on) => {
    const w = world(on, { files })
    expect(new TextEncoder().encode(big).length).toBeGreaterThan(4 * 1024 * 1024)
    const out = await run($, 'import')
    expect(out).toContain('1 transcript skipped (cannot be read here).')
    expect(out).not.toMatch(/SECRET/)
    expect(await run($, 'import --confirm')).toBe('Nothing to import. 1 transcript skipped (cannot be read here).')
    expect(importedKeys(w)).toEqual([])
  })
  test('read through process.spawn in pieces that cut a line and a multi-byte character', async ($, on) => {
    const w = world(on, { files, spawn: pieces })
    expect(await run($, 'import --confirm')).toMatch(/^Imported 1 session \(/)
    expect(w.spawns).toEqual([['cat', `${P}/F--work-acme-caf-/${BIG}.jsonl`]])
    const text = w.read(`${H}/imported/${BIG}.jsonl`)!
    expect(text).not.toMatch(/SECRET/)
    expect(lines(text).map(l => [l.kind, l.cwd])).toEqual([['prompt', cafe], ['turn-start', cafe], ['turn-end', cafe]])
  })
  test('on Windows the reader is cmd /d /v:off /c type with the native path', async ($, on) => {
    const w = world(on, { files, spawn: pieces, env: { OS: 'Windows_NT' } })
    await run($, 'import')
    expect(w.spawns).toEqual([['cmd', '/d', '/v:off', '/c', 'type', `\\home\\dev\\.claude\\projects\\F--work-acme-caf-\\${BIG}.jsonl`]])
  })
  for (const [name, root, folder, file] of [
    ['a cmd metacharacter in the folder', P, 'F--work-a(b)', `${BIG}.jsonl`],
    ['a space in the file name', P, 'F--work-acme-caf-', `${BIG} x.jsonl`],
    ['a % in the config dir', '/cfg%PATH%/projects', 'F--work-acme-caf-', `${BIG}.jsonl`],
    ['a control character in the config dir', '/cfg\tx/projects', 'F--work-acme-caf-', `${BIG}.jsonl`],
  ] as const) {
    test(`on Windows a path cmd could misread is skipped and counted, never spawned: ${name}`, async ($, on) => {
      const env: Record<string, string> = { OS: 'Windows_NT', ...(root !== P ? { CLAUDE_CONFIG_DIR: root.replace(/[/]projects$/, '') } : {}) }
      const w = world(on, { files: { [`${H}/rules.json`]: RULES, [`${root}/${folder}/${file}`]: big }, spawn: pieces, env })
      expect(await run($, 'import')).toContain('1 transcript skipped (cannot be read here).')
      expect(w.spawns).toEqual([])
    })
  }
  test('a reader that exits non-zero: the session is skipped and counted, never half-imported', async ($, on) => {
    const w = world(on, { files, spawn: text => ({ pieces: [text.slice(0, 1000)], code: 1 }) })
    expect(await run($, 'import --confirm')).toBe('Nothing to import. 1 transcript skipped (cannot be read here).')
    expect(await run($, 'import')).toContain('1 transcript skipped (cannot be read here).')
    expect(importedKeys(w)).toEqual([])
  })
  test('a failed reader keeps out every session its lines carry, not only the one its file name says', async ($, on) => {
    // The big file is named BIG but its lines are SID2's; SID2's other file reads fine.
    const sid2big = [user(SID2, '2026-09-10T08:00:00.000Z', 'p'), asst(SID2, '2026-09-10T08:00:05.000Z'), user(SID2, '2026-09-10T08:30:00.000Z', 'SECRET '.repeat(700_000))].join(NL) + NL
    const w = world(on, { files: { [`${H}/rules.json`]: RULES, [`${P}/F--work-acme/${BIG}.jsonl`]: sid2big, [`${P}/F--work-acme/${SID2}.jsonl`]: transcript(SID2), [`${P}/F--work-acme/${SID}.jsonl`]: transcript(SID, '2026-09-11') },
      spawn: text => ({ pieces: [text.slice(0, text.indexOf(NL, text.indexOf(NL) + 1) + 1)], code: 1 }) })
    expect(await run($, 'import --confirm')).toBe('Imported 1 session (0h50). Reports mark these days "from Claude Code transcripts". 1 transcript skipped (cannot be read here).')
    expect(importedKeys(w)).toEqual([`${H}/imported/${SID}.jsonl`])
  })
})
