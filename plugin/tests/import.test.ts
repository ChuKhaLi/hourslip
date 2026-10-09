import { describe, expect, test } from 'claude-code/testing'
import { SESSION, type SpawnAnswer, world } from './fixtures/world.ts'
import { VERSION } from '../hooks/core/version.ts'
import { runCommand } from '../hooks/io/commands.ts'
import { createRecorder } from '../hooks/io/recorder.ts'

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
    expect(await run($, 'import --undo')).toBe('Removed 1 imported session and the import cache.')
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
    expect(await run($, 'import --undo')).toBe('Removed 2 imported sessions and the import cache.')
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
    expect(await run($, 'import --undo')).toBe('Removed 1 imported session and the import cache.')
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

const CACHE = `${H}/import-cache/index.json`
const RECORDS = `${H}/import-cache/records/`
const cacheKeys = (w: { files: Map<string, string> }) => [...w.files.keys()].filter(k => k.startsWith(`${H}/import-cache/`)).sort()
/** The records files of one transcript, as the index names them. */
const shardFiles = (w: { read(p: string): string | undefined }, path: string): string[] => {
  const e = JSON.parse(w.read(CACHE)!).files[path]
  if (!e || e.shard === null) return []
  return e.parts === 1 ? [`${RECORDS}${e.shard}.jsonl`] : Array.from({ length: e.parts }, (_, i) => `${RECORDS}${e.shard}.${i + 1}.jsonl`)
}
const transcriptReads = (w: { reads: string[] }) => w.reads.filter(r => r.startsWith(`${P}/`) || r.startsWith('/cfg'))

describe('/hourslip import, the scan cache', () => {
  const ACME = `${P}/F--work-acme/${SID}.jsonl`
  const OTHER = `${P}/F--work-other/${SID2}.jsonl`
  const files = () => ({ [`${H}/rules.json`]: RULES, [ACME]: transcript(SID), [OTHER]: transcript(SID2, '2026-09-09', 'F:/work/other') })
  const again = async ($: any, w: { reads: string[] }, args = 'import') => { w.reads.length = 0; return run($, args) }
  const cache = (w: { read(p: string): string | undefined }) => JSON.parse(w.read(CACHE)!)
  test('a preview writes no file at all, not even the cache', async ($, on) => {
    const w = world(on, { files: files() })
    expect(await run($, 'import')).toContain('1 session in folders with no client')
    expect(w.reads).toContain(OTHER)
    expect(w.writes).toEqual([])
    expect(await again($, w)).toContain('1 session in folders with no client')
    expect(w.reads).toContain(OTHER)
    expect(w.writes).toEqual([])
  })
  test('--confirm lists every transcript with its records; later imports read no transcript while they and the clients are unchanged, and say the same', async ($, on) => {
    const w = world(on, { files: files() })
    const first = await run($, 'import')
    expect(first).toContain('Found 1 session from 2026-09-10 to 2026-09-10: ACME Corp 0h50. 1 session in folders with no client')
    const confirmed = await run($, 'import --confirm')
    expect(confirmed).toBe('Imported 1 session (0h50). Reports mark these days "from Claude Code transcripts".')
    const c = cache(w)
    expect(c).toMatchObject({ v: 2, key: [VERSION, [['acme', ['F:/work/acme/**']]]], files: {
      [OTHER]: { size: transcript(SID2, '2026-09-09', 'F:/work/other').length, mtimeMs: expect.any(Number), sids: [SID2], counted: [SID2], candidate: false, shard: expect.stringMatching(/^[0-9a-f]{16}$/), parts: 1 },
      [ACME]: { sids: [SID], candidate: true, parts: 1 },
    } })
    // The records: the fields imported/ keeps, never content.
    const recs = w.read(shardFiles(w, ACME)[0])!.trim().split('\n').slice(1).map(l => JSON.parse(l))
    expect(recs).toEqual([
      { ts: '2026-09-10T09:00:00.000Z', sid: SID, cwd: 'F:/work/acme', branch: 'feat/ACME-1-x', role: 'prompt', uuid: null },
      { ts: '2026-09-10T09:00:05.000Z', sid: SID, cwd: 'F:/work/acme', branch: 'feat/ACME-1-x', role: 'assistant', uuid: null },
      { ts: '2026-09-10T09:40:00.000Z', sid: SID, cwd: 'F:/work/acme', branch: 'feat/ACME-1-x', role: 'assistant', uuid: null },
    ])
    for (const k of cacheKeys(w)) expect(w.read(k)).not.toMatch(/SECRET/)
    // A preview after the confirm reads only the cache, and writes nothing.
    const writes = w.writes.length
    expect(await again($, w)).toBe(first)
    expect(transcriptReads(w)).toEqual([])
    expect(w.reads).toContain(shardFiles(w, ACME)[0])
    expect(w.writes.length).toBe(writes)
    expect(await again($, w, 'import --confirm')).toBe(confirmed)
    expect(transcriptReads(w)).toEqual([])
  })
  test('a listed transcript whose size or mtime changed is read again, alone', async ($, on) => {
    const w = world(on, { files: files() })
    const first = await run($, 'import')
    await run($, 'import --confirm')
    w.mtimes.set(OTHER, Date.parse('2026-10-05T03:00:00Z'))
    expect(await again($, w)).toBe(first)
    expect(transcriptReads(w)).toEqual([OTHER])
    await again($, w, 'import --confirm')
    expect(transcriptReads(w)).toEqual([OTHER])
    expect(await again($, w)).toBe(first)
    expect(transcriptReads(w)).toEqual([])
    w.files.set(OTHER, transcript(SID2, '2026-09-09', 'F:/work/other') + transcript(SID2, '2026-09-08', 'F:/work/other'))
    expect(await again($, w)).toBe(first)
    expect(transcriptReads(w)).toEqual([OTHER])
  })
  test('a broken or missing records file has only its transcript read again', async ($, on) => {
    const w = world(on, { files: files() })
    const first = await run($, 'import')
    await run($, 'import --confirm')
    const [shard] = shardFiles(w, ACME)
    for (const broken of ['{', '', w.read(shard)!.replace(SID, SID2), w.read(shard)!.replace('"role":"prompt"', '"role":"x"')]) {
      w.files.set(shard, broken)
      expect(await again($, w)).toBe(first)
      expect(transcriptReads(w)).toEqual([ACME])
    }
    w.files.delete(shard)
    expect(await again($, w)).toBe(first)
    expect(transcriptReads(w)).toEqual([ACME])
    // --confirm writes it again; then nothing is read.
    await again($, w, 'import --confirm')
    expect(await again($, w)).toBe(first)
    expect(transcriptReads(w)).toEqual([])
  })
  for (const [name, clients] of [
    ['a path is added to a client', [{ id: 'acme', name: 'ACME Corp', paths: ['F:/work/acme/**', 'F:/work/other/**'], rate: null, ticketPattern: null }]],
    ['a client is added', [{ id: 'acme', name: 'ACME Corp', paths: ['F:/work/acme/**'], rate: null, ticketPattern: null }, { id: 'oth', name: 'Other', paths: ['F:/work/other/**'], rate: null, ticketPattern: null }]],
  ] as const) {
    test(`every transcript is read again when ${name}`, async ($, on) => {
      const w = world(on, { files: files() })
      await run($, 'import --confirm')
      w.files.set(`${H}/rules.json`, JSON.stringify({ v: 1, tzOffsetMinutes: 420, clients }))
      expect(await again($, w)).toMatch(/^Found 2 sessions from 2026-09-09 to 2026-09-10: /)
      expect(w.reads).toContain(OTHER)
      expect(w.reads).toContain(ACME)
      await run($, 'import --confirm')
      expect(Object.values(cache(w).files).map((e: any) => e.candidate)).toEqual([true, true])
    })
  }
  test('a session that started in a folder with no client but has prompts in a client folder is imported, every time', async ($, on) => {
    const day = '2026-09-10'
    const started = [user(SID2, `${day}T08:00:00.000Z`, 'p', 'F:/work/other'), asst(SID2, `${day}T08:00:05.000Z`, 'F:/work/other'),
      user(SID2, `${day}T09:00:00.000Z`, 'q'), asst(SID2, `${day}T09:00:05.000Z`), asst(SID2, `${day}T09:40:00.000Z`)].join(NL) + NL
    const w = world(on, { files: { [`${H}/rules.json`]: RULES, [OTHER]: started } })
    const first = await run($, 'import')
    expect(first).toMatch(/^Found 1 session from 2026-09-10 to 2026-09-10: ACME Corp 0h50, Unassigned 0h1[0-9]/)
    expect(w.reads).toContain(OTHER)
    expect(await again($, w, 'import --confirm')).toMatch(/^Imported 1 session \(/)
    expect(importedKeys(w)).toEqual([`${H}/imported/${SID2}.jsonl`])
    expect(cache(w).files[OTHER]).toMatchObject({ candidate: true })
    expect(await again($, w)).toBe(first)
    expect(w.reads).toContain(shardFiles(w, OTHER)[0])
  })
  test('a resumed copy of a listed transcript has the original taken again (from its records), so the lines it repeats stay the original ones', async ($, on) => {
    const U = (sid: string, ts: string, uuid: string, cwd: string) => L({ type: 'user', timestamp: ts, sessionId: sid, uuid, cwd, message: { role: 'user', content: 'p' } })
    const A = (sid: string, ts: string, uuid: string, cwd: string) => L({ type: 'assistant', timestamp: ts, sessionId: sid, uuid, cwd, message: { role: 'assistant', content: [] } })
    const o = 'F:/work/other'
    const orig = (sid: string) => [U(sid, '2026-09-10T09:00:00.000Z', 'a1', o), A(sid, '2026-09-10T09:00:05.000Z', 'a2', o), A(sid, '2026-09-10T09:40:00.000Z', 'a3', o)]
    const ORIG = `${P}/F--work-other/${SID}.jsonl`
    const w = world(on, { files: { [`${H}/rules.json`]: RULES, [ORIG]: orig(SID).join(NL) + NL } })
    expect(await run($, 'import --confirm')).toBe('Nothing to import.')
    expect(Object.keys(cache(w).files)).toEqual([ORIG])
    // SID resumed as SID2, then work goes on in a client folder.
    const a = 'F:/work/acme'
    w.files.set(`${P}/F--work-other/${SID2}.jsonl`, [...orig(SID2), U(SID2, '2026-09-11T09:00:00.000Z', 'b1', a), A(SID2, '2026-09-11T09:00:05.000Z', 'b2', a), A(SID2, '2026-09-11T09:40:00.000Z', 'b3', a)].join(NL) + NL)
    expect(await again($, w)).toMatch(/^Found 1 session from 2026-09-11 to 2026-09-11: ACME Corp 0h50[.] 1 session in folders with no client/)
    expect(w.reads).toContain(shardFiles(w, ORIG)[0])
    expect(transcriptReads(w)).toEqual([`${P}/F--work-other/${SID2}.jsonl`])
  })
  for (const [name, bad] of [
    ['not JSON', '{'],
    ['null', 'null'],
    ['an array', '[]'],
    ['another version', JSON.stringify({ v: 1, key: 'x', files: {} })],
    ['for other clients', JSON.stringify({ v: 2, key: ['x', []], files: { [`${P}/F--work-other/${SID2}.jsonl`]: { size: 1, mtimeMs: 1, sids: [SID2], counted: [SID2], from: null, to: null, candidate: false, shard: null, parts: 0 } } })],
  ] as const) {
    test(`a cache that is ${name} is ignored, and rewritten by --confirm`, async ($, on) => {
      const w = world(on, { files: { ...files(), [CACHE]: bad } })
      expect(await run($, 'import')).toContain('Found 1 session from 2026-09-10 to 2026-09-10: ACME Corp 0h50. 1 session in folders with no client')
      expect(w.reads).toContain(OTHER)
      expect(w.read(CACHE)).toBe(bad)
      expect(await run($, 'import --confirm')).toBe('Imported 1 session (0h50). Reports mark these days "from Claude Code transcripts".')
      expect(Object.keys(cache(w).files)).toEqual([ACME, OTHER])
    })
  }
  test('a cache entry with a wrong shape is not trusted', async ($, on) => {
    const w = world(on, { files: files() })
    const first = await run($, 'import')
    await run($, 'import --confirm')
    const c = cache(w)
    c.files[OTHER].sids = 'one'
    w.files.set(CACHE, JSON.stringify(c))
    expect(await again($, w)).toBe(first)
    expect(transcriptReads(w)).toEqual([OTHER])
  })
  test('a transcript that could not be read is never listed', async ($, on) => {
    const big = user(SID2, '2026-09-10T09:00:00.000Z', 'SECRET '.repeat(700_000), 'F:/work/other') + NL
    const w = world(on, { files: { [`${H}/rules.json`]: RULES, [ACME]: transcript(SID), [OTHER]: big } })
    expect(await run($, 'import --confirm')).toContain('1 transcript skipped (cannot be read here).')
    expect(Object.keys(cache(w).files)).toEqual([ACME])
    // Tried again (a listed file would not be): still skipped, never listed.
    expect(await again($, w, 'import --confirm')).toContain('1 transcript skipped (cannot be read here).')
    expect(Object.keys(cache(w).files)).toEqual([ACME])
  })
  test('--undo empties the cache too, and says so; a later import reads every transcript again', async ($, on) => {
    const w = world(on, { files: files() })
    const first = await run($, 'import')
    await run($, 'import --confirm')
    expect(cacheKeys(w).length).toBeGreaterThan(1)
    expect(await run($, 'import --undo')).toBe('Removed 1 imported session and the import cache.')
    for (const k of cacheKeys(w)) expect([k, w.read(k)]).toEqual([k, k === CACHE ? '{}\n' : ''])
    expect(await again($, w)).toBe(first)
    expect(transcriptReads(w).sort()).toEqual([ACME, OTHER])
    expect(await run($, 'import --undo')).toBe('Nothing imported.')
  })
  test('--undo with only a cache (nothing imported) empties it', async ($, on) => {
    const w = world(on, { files: { [`${H}/rules.json`]: RULES, [OTHER]: transcript(SID2, '2026-09-09', 'F:/work/other') } })
    expect(await run($, 'import --confirm')).toBe('Nothing to import.')
    expect(await run($, 'import --undo')).toBe('Nothing imported. Removed the import cache.')
    for (const k of cacheKeys(w)) expect(w.read(k)).toBe(k === CACHE ? '{}\n' : '')
  })
  test('the records of a transcript Claude Code has since cleaned up are emptied by the next --confirm', async ($, on) => {
    const w = world(on, { files: files() })
    await run($, 'import --confirm')
    const [gone] = shardFiles(w, OTHER)
    expect(w.read(gone)).toContain(SID2)
    w.files.delete(OTHER)
    await run($, 'import --confirm')
    expect(w.read(gone)).toBe('')
    expect(Object.keys(cache(w).files)).toEqual([ACME])
    expect(w.read(shardFiles(w, ACME)[0])).toContain(SID)
  })
  test('a --confirm stopped by the time limit says when its progress could not be saved', async ($, on) => {
    const w = world(on, { failWritePattern: /import-cache/, files: files() })
    const budget = () => (transcriptReads(w).length >= 1 ? 0 : Infinity)
    expect((await runCommand(w.engine({ budget }), createRecorder(), 'import --confirm')).text).toBe('Scanned 1 of 2 transcripts (1 left). Run /hourslip import --confirm again to continue; nothing is imported until the scan is complete. Progress could not be saved: EACCES.')
  })
})

describe('/hourslip import, the scan cache and a session spread over files', () => {
  const OTHER = `${P}/F--work-other/${SID}.jsonl`
  const SID3 = '33333333-2222-3333-4444-555555555555'
  const LATER = `${P}/F--work-acme/${SID3}.jsonl`
  /** SID's 09-10 turn in a folder with no client (its own file), and SID's 09-11 turn in a client folder (another file). */
  const early = transcript(SID, '2026-09-10', 'F:/work/other')
  const late = transcript(SID, '2026-09-11')
  const EXPECTED = /^Found 1 session from 2026-09-10 to 2026-09-11: ACME Corp 0h50, Unassigned 0h50[.]/
  /** The same import with the cache and without it: identical replies and identical imported files. */
  const same = async ($: any, w: { files: Map<string, string>; reads: string[]; read(p: string): string | undefined }) => {
    const cached = w.read(CACHE)!
    expect(cached).toBeDefined()
    const p1 = await run($, 'import')
    w.files.delete(CACHE)
    const p2 = await run($, 'import')
    expect(p1).toBe(p2)
    expect(p1).toMatch(EXPECTED)
    w.files.set(CACHE, cached)
    const c1 = await run($, 'import --confirm')
    const f1 = w.read(`${H}/imported/${SID}.jsonl`)
    w.files.delete(CACHE)
    const c2 = await run($, 'import --confirm')
    expect(c1).toBe(c2)
    expect(w.read(`${H}/imported/${SID}.jsonl`)).toBe(f1)
    expect(f1!.trim().split('\n')).toHaveLength(6)
  }
  test('a listed file is taken again when a file read now carries one of its sessions', async ($, on) => {
    const w = world(on, { files: { [`${H}/rules.json`]: RULES, [OTHER]: early } })
    expect(await run($, 'import --confirm')).toBe('Nothing to import.')
    expect(JSON.parse(w.read(CACHE)!).files[OTHER]).toMatchObject({ sids: [SID], counted: [SID] })
    w.files.set(LATER, late)
    w.reads.length = 0
    expect(await run($, 'import')).toMatch(EXPECTED)
    expect(w.reads).toContain(shardFiles(w, OTHER)[0])
    await same($, w)
  })
  test('a session left out because another of its files failed is whole once that file reads', async ($, on) => {
    // The first read of LATER fails (and there is no process.spawn to fall back on).
    const w = world(on, { busyOnce: /F--work-acme/, files: { [`${H}/rules.json`]: RULES, [OTHER]: early, [LATER]: late } })
    expect(await run($, 'import --confirm')).toBe('Nothing to import. 1 transcript skipped (cannot be read here).')
    expect(Object.keys(JSON.parse(w.read(CACHE)!).files)).toEqual([OTHER])
    w.reads.length = 0
    expect(await run($, 'import')).toMatch(EXPECTED)
    expect(w.reads).toContain(shardFiles(w, OTHER)[0])
    await same($, w)
  })
  test('a cache written by another plugin version is ignored', async ($, on) => {
    const OTHER2 = `${P}/F--work-other/${SID2}.jsonl`
    const w = world(on, { files: { [`${H}/rules.json`]: RULES, [OTHER2]: transcript(SID2, '2026-09-09', 'F:/work/other') } })
    await run($, 'import --confirm')
    const c = JSON.parse(w.read(CACHE)!)
    expect(c.key[0]).toBe(VERSION)
    w.reads.length = 0
    await run($, 'import')
    expect(w.reads).not.toContain(OTHER2)
    w.files.set(CACHE, JSON.stringify({ ...c, key: ['0.0.1', c.key[1]] }))
    await run($, 'import')
    expect(w.reads).toContain(OTHER2)
  })
  test('the span is over every timestamped line, not only those that make events', async ($, on) => {
    const OTHER2 = `${P}/F--work-other/${SID2}.jsonl`
    const tail = L({ type: 'system', timestamp: '2026-09-09T12:00:00.000Z', sessionId: SID2 })
    const w = world(on, { files: { [`${H}/rules.json`]: RULES, [OTHER2]: transcript(SID2, '2026-09-09', 'F:/work/other') + tail + NL } })
    await run($, 'import --confirm')
    expect(JSON.parse(w.read(CACHE)!).files[OTHER2]).toMatchObject({ from: Date.parse('2026-09-09T09:00:00.000Z'), to: Date.parse('2026-09-09T12:00:00.000Z') })
  })
})

describe('/hourslip import within the hook time limit', () => {
  const SID3 = '33333333-2222-3333-4444-555555555555'
  const SID4 = '44444444-2222-3333-4444-555555555555'
  const SID5 = '55555555-2222-3333-4444-555555555555'
  // Five transcripts: three client sessions, one in a folder with no client, and SID's later turn in a file of its own.
  const FILES = {
    [`${H}/rules.json`]: RULES,
    [`${P}/F--work-acme/${SID}.jsonl`]: transcript(SID, '2026-09-10'),
    [`${P}/F--work-acme/${SID3}.jsonl`]: transcript(SID3, '2026-09-11'),
    [`${P}/F--work-acme/${SID4}.jsonl`]: transcript(SID4, '2026-09-12'),
    [`${P}/F--work-other/${SID2}.jsonl`]: transcript(SID2, '2026-09-09', 'F:/work/other'),
    [`${P}/F--work-other/${SID5}.jsonl`]: transcript(SID, '2026-09-13', 'F:/work/other'),
  }
  const M = 5
  /** A budget that runs out once `k` transcripts have been read in this run (none left: 0 ms). */
  const after = (w: { reads: string[]; spawns: string[][] }, k: number) => {
    const start = transcriptReads(w).length + w.spawns.length
    return () => (transcriptReads(w).length + w.spawns.length - start >= k ? 0 : Infinity)
  }
  const go = (w: ReturnType<typeof world>, args: string, budget?: () => number) => runCommand(w.engine({ budget }), createRecorder(), args).then(r => r.text)
  const importedNow = (w: ReturnType<typeof world>) => importedKeys(w).map(k => [k, w.read(k)])

  test('the kit meters nothing: through $.command.run the import never stops', async ($, on) => {
    world(on, { now: SEPT_11, files: FILES })
    expect(await run($, 'import')).toMatch(/^Found 3 sessions from 2026-09-10 to 2026-09-13: ACME Corp 2h30, Unassigned 0h50[.]/)
  })
  test('a preview that runs out says how far it got and writes nothing', async ($, on) => {
    const w = world(on, { now: SEPT_11, files: FILES })
    const out = await go(w, 'import', after(w, 2))
    expect(out).toBe(`Scanned 2 of ${M} transcripts before Claude Code's time limit for a command. Nothing written yet. Run /hourslip import --confirm to scan in steps and import when done.`)
    expect(w.writes).toEqual([])
    expect(w.panes).toEqual([])
  })
  test('--confirm in steps: each run keeps its progress and says how many are left; the last one imports what one unlimited run imports', async ($, on) => {
    const w = world(on, { now: SEPT_11, files: FILES })
    expect(await go(w, 'import --confirm', after(w, 2))).toBe(`Scanned 2 of ${M} transcripts (3 left). Run /hourslip import --confirm again to continue; nothing is imported until the scan is complete.`)
    expect(importedKeys(w)).toEqual([])
    // The next run reads only the files not yet in the cache.
    w.reads.length = 0
    expect(await go(w, 'import --confirm', after(w, 2))).toBe(`Scanned 4 of ${M} transcripts (1 left). Run /hourslip import --confirm again to continue; nothing is imported until the scan is complete.`)
    expect(transcriptReads(w)).toHaveLength(2)
    expect(importedKeys(w)).toEqual([])
    // A preview now: the cache as it is, read and not written.
    const writes = w.writes.length
    expect(await go(w, 'import', after(w, 0))).toBe(`Scanned 4 of ${M} transcripts before Claude Code's time limit for a command. Nothing written yet. Run /hourslip import --confirm to scan in steps and import when done.`)
    expect(w.writes.length).toBe(writes)
    const preview = await go(w, 'import')
    expect(preview).toMatch(/^Found 3 sessions from 2026-09-10 to 2026-09-13: ACME Corp 2h30, Unassigned 0h50[.] 1 session in folders with no client/)
    expect(w.writes.length).toBe(writes)
    const last = await go(w, 'import --confirm', after(w, 2))
    expect(last).toBe('Imported 3 sessions (3h20). Reports mark these days "from Claude Code transcripts".')
    const stepped = importedNow(w)
    expect(stepped).toHaveLength(3)
    // Then: nothing is read again, and the same import.
    w.reads.length = 0
    expect(await go(w, 'import')).toBe(preview)
    expect(transcriptReads(w)).toEqual([])
    // One unlimited run with no cache and nothing imported gives the same reply and the same files.
    await go(w, 'import --undo')
    for (const k of cacheKeys(w)) w.files.delete(k)
    expect(await go(w, 'import')).toBe(preview)
    expect(await go(w, 'import --confirm')).toBe(last)
    expect(importedNow(w)).toEqual(stepped)
  })
  test('a run that has every transcript but too little time left for the import stops before writing imported/', async ($, on) => {
    const w = world(on, { now: SEPT_11, files: FILES })
    const ALL = `All ${M} transcripts scanned; Claude Code's time limit ran out while adding them up. Run /hourslip import --confirm again to import.`
    expect(await go(w, 'import --confirm', after(w, M))).toBe(ALL)
    expect(importedKeys(w)).toEqual([])
    expect(await go(w, 'import --confirm', after(w, 0))).toBe(ALL)
    expect(await go(w, 'import --confirm', () => 2_500)).toMatch(/^Imported 3 sessions \(3h20\)[.]/)
  })
  test('the run that completes the scan loads only the records it needs: many transcripts in folders with no client never stall it', async ($, on) => {
    const others = Object.fromEntries(Array.from({ length: 8 }, (_, i) => {
      const sid = `${i + 1}`.repeat(8) + '-9999-3333-4444-555555555555'
      return [`${P}/F--work-other/${sid}.jsonl`, transcript(sid, `2026-09-0${i + 1}`, 'F:/work/other')]
    }))
    const files = { [`${H}/rules.json`]: RULES, [`${P}/F--work-acme/${SID}.jsonl`]: transcript(SID, '2026-09-10'), [`${P}/F--work-acme/${SID3}.jsonl`]: transcript(SID3, '2026-09-11'), ...others }
    const w = world(on, { now: SEPT_11, files })
    /** Runs out once `k` files (transcripts or records) have been read in this run. */
    const loads = (k: number) => {
      const n = () => w.reads.filter(r => r.startsWith(`${P}/`) || r.startsWith(RECORDS)).length + w.spawns.length
      const start = n()
      return () => (n() - start >= k ? 0 : Infinity)
    }
    const replies: string[] = []
    for (let i = 0; i < 8 && !replies.at(-1)?.startsWith('Imported'); i++) {
      w.reads.length = 0
      replies.push(await go(w, 'import --confirm', loads(3)))
    }
    expect(replies.at(-1)).toBe('Imported 2 sessions (1h40). Reports mark these days "from Claude Code transcripts".')
    expect(replies.length).toBeLessThanOrEqual(6)
    // The last run read the two client transcripts' records, and nothing else.
    expect(w.reads.filter(r => r.startsWith(RECORDS))).toHaveLength(2)
    expect(transcriptReads(w)).toEqual([])
    const stepped = importedNow(w)
    await go(w, 'import --undo')
    expect(await go(w, 'import --confirm')).toBe(replies.at(-1))
    expect(importedNow(w)).toEqual(stepped)
  })
  test('a transcript that needs more than a whole run is skipped and counted, and not tried again until it changes', async ($, on) => {
    const BIG = '7'.repeat(8) + '-2222-3333-4444-555555555555'
    // Over 4 MiB (read through process.spawn) and first in path order: the first transcript the run reads.
    const big = [user(BIG, '2026-09-10T08:00:00.000Z', 'p'), asst(BIG, '2026-09-10T08:00:05.000Z'), user(BIG, '2026-09-10T08:30:00.000Z', 'SECRET '.repeat(700_000))].join(NL) + NL
    const BIGPATH = `${P}/F--work-aaa/${BIG}.jsonl`
    const w = world(on, { now: SEPT_11, files: { [`${H}/rules.json`]: RULES, [BIGPATH]: big, [`${P}/F--work-acme/${SID}.jsonl`]: transcript(SID) }, spawn: t => ({ pieces: [t.slice(0, 100), t.slice(100)] }) })
    // The time runs out while that one transcript is being read, at the start of the run.
    let fired = false
    const budget = () => { if (!fired && w.spawns.length > 0) { fired = true; return 500 } return Infinity }
    const out = await go(w, 'import --confirm', budget)
    expect(out).toBe('Imported 1 session (0h50). Reports mark these days "from Claude Code transcripts". 1 transcript skipped (cannot be read here).')
    expect(JSON.parse(w.read(CACHE)!).files[BIGPATH]).toMatchObject({ failed: true, sids: [BIG] })
    w.spawns.length = 0
    expect(await go(w, 'import')).toContain('1 transcript skipped (cannot be read here).')
    expect(w.spawns).toEqual([])
    // Changed: read again (and this time it fits).
    w.mtimes.set(BIGPATH, Date.parse('2026-10-05T03:00:00Z'))
    expect(await go(w, 'import')).not.toContain('skipped')
    expect(w.spawns).toHaveLength(1)
  })
  test('an index over 4 MiB is split into parts under 3.5 MiB, and read back whole', async ($, on) => {
    // Four transcripts (each under 4 MiB) whose lines carry 35,000 session ids each: an index entry of 1.4 MB apiece.
    const many = (n: number) => Array.from({ length: 35_000 }, (_, i) => L({ type: 'system', timestamp: '2026-09-09T12:00:00.000Z', sessionId: `${n}${String(i).padStart(7, '0')}-aaaa-bbbb-cccc-dddddddddddd` })).join(NL) + NL
    const files: Record<string, string> = { [`${H}/rules.json`]: RULES, [`${P}/F--work-acme/${SID}.jsonl`]: transcript(SID) }
    for (const n of [1, 2, 3, 4]) files[`${P}/F--work-other/${n}.jsonl`] = many(n)
    const w = world(on, { now: SEPT_11, files })
    const first = await run($, 'import')
    expect(await run($, 'import --confirm')).toMatch(/^Imported 1 session/)
    const parts = cacheKeys(w).filter(k => /\/index(\.[0-9]+)?\.json$/.test(k))
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.reduce((s, k) => s + new TextEncoder().encode(w.read(k)!).length, 0)).toBeGreaterThan(4 * 1024 * 1024)
    for (const k of parts) expect(new TextEncoder().encode(w.read(k)!).length).toBeLessThanOrEqual(3.5 * 1024 * 1024)
    w.reads.length = 0
    expect(await run($, 'import')).toBe(first)
    expect(transcriptReads(w)).toEqual([])
  })
  test('a large transcript\'s records are split so no records file passes 3.5 MiB; no prompt or reply text anywhere in the cache', async ($, on) => {
    const BIG = '6'.repeat(8) + '-2222-3333-4444-555555555555'
    const lines = [user(BIG, '2026-09-10T09:00:00.000Z', 'SECRET-PROMPT')]
    for (let i = 0; i < 25_000; i++) lines.push(L({ type: 'assistant', timestamp: new Date(Date.parse('2026-09-10T09:00:01.000Z') + i * 100).toISOString(), sessionId: BIG, uuid: `u-${String(i).padStart(30, '0')}`, cwd: 'F:/work/acme', gitBranch: 'feat/ACME-1-x', message: { content: [{ type: 'text', text: 'SECRET-REPLY' }] } }))
    const text = lines.join(NL) + NL
    expect(new TextEncoder().encode(text).length).toBeGreaterThan(4 * 1024 * 1024)
    const w = world(on, { now: SEPT_11, files: { [`${H}/rules.json`]: RULES, [`${P}/F--work-acme/${BIG}.jsonl`]: text }, spawn: t => ({ pieces: [t.slice(0, 1_000_001), t.slice(1_000_001)] }) })
    const first = await run($, 'import')
    expect(await run($, 'import --confirm')).toMatch(/^Imported 1 session/)
    const shards = shardFiles(w, `${P}/F--work-acme/${BIG}.jsonl`)
    expect(shards.length).toBeGreaterThan(1)
    for (const k of cacheKeys(w)) {
      expect(new TextEncoder().encode(w.read(k)!).length).toBeLessThanOrEqual(3.5 * 1024 * 1024)
      expect(w.read(k)).not.toMatch(/SECRET/)
    }
    w.spawns.length = 0
    expect(await run($, 'import')).toBe(first)
    expect(w.spawns).toEqual([])
    // Smaller now: one records file, and the parts nothing names any more are emptied.
    w.files.set(`${P}/F--work-acme/${BIG}.jsonl`, transcript(BIG))
    await run($, 'import --confirm')
    expect(shardFiles(w, `${P}/F--work-acme/${BIG}.jsonl`)).toHaveLength(1)
    for (const k of shards) expect(w.read(k)).toBe('')
  })
})
