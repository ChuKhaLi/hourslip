import { addDays } from '../core/dates.ts'
import { parseHead, stripCredentials } from '../core/rules.ts'
import type { RepoRef, TicketSource } from '../core/types.ts'
import type { BranchEngine, GitEngine } from './paths.ts'

const isAbsolute = (p: string) => /^([A-Za-z]:)?[\\/]/.test(p)
const slash = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
const parentOf = (p: string) => { const i = slash(p).lastIndexOf('/'); return i > 0 ? slash(p).slice(0, i) : null }
const samePath = (a: string, b: string) => slash(a).toLowerCase() === slash(b).toLowerCase()

/** `dir` joined with a relative path, `.` and `..` folded (a worktree's `.git` may say `gitdir: ../x`). */
function joinPath(dir: string, rel: string): string {
  const out = slash(dir).split('/')
  for (const part of slash(rel).split('/')) {
    if (part === '..') out.pop()
    else if (part !== '.' && part !== '') out.push(part)
  }
  return out.join('/')
}

/** The branch of the git folder at `dir`: a string or null when `dir` holds `.git`; undefined when it holds none. */
async function headAt(engine: BranchEngine, dir: string): Promise<string | null | undefined> {
  try {
    return parseHead(await engine.fs.read(`${dir}/.git/HEAD`))
  } catch { /* no .git folder here: maybe a worktree's .git file */ }
  let pointer: string
  try {
    pointer = await engine.fs.read(`${dir}/.git`)
  } catch {
    return undefined
  }
  // A .git file ends the walk whatever it says: never fall through to an outer repository's branch.
  const target = /^gitdir:\s*(.+)$/m.exec(pointer)?.[1].trim()
  if (!target) return null
  try {
    return parseHead(await engine.fs.read(`${isAbsolute(target) ? slash(target) : joinPath(dir, target)}/HEAD`))
  } catch {
    return null
  }
}

/** Where the session is: its folder, the branch checked out there (a worktree's own), and its repository. Reads only. */
export async function readLocation(engine: BranchEngine): Promise<{ cwd: string; branch: string | null; repo: RepoRef | null }> {
  const cwd = await engine.session.cwd()
  const found = await engine.session.repo()
  if (!found) return { cwd, branch: null, repo: null }
  const repo: RepoRef = { root: found.root, remote: found.remote === null ? null : stripCredentials(found.remote) }
  let dir: string | null = slash(cwd)
  for (let depth = 0; dir !== null && depth < 64; depth++) {
    const branch = await headAt(engine, dir)
    if (branch !== undefined) return { cwd, branch, repo }
    if (samePath(dir, found.root)) break
    dir = parentOf(dir)
  }
  return { cwd, branch: null, repo }
}

/** Commit subjects per ticket from each recorded branch. CLI only: elsewhere every source is unavailable. */
export async function commitsFor(engine: GitEngine, sources: TicketSource[], author: string | null, from: string, to: string): Promise<{ commits: Record<string, string[]>; unavailable: number }> {
  const commits: Record<string, string[]> = {}
  let unavailable = 0
  const authors = new Map<string, string | null>()
  for (const s of sources) {
    try {
      // The branch comes from a file in the repository: never let it be read as an option.
      if (s.branch.startsWith('-')) { unavailable++; continue }
      let who = author
      if (who === null) {
        if (!authors.has(s.cwd)) {
          const r = await engine.process.run(['git', 'config', 'user.name'], { cwd: s.cwd })
          authors.set(s.cwd, r.exitCode === 0 ? r.stdout.trim() || null : null)
        }
        who = authors.get(s.cwd) ?? null
      }
      const argv = ['git', 'log', '--no-merges', `--since=${from}T00:00:00`, `--until=${addDays(to, 1)}T00:00:00`, '--format=%s', ...(who ? ['--fixed-strings', `--author=${who}`] : []), '--end-of-options', s.branch]
      const r = await engine.process.run(argv, { cwd: s.cwd })
      if (r.exitCode !== 0) { unavailable++; continue }
      const subjects = r.stdout.split(/\r?\n/).map(x => x.trim()).filter(Boolean)
      commits[s.ticket] = [...new Set([...(commits[s.ticket] ?? []), ...subjects])]
    } catch {
      unavailable++
    }
  }
  return { commits, unavailable }
}
