import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'

/** Paths the engine hands hooks may carry a drive and backslashes; compare them without either. */
export const norm = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

export const T0 = Date.parse('2026-10-05T02:00:00Z')

/** An in-memory disk under HOME=/home/dev, a fixed session, a clock at T0. */
export function world(on: On, opts: { files?: Record<string, string>; cwd?: string; branchHead?: string | null; failWrites?: boolean; failWritesOnce?: boolean; busyReads?: number; failWritePattern?: RegExp; failWriteMessage?: string; gitThrows?: boolean; copyThrows?: boolean; copyRefused?: boolean; reportsStoreThrows?: boolean; storeSeed?: Record<string, unknown>; busyOnce?: RegExp; env?: Record<string, string>; http?: (method: string, url: string, body: string | undefined, headers: Record<string, string>) => { status: number; body?: unknown; text?: string } } = {}) {
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
  mock.env(on, { HOME: '/home/dev', ...opts.env })
  if (opts.reportsStoreThrows || opts.storeSeed) {
    // mock.store can neither be overridden (on() twice is refused) nor pre-filled, so these options replace it: set fails for 'reports', or the store starts with storeSeed.
    const kv = new Map<string, unknown>(Object.entries(opts.storeSeed ?? {}))
    on('store.get', (_$, e) => ({ value: kv.get(e.key) }))
    on('store.set', (_$, e) => { if (opts.reportsStoreThrows && e.key === 'reports') throw new Error('store full'); kv.set(e.key, e.value); return { value: undefined } })
    on('store.delete', (_$, e) => { kv.delete(e.key); return { value: undefined } })
  } else mock.store(on)
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
  const fetches: { method: string; url: string; body: string | undefined; headers: Record<string, string> }[] = []
  const copies: string[] = []
  on('http.fetch', (_$, e) => {
    const method = e.init?.method ?? 'GET'
    const headers = e.init?.headers ?? {}
    fetches.push({ method, url: e.url, body: e.init?.body, headers })
    if (!opts.http) throw new Error('no network in this test')
    const r = opts.http(method, e.url, e.init?.body, headers)
    const text = r.text ?? (r.body === undefined ? '' : JSON.stringify(r.body))
    return { value: { status: r.status, ok: r.status >= 200 && r.status < 300, headers: {}, text } }
  })
  on('ui.copy', (_$, e) => { if (opts.copyThrows) throw new Error('no clipboard'); if (opts.copyRefused) return { value: { isCopied: false as const, reason: 'no-clipboard' as const } }; copies.push(e.text); return { value: { isCopied: true as const } } })
  return { files, writes, fetches, copies, statuses, toasts, panes, runs, clock, read: (p: string) => files.get(norm(p)) }
}

export const SESSION = { cwd: '/work/acme/api', surface: 'terminal', isInteractive: true } as const

/** The kit's `$` has no `process` noun, so commitsFor is driven through a recording fake. */
export function fakeGit(stdout = 'fix login\r\nadd tests\n') {
  const runs: string[][] = []
  return { runs, engine: { process: { run: async (argv: readonly string[]) => { runs.push([...argv]); return { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } } } }
}

type Http = (method: string, url: string, body: string | undefined, headers: Record<string, string>) => { status: number; body?: unknown; text?: string }

/**
 * The kit's test-side `$` has no `http`, `store` or `env` noun (probed on 2.1.289: its nouns are tool, command,
 * config, telemetry, prompt, skill, attribution, agent, session, turn, ui, classic), and `ui` lacks `copy`.
 * So the server client is driven through a recording fake of the network, the store and copy
 * (the store clones on set, like the real one). Through `$.command.run` the hook-side `$` does reach world()'s hooks.
 */
export function fakeNet(opts: { http?: Http; server?: string; store?: Record<string, unknown>; storeThrows?: boolean; setThrows?: boolean } = {}) {
  const fetches: { method: string; url: string; body: string | undefined; headers: Record<string, string> }[] = []
  const copies: string[] = []
  const store = new Map<string, unknown>(Object.entries(opts.store ?? {}))
  const engine = {
    env: { hourslipHome: async () => undefined, home: async () => '/home/dev', userProfile: async () => undefined, server: async () => opts.server, os: async () => undefined },
    http: {
      fetch: async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
        const method = init?.method ?? 'GET'
        const headers = init?.headers ?? {}
        fetches.push({ method, url, body: init?.body, headers })
        if (!opts.http) throw new Error('no network in this test')
        const r = opts.http(method, url, init?.body, headers)
        return { status: r.status, ok: r.status >= 200 && r.status < 300, text: r.text ?? (r.body === undefined ? '' : JSON.stringify(r.body)) }
      },
    },
    store: {
      get: async (k: string) => { if (opts.storeThrows) throw new Error('corrupt store'); return store.get(k) },
      set: async (k: string, v: unknown) => { if (opts.setThrows) throw new Error('store full'); store.set(k, JSON.parse(JSON.stringify(v))) },
      delete: async (k: string) => { store.delete(k) },
    },
    ui: { copy: async (t: string) => { copies.push(t); return true } },
  }
  return { fetches, copies, store, engine }
}
