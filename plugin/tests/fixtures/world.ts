import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'

/** Paths the engine hands hooks may carry a drive and backslashes; compare them without either. */
export const norm = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

export const T0 = Date.parse('2026-10-05T02:00:00Z')

/** An in-memory disk under HOME=/home/dev, a fixed session, a clock at T0. */
export function world(on: On, opts: { files?: Record<string, string>; cwd?: string; branchHead?: string | null; failWrites?: boolean; failWritesOnce?: boolean; busyReads?: number; failWritePattern?: RegExp; failWriteMessage?: string; gitThrows?: boolean; busyOnce?: RegExp } = {}) {
  const files = new Map<string, string>(Object.entries(opts.files ?? {}).map(([k, v]) => [norm(k), v]))
  let failOnce = opts.failWritesOnce ?? false
  let busy = opts.busyReads ?? 0
  let busyOnce = opts.busyOnce
  const writes: { path: string; text: string }[] = []
  const statuses: (string | undefined)[] = []
  const toasts: string[] = []
  const panes: string[] = []
  const runs: string[][] = []
  const clock = mock.clock(on, { now: T0 })
  mock.env(on, { HOME: '/home/dev' })
  mock.store(on)
  const cwd = opts.cwd ?? '/work/acme/api'
  if (opts.branchHead !== null) files.set(norm(`${cwd}/.git/HEAD`), opts.branchHead ?? 'ref: refs/heads/feat/ACME-182-login\n')
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: cwd }))
  on('session.repo', () => ({ value: opts.branchHead === null ? null : { root: cwd, remote: null, internal: false, name: null } }))
  on('fs.read', ($, e) => {
    if (busy > 0 && e.path.endsWith('.jsonl')) { busy--; throw new Error('EBUSY') }
    if (busyOnce?.test(norm(e.path))) { busyOnce = undefined; throw new Error('EBUSY') }
    const text = files.get(norm(e.path))
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  on('fs.write', ($, e) => {
    if (opts.failWrites || opts.failWritePattern?.test(e.path)) {
      // A thrown hook is skipped by the kit; { deny } is how a refusal reaches the caller with its text.
      if (opts.failWriteMessage) return { deny: opts.failWriteMessage }
      throw new Error('EACCES')
    }
    if (failOnce) { failOnce = false; throw new Error('EACCES') }
    files.set(norm(e.path), e.text)
    writes.push({ path: norm(e.path), text: e.text })
    return { value: undefined }
  })
  on('fs.exists', ($, e) => ({ value: files.has(norm(e.path)) }))
  on('fs.list', ($, e) => {
    const dir = norm(e.path).replace(/\/$/, '') + '/'
    const names = [...files.keys()].filter(k => k.startsWith(dir) && !k.slice(dir.length).includes('/'))
    if (names.length === 0) throw new Error(`ENOENT: ${e.path}`)
    return { value: names.map(k => ({ name: k.slice(dir.length), kind: 'file' as const, size: files.get(k)!.length, mtimeMs: T0, isLink: false })) }
  })
  on('ui.status', ($, e) => { statuses.push(e.text); return { value: undefined } })
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
  // The kit has nothing beneath plugin hooks: answer the events the recorder's callers raise.
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.end', () => ({ sessionId: 'sess-1' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', (_$, e) => { panes.push(e.id); return { value: { isPlaced: true as const } } })
  on('process.run', (_$, e) => { runs.push([...e.argv]); if (opts.gitThrows) throw new Error('git exploded'); return { value: { exitCode: 0, stdout: 'fix login\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } })
  return { files, writes, statuses, toasts, panes, runs, clock, read: (p: string) => files.get(norm(p)) }
}

export const SESSION = { cwd: '/work/acme/api', surface: 'terminal', isInteractive: true } as const

/** The kit's `$` has no `process` noun, so commitsFor is driven through a recording fake. */
export function fakeGit(stdout = 'fix login\r\nadd tests\n') {
  const runs: string[][] = []
  return { runs, engine: { process: { run: async (argv: readonly string[]) => { runs.push([...argv]); return { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } } } }
}
