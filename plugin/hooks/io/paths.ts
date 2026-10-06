import type { FsEntry, ProcessRunInit, ProcessRunResult, SessionRepo } from 'claude-code'

/**
 * What the io layer needs of `$`, as plain functions in narrow ports. `claude plugin validate` refuses a
 * hook that passes `$` or any noun of it (`$.fs`) to a helper, so a hook hands over closures that each
 * spell one `$.noun.method(...)` call (see install.ts), and builds only the ports its consumer uses.
 * (`Parameters<Parameters<On>[1]>[0]` collapses to never: On is overloaded and generic.)
 */
/** One method per variable: `validate` wants a literal name in every `$.env.get`. */
export type EnvPort = { hourslipHome(): Promise<string | undefined>; home(): Promise<string | undefined>; userProfile(): Promise<string | undefined> }
export type SessionPort = { id(): Promise<string>; cwd(): Promise<string>; repo(): Promise<SessionRepo | null> }
export type ClockPort = { now(): Promise<number> }
export type UiPort = { status(text: string | undefined): void; toast(text: string): void }
export type ProcessPort = { run(argv: readonly string[], init?: ProcessRunInit): Promise<ProcessRunResult> }

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

const trim = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')

export async function homeDir($: HomeEngine): Promise<string> {
  const explicit = await $.env.hourslipHome()
  if (explicit) return trim(explicit)
  const base = (await $.env.home()) || (await $.env.userProfile())
  if (!base) throw new Error('hourslip: neither HOME nor USERPROFILE is set')
  return `${trim(base)}/.hourslip`
}
