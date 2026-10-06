import { addDays } from '../core/dates.ts'
import { parseHead } from '../core/rules.ts'
import type { TicketSource } from '../core/types.ts'
import type { BranchEngine, GitEngine } from './paths.ts'

const isAbsolute = (p: string) => /^([A-Za-z]:)?[\\/]/.test(p)

export async function readBranch($: BranchEngine): Promise<string | null> {
  const repo = await $.session.repo()
  if (!repo) return null
  let gitDir = `${repo.root}/.git`
  try {
    return parseHead(await $.fs.read(`${gitDir}/HEAD`))
  } catch {
    try {
      const pointer = /^gitdir:\s*(.+)$/m.exec(await $.fs.read(gitDir))
      if (!pointer) return null
      const target = pointer[1].trim()
      gitDir = isAbsolute(target) ? target : `${repo.root}/${target}`
      return parseHead(await $.fs.read(`${gitDir}/HEAD`))
    } catch {
      return null
    }
  }
}

/** Commit subjects per ticket from each recorded branch. CLI only: elsewhere every source is unavailable. */
export async function commitsFor($: GitEngine, sources: TicketSource[], author: string | null, from: string, to: string): Promise<{ commits: Record<string, string[]>; unavailable: number }> {
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
          const r = await $.process.run(['git', 'config', 'user.name'], { cwd: s.cwd })
          authors.set(s.cwd, r.exitCode === 0 ? r.stdout.trim() || null : null)
        }
        who = authors.get(s.cwd) ?? null
      }
      const argv = ['git', 'log', '--no-merges', `--since=${from}T00:00:00`, `--until=${addDays(to, 1)}T00:00:00`, '--format=%s', ...(who ? ['--fixed-strings', `--author=${who}`] : []), '--end-of-options', s.branch]
      const r = await $.process.run(argv, { cwd: s.cwd })
      if (r.exitCode !== 0) { unavailable++; continue }
      const subjects = r.stdout.split(/\r?\n/).map(x => x.trim()).filter(Boolean)
      commits[s.ticket] = [...new Set([...(commits[s.ticket] ?? []), ...subjects])]
    } catch {
      unavailable++
    }
  }
  return { commits, unavailable }
}
