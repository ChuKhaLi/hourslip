import type { FsEntry, ProcessRunInit, ProcessRunResult, ProcessSpawnChunk, ProcessSpawnRequest, ProcessSpawnResult, SessionRepo } from 'claude-code'

/**
 * What the io layer needs of `$`, as plain functions in narrow ports. `claude plugin validate` refuses a
 * hook that passes `$` or any noun of it (`$.fs`) to a helper, so a hook hands over closures that each
 * spell one `$.noun.method(...)` call (see install.ts), and builds only the ports its consumer uses.
 * (`Parameters<Parameters<On>[1]>[0]` collapses to never: On is overloaded and generic.)
 */
/** One method per variable: `validate` wants a literal name in every `$.env.get`. */
export type EnvPort = { hourslipHome(): Promise<string | undefined>; home(): Promise<string | undefined>; userProfile(): Promise<string | undefined>; server(): Promise<string | undefined>; os(): Promise<string | undefined> }
export type SessionPort = { id(): Promise<string>; cwd(): Promise<string>; repo(): Promise<SessionRepo | null> }
export type ClockPort = { now(): Promise<number> }
export type UiPort = { status(text: string | undefined): void; toast(text: string): void; copy(text: string): Promise<boolean> }
export type ProcessPort = { run(argv: readonly string[], init?: ProcessRunInit): Promise<ProcessRunResult> }
export type HttpPort = { fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; ok: boolean; text: string }> }
export type StorePort = { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void>; delete(key: string): Promise<void> }
/** What the server client needs: the server URL from env, the network, and the store. */
export type ServerEngine = { env: Pick<EnvPort, 'server'>; http: HttpPort; store: StorePort }

export type HomeEngine = { env: EnvPort }
export type ReadEngine = { fs: { read(path: string): Promise<string> } }
export type WriteEngine = { fs: { write(path: string, text: string): Promise<void> } }
/** Reads where a missing file and an unreadable one must be told apart (anything that may write afterwards). */
export type StrictReadEngine = { fs: { read(path: string): Promise<string>; exists(path: string): Promise<boolean> } }
export type AppendEngine = { fs: { read(path: string): Promise<string>; exists(path: string): Promise<boolean>; write(path: string, text: string): Promise<void> } }
export type SessionsEngine = { fs: { read(path: string): Promise<string>; list(path: string): Promise<FsEntry[]> } }
export type BranchEngine = { session: Pick<SessionPort, 'repo'>; fs: { read(path: string): Promise<string> } }
export type GitEngine = { process: ProcessPort }
/** The recorder: env, session, clock and ui, and the session file (read, exists, write). */
export type RecorderEngine = HomeEngine & {
  session: SessionPort
  fs: { read(path: string): Promise<string>; write(path: string, text: string): Promise<void>; exists(path: string): Promise<boolean> }
  clock: ClockPort
  ui: UiPort
}
/** The status line: home, today's files (read, list), clock, the session, and ui.status. */
export type StatusEngine = HomeEngine & {
  session: SessionPort
  fs: { read(path: string): Promise<string>; list(path: string): Promise<FsEntry[]> }
  clock: ClockPort
  ui: Pick<UiPort, 'status'>
}

/** The week pane: home, the event files (read, list), clock. */
export type PaneEngine = HomeEngine & { fs: { read(path: string): Promise<string>; list(path: string): Promise<FsEntry[]> }; clock: ClockPort }
/** `/hourslip`: everything a subcommand needs, including what `recorder.record` needs for `tag`, and git for the export preview. */
export type CommandEngine = RecorderEngine & {
  fs: { read(path: string): Promise<string>; write(path: string, text: string): Promise<void>; exists(path: string): Promise<boolean>; list(path: string): Promise<FsEntry[]> }
  process: ProcessPort
}

/** `/hourslip` with the paid tier: CommandEngine plus the network and the store. */
export type PublishEngine = CommandEngine & { http: HttpPort; store: StorePort }

/** `$.process.spawn` as the import reads it: pieces of text, then how the child ended. */
export type SpawnPort = (request: ProcessSpawnRequest) => AsyncIterator<ProcessSpawnChunk, ProcessSpawnResult>
/**
 * `/hourslip import`: CommandEngine plus the Claude Code config dir, `fs.stat` (to tell a file over 4 MiB),
 * and `process.spawn`, which the desktop app may lack (then large transcripts are skipped and counted).
 */
export type ImportEngine = CommandEngine & {
  env: EnvPort & { claudeConfigDir(): Promise<string | undefined> }
  fs: CommandEngine['fs'] & { stat(path: string): Promise<{ size: number }> }
  process: ProcessPort & { spawn?: SpawnPort }
  /**
   * What is left of the hook's own time, in ms (`next.budget.remainingMs`: it stands still while a `$` call is in
   * flight). None: unlimited (the kit, which meters nothing).
   */
  budget?: () => number
}

export const trim = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')

export async function homeDir(engine: HomeEngine): Promise<string> {
  const explicit = await engine.env.hourslipHome()
  if (explicit) return trim(explicit)
  const base = (await engine.env.home()) || (await engine.env.userProfile())
  if (!base) throw new Error('hourslip: neither HOME nor USERPROFILE is set')
  return `${trim(base)}/.hourslip`
}

/** The Claude Code config dir: CLAUDE_CONFIG_DIR when set, else `<HOME or USERPROFILE>/.claude` (never HOURSLIP_HOME). */
export async function claudeDir(engine: { env: Pick<EnvPort, 'home' | 'userProfile'> & { claudeConfigDir(): Promise<string | undefined> } }): Promise<string> {
  const explicit = await engine.env.claudeConfigDir()
  if (explicit) return trim(explicit)
  const base = (await engine.env.home()) || (await engine.env.userProfile())
  if (!base) throw new Error('hourslip: neither HOME nor USERPROFILE is set')
  return `${trim(base)}/.claude`
}
