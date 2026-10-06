// Runs Claude Code's own plugin tooling over plugin/. Not part of `pnpm test`.
// A missing `claude plugin test` is a failure, never a skip.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const plugin = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'plugin')
const env = process.env
const run = (cmd, args, capture = false) =>
  spawnSync(cmd, args, { cwd: plugin, env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', shell: process.platform === 'win32' })
const fail = (m, d = '') => { console.error(`test:mod: ${m}${d ? `\n${d}` : ''}`); process.exit(1) }

const help = run('claude', ['plugin', 'test', '--help'], true)
if (help.status !== 0) fail('`claude plugin test` is unavailable, so the hooks module was NOT tested', `${help.stdout}${help.stderr}`)

const validate = run('claude', ['plugin', 'validate', '.'], true)
console.log(`${validate.stdout}${validate.stderr}`)
if (validate.status !== 0) fail('claude plugin validate failed')

if (process.argv.includes('--typecheck')) {
  const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc')
  if (spawnSync(process.execPath, [tsc, '-p', 'tsconfig.mod.json'], { cwd: plugin, stdio: 'inherit' }).status !== 0) fail('hooks or tests do not typecheck')
}

if (run('claude', ['plugin', 'test', '.']).status !== 0) fail('claude plugin test failed')
