import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { HourslipEngine } from '../../hooks/io/commands.ts'

/** Paths the engine hands hooks may carry a drive and backslashes; compare them without either. */
export const norm = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

export const T0 = Date.parse('2026-10-05T02:00:00Z')

/** UTF-8 bytes, as the engine's stat and 4 MiB limit count them. */
const bytes = (t: string) => new TextEncoder().encode(t).length
const MAX_READ = 4 * 1024 * 1024

/** What world()'s `process.spawn` answers for one file: its text in pieces, and the exit code. */
export type SpawnAnswer = (text: string, argv: string[]) => { pieces: string[]; code?: number | null }

/** An in-memory disk under HOME=/home/dev, a fixed session, a clock at T0. */
export function world(on: On, opts: { files?: Record<string, string>; cwd?: string; branchHead?: string | null; failWrites?: boolean; failWritesOnce?: boolean; busyReads?: number; failWritePattern?: RegExp; failWriteMessage?: string; gitThrows?: boolean; copyThrows?: boolean; copyRefused?: boolean; reportsStoreThrows?: boolean; storeSeed?: Record<string, unknown>; busyOnce?: RegExp; env?: Record<string, string>; now?: number; spawn?: SpawnAnswer; http?: (method: string, url: string, body: string | undefined, headers: Record<string, string>) => { status: number; body?: unknown; text?: string } } = {}) {
  const files = new Map<string, string>(Object.entries(opts.files ?? {}).map(([k, v]) => [norm(k), v]))
  let failOnce = opts.failWritesOnce ?? false
  let busy = opts.busyReads ?? 0
  let busyOnce = opts.busyOnce
  const writes: { path: string; text: string }[] = []
  const statuses: (string | undefined)[] = []
  const toasts: string[] = []
  const panes: string[] = []
  const runs: string[][] = []
  const clock = mock.clock(on, { now: opts.now ?? T0 })
  const spawns: string[][] = []
  const reads: string[] = []
  const titles: (string | undefined)[] = []
  const states: { key: string; value: unknown }[] = []
  /** A file's mtime as list and stat give it: T0 unless set here. */
  const mtimes = new Map<string, number>()
  const envVars: Record<string, string> = { HOME: '/home/dev', ...opts.env }
  mock.env(on, envVars)
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
  // The disk as plain functions: the hooks below answer `$` with them, and engine() hands them to io code directly.
  const fsRead = (path: string) => {
    reads.push(norm(path))
    if (busy > 0 && path.endsWith('.jsonl')) { busy--; throw new Error('EBUSY') }
    if (busyOnce?.test(norm(path))) { busyOnce = undefined; throw new Error('EBUSY') }
    const text = files.get(norm(path))
    if (text === undefined) throw new Error(`ENOENT: ${path}`)
    // The engine refuses a read over 4 MiB; so does this disk.
    if (bytes(text) > MAX_READ) throw new Error(`EFBIG: ${path} is over 4 MiB`)
    return text
  }
  const fsStat = (path: string) => {
    const text = files.get(norm(path))
    if (text === undefined) throw new Error(`ENOENT: ${path}`)
    return { kind: 'file' as const, size: bytes(text), mtimeMs: mtimes.get(norm(path)) ?? T0, isLink: false }
  }
  on('fs.read', ($, e) => ({ value: fsRead(e.path) }))
  on('fs.stat', ($, e) => ({ value: fsStat(e.path) }))
  // No spawn answer: the kit has no implementation, so `$.process.spawn` rejects its first pull (the desktop app's case).
  if (opts.spawn) {
    const answer = opts.spawn
    on('process.spawn', async function* (_$, e) {
      spawns.push([...e.argv])
      const text = files.get(norm(e.argv[e.argv.length - 1]))
      if (text === undefined) return { value: { code: 1, signal: null } } as never
      const { pieces, code = 0 } = answer(text, [...e.argv])
      for (const t of pieces) if (t !== '') yield { stream: 'stdout' as const, text: t }
      return { value: { code, signal: null } } as never
    })
  }
  /** A write as this disk takes it: false when refused with `failWriteMessage`; throws when it fails. */
  const fsWrite = (path: string, text: string): boolean => {
    if (opts.failWrites || opts.failWritePattern?.test(path)) {
      if (opts.failWriteMessage) return false
      throw new Error('EACCES')
    }
    if (failOnce) { failOnce = false; throw new Error('EACCES') }
    files.set(norm(path), text)
    writes.push({ path: norm(path), text })
    return true
  }
  const fsList = (path: string) => {
    const dir = norm(path).replace(/\/$/, '') + '/'
    const under = [...files.keys()].filter(k => k.startsWith(dir))
    if (under.length === 0) throw new Error(`ENOENT: ${path}`)
    const names = under.filter(k => !k.slice(dir.length).includes('/'))
    const dirs = [...new Set(under.filter(k => k.slice(dir.length).includes('/')).map(k => k.slice(dir.length).split('/')[0]))]
    return [
      ...names.map(k => ({ name: k.slice(dir.length), kind: 'file' as const, size: bytes(files.get(k)!), mtimeMs: mtimes.get(k) ?? T0, isLink: false })),
      ...dirs.map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: T0, isLink: false })),
    ]
  }
  // A thrown hook is skipped by the kit; { deny } is how a refusal reaches the caller with its text.
  on('fs.write', ($, e) => (fsWrite(e.path, e.text) ? { value: undefined } : { deny: opts.failWriteMessage! }))
  on('fs.exists', ($, e) => ({ value: files.has(norm(e.path)) }))
  on('fs.list', ($, e) => ({ value: fsList(e.path) }))
  on('ui.status', ($, e) => { statuses.push(e.text); return { value: undefined } })
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
  // The kit has nothing beneath plugin hooks: answer the events the recorder's callers raise.
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.end', () => ({ sessionId: 'sess-1' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  // What the pane atom is set to (its lines), seen on the way to the kit's own state.
  on('state.set', (_$, e, next) => { states.push({ key: e.key, value: e.value }); return next(e) })
  on('ui.open', (_$, e) => { panes.push(e.id); titles.push(e.title); return { value: { isPlaced: true as const } } })
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
  /**
   * The engine `/hourslip` builds, over this disk, for driving io code directly with what `$.command.run` cannot
   * give (the kit meters no hook time), such as a `budget` that runs out. Env, disk and spawn answer as the
   * hooks above do; no network, git or clipboard.
   */
  const engine = (extra: { budget?: () => number } = {}): HourslipEngine => {
    const env = async (name: string) => envVars[name]
    const spawn = opts.spawn
    return {
      env: { hourslipHome: () => env('HOURSLIP_HOME'), home: () => env('HOME'), userProfile: () => env('USERPROFILE'), server: () => env('HOURSLIP_SERVER'), os: () => env('OS'), claudeConfigDir: () => env('CLAUDE_CONFIG_DIR') },
      session: { id: async () => 'sess-1', cwd: async () => cwd, repo: async () => null },
      fs: {
        read: async (p: string) => fsRead(p),
        write: async (p: string, t: string) => { if (!fsWrite(p, t)) throw new Error(opts.failWriteMessage) },
        exists: async (p: string) => files.has(norm(p)),
        list: async (p: string) => fsList(p),
        stat: async (p: string) => fsStat(p),
      },
      clock: { now: async () => clock.now() },
      ui: { status: (t: string | undefined) => { statuses.push(t) }, toast: (t: string) => { toasts.push(t) }, copy: async () => false },
      process: {
        run: async () => { throw new Error('no git here') },
        ...(spawn ? { spawn: (req: { argv: readonly string[] }) => (async function* () {
          spawns.push([...req.argv])
          const text = files.get(norm(req.argv[req.argv.length - 1]))
          if (text === undefined) return { code: 1, signal: null }
          const { pieces, code = 0 } = spawn(text, [...req.argv])
          for (const t of pieces) if (t !== '') yield { stream: 'stdout' as const, text: t }
          return { code, signal: null }
        })() } : {}),
      },
      http: { fetch: async () => { throw new Error('no network in this test') } },
      store: { get: async () => undefined, set: async () => {}, delete: async () => {} },
      ...extra,
    } as unknown as HourslipEngine
  }
  return { engine, files, mtimes, writes, fetches, copies, statuses, toasts, panes, titles, states, runs, spawns, reads, clock, paneLines: () => (states.filter(s => s.key === 'pane').at(-1)?.value as { lines?: string[] } | undefined)?.lines, read: (p: string) => files.get(norm(p)) }
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
