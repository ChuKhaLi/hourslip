// A real `claude -p` with the plugin, on whatever OS runs it (CI: Linux, macOS, Windows). Slash
// commands only: no model call, no login. Everything lives in a temp dir (HOURSLIP_HOME and
// CLAUDE_CONFIG_DIR), never in ~/.hourslip or ~/.claude.
//   1. a session in a git worktree outside the client folder records the worktree's branch and the repository;
//   2. /hourslip import reads a transcript over 4 MiB (the `cat` / `cmd /c type` path) and imports it.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const plugin = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'plugin')
// realpath: macOS's tmpdir is /var/..., which git and the engine report as /private/var/...
const root = realpathSync(mkdtempSync(join(tmpdir(), 'hourslip-smoke-')))
const home = join(root, 'home')
const config = join(root, 'claude')
const repo = join(root, 'work', 'acme')
const worktree = join(root, 'work', 'acme.worktrees', 'x')
const env = { ...process.env, HOURSLIP_HOME: home, CLAUDE_CONFIG_DIR: config, MSYS_NO_PATHCONV: '1' }
const slash = p => p.replaceAll('\\', '/')
const same = (a, b) => slash(a).toLowerCase() === slash(b).toLowerCase()
let failed = 0
const check = (name, ok, detail) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`) }

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}\n${r.stdout}${r.stderr}${r.error ?? ''}`)
  return r.stdout.trim()
}
const hourslip = (args, cwd = repo) => run('claude', ['-p', '--plugin-dir', plugin, `/hourslip ${args}`.trim()], cwd)
const git = (args, cwd = repo) => run('git', ['-c', 'user.name=smoke', '-c', 'user.email=smoke@hourslip.test', ...args], cwd)

try {
  mkdirSync(repo, { recursive: true })
  mkdirSync(config, { recursive: true })
  git(['init', '-q', '-b', 'main'])
  git(['commit', '-q', '--allow-empty', '-m', 'init'])
  git(['remote', 'add', 'origin', 'https://smoke-user:smoke-token@github.com/Acme/Smoke.git'])
  git(['worktree', 'add', '-q', '-b', 'feature/ACME-21-x', worktree])

  const added = hourslip(`client add acme "ACME" --path "${slash(repo)}/**"`)
  check('client add', /Added client acme/.test(added), added)

  // 1. A session in the worktree.
  const week = hourslip('', worktree)
  check('/hourslip in a worktree', /Week of/.test(week), week.split('\n')[0])
  const events = readdirSync(join(home, 'events')).flatMap(f => readFileSync(join(home, 'events', f), 'utf8').trim().split('\n').map(l => JSON.parse(l)))
  const here = events.filter(e => same(e.cwd, worktree))
  check('worktree branch', here.length > 0 && here.every(e => e.branch === 'feature/ACME-21-x'), `${here.length} events, branch ${here[0]?.branch}`)
  check('repository root', here.length > 0 && here.every(e => same(realpathSync(e.repo?.root ?? '.'), repo)), `${here[0]?.repo?.root}`)
  check('remote without credentials', here.length > 0 && here.every(e => e.repo?.remote === 'https://github.com/Acme/Smoke.git'), `${here[0]?.repo?.remote}`)

  // 2. A past session in the client folder, in a transcript over 4 MiB.
  const sid = '00000000-0000-4000-8000-000000000021'
  const t0 = Date.now() - 3 * 86_400_000
  const at = min => new Date(t0 + min * 60_000).toISOString()
  const line = (type, min, content, extra = {}) => JSON.stringify({ type, sessionId: sid, timestamp: at(min), cwd: repo, gitBranch: 'feature/ACME-21-x', uuid: `${type}-${min}`, message: { role: type, content }, ...extra })
  const pad = 'x'.repeat(100_000)
  const lines = [line('user', 0, 'smoke prompt'), ...Array.from({ length: 50 }, (_, i) => line('assistant', 1 + i * 0.2, [{ type: 'text', text: pad }]))]
  const project = join(config, 'projects', slash(repo).replace(/[^A-Za-z0-9]/g, '-'))
  mkdirSync(project, { recursive: true })
  writeFileSync(join(project, `${sid}.jsonl`), lines.join('\n') + '\n')
  let reply = ''
  for (let i = 0; i < 10; i++) {
    reply = hourslip('import --confirm')
    if (!/left\)/.test(reply)) break
  }
  check('import of a transcript over 4 MiB', /Imported 1 session/.test(reply), reply)
} catch (err) {
  failed++
  console.log(`FAIL  stopped: ${err instanceof Error ? err.message : String(err)}`)
}

if (failed) console.log(`Kept: ${root}`)
else rmSync(root, { recursive: true, force: true })
console.log(`${failed ? `${failed} failed` : 'all passed'}`)
process.exit(failed ? 1 : 0)
