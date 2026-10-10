import { DEFAULT_TICKET_PATTERN, type Attribution, type ClientRule, type RepoRef, type Rules } from './types.ts'

export const DEFAULT_RULES: Rules = {
  v: 1,
  business: { name: '', paymentInstructions: '' },
  ticketPattern: DEFAULT_TICKET_PATTERN,
  csv: 'en',
  author: null,
  tzOffsetMinutes: null,
  clients: [],
}

export type RulesResult = { ok: true; rules: Rules } | { ok: false; error: string }

function lineOf(text: string, message: string): string {
  const line = /line (\d+)/.exec(message)?.[1]
  if (line) return `line ${line}`
  const pos = /position (\d+)/.exec(message)?.[1]
  if (pos) return `line ${text.slice(0, Number(pos)).split('\n').length}`
  return 'unknown line'
}

function validPattern(p: unknown): p is string {
  if (typeof p !== 'string') return false
  try { new RegExp(p); return true } catch { return false }
}

export function parseRules(text: string): RulesResult {
  let o: any
  try {
    o = JSON.parse(text)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `rules.json is not valid JSON (${lineOf(text, message)}): ${message}` }
  }
  const fail = (error: string): RulesResult => ({ ok: false, error: `rules.json: ${error}` })
  if (!o || typeof o !== 'object' || Array.isArray(o)) return fail('the top level must be an object')
  const business = { ...DEFAULT_RULES.business, ...(o.business ?? {}) }
  if (typeof business.name !== 'string' || typeof business.paymentInstructions !== 'string') return fail('business.name and business.paymentInstructions must be text')
  const ticketPattern = o.ticketPattern ?? DEFAULT_TICKET_PATTERN
  if (!validPattern(ticketPattern)) return fail('ticketPattern is not a valid pattern')
  const csv = o.csv ?? 'en'
  if (csv !== 'en' && csv !== 'vi') return fail('csv must be "en" or "vi"')
  const author = o.author ?? null
  if (author !== null && typeof author !== 'string') return fail('author must be text or null')
  const tz = o.tzOffsetMinutes ?? null
  if (tz !== null && (!Number.isInteger(tz) || tz < -720 || tz > 840)) return fail('tzOffsetMinutes must be whole minutes between -720 and 840')
  const rawClients = o.clients ?? []
  if (!Array.isArray(rawClients)) return fail('clients must be a list')
  const clients: ClientRule[] = []
  const seen = new Set<string>()
  for (const [i, c] of rawClients.entries()) {
    const at = `clients[${i}]`
    if (!c || typeof c.id !== 'string' || c.id === '') return fail(`${at}.id must be non-empty text`)
    if (seen.has(c.id)) return fail(`duplicate client id "${c.id}"`)
    seen.add(c.id)
    if (typeof c.name !== 'string') return fail(`${at}.name must be text`)
    if (!Array.isArray(c.paths) || !c.paths.every((p: unknown) => typeof p === 'string')) return fail(`${at}.paths must be a list of text`)
    const repos = c.repos ?? []
    if (!Array.isArray(repos) || !repos.every((p: unknown) => typeof p === 'string')) return fail(`${at}.repos must be a list of text`)
    const rate = c.rate ?? null
    if (rate !== null && !(typeof rate.amount === 'number' && rate.amount >= 0 && Number.isFinite(rate.amount) && typeof rate.currency === 'string' && /^[A-Z]{3}$/.test(rate.currency))) {
      return fail(`${at}.rate must be { amount: a number >= 0, currency: three capital letters }`)
    }
    const tp = c.ticketPattern ?? null
    if (tp !== null && !validPattern(tp)) return fail(`${at}.ticketPattern is not a valid pattern`)
    clients.push({ id: c.id, name: c.name, paths: c.paths, ...(repos.length ? { repos } : {}), rate, ticketPattern: tp })
  }
  return { ok: true, rules: { v: 1, business, ticketPattern, csv, author, tzOffsetMinutes: tz, clients } }
}

const isWindowsPath = (p: string) => /^[A-Za-z]:[\\/]/.test(p)
const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')

function globToRegExp(glob: string, insensitive: boolean): RegExp {
  let g = norm(glob)
  let tail = ''
  if (g.endsWith('/**')) { g = g.slice(0, -3); tail = '(?:/.*)?' }
  let src = ''
  for (let i = 0; i < g.length; i++) {
    const ch = g[i]
    if (ch === '*' && g[i + 1] === '*') { src += '.*'; i++ }
    else if (ch === '*') src += '[^/]*'
    else if (ch === '?') src += '[^/]'
    else src += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${src}${tail}$`, insensitive ? 'i' : '')
}

export function matchPath(glob: string, cwd: string): boolean {
  const insensitive = isWindowsPath(cwd) || isWindowsPath(glob)
  return globToRegExp(glob, insensitive).test(norm(cwd))
}

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i

/** A remote URL without the user and password a URL may carry; scp form (`git@host:x`) is left as it is. */
export function stripCredentials(url: string): string {
  const scheme = SCHEME.exec(url)
  if (!scheme) return url
  return scheme[0] + url.slice(scheme[0].length).replace(/^[^@/]*@/, '')
}

/** One form for every way to write a remote: `host/owner/name` or a path, lower-case, without scheme, user, port or `.git`. */
export function normalizeRemote(remote: string): string {
  let s = remote.trim().replace(/\\/g, '/')
  const scheme = SCHEME.exec(s)
  if (scheme) {
    s = s.slice(scheme[0].length).replace(/^[^@/]*@/, '').replace(/^([^/:]+):[0-9]+(?=\/|$)/, '$1')
    // file:///C:/x leaves /C:/x: the drive is the start of the path.
    s = s.replace(/^\/([A-Za-z]:\/)/, '$1')
  } else {
    // scp form `user@host:path` (the path may be absolute); a one-letter "host" is a Windows drive, not a host.
    const scp = /^(?:[^@/]+@)?([^/:]+):(.+)$/.exec(s)
    if (scp && scp[1].length > 1) s = `${scp[1]}/${scp[2].replace(/^\/+/, '')}`
  }
  return s.replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '').toLowerCase()
}

export function matchRemote(pattern: string, remote: string): boolean {
  return globToRegExp(normalizeRemote(pattern), false).test(normalizeRemote(remote))
}

export function attribute(rules: Rules, cwd: string, branch: string | null, repo?: RepoRef | null): Attribution {
  const client = rules.clients.find(c =>
    c.paths.some(g => matchPath(g, cwd) || (!!repo && matchPath(g, repo.root))) ||
    (!!repo?.remote && (c.repos ?? []).some(p => matchRemote(p, repo.remote!))))
  if (!client) return { client: null, ticket: null }
  const pattern = new RegExp(client.ticketPattern ?? rules.ticketPattern)
  return { client: client.id, ticket: branch ? (pattern.exec(branch)?.[0] ?? null) : null }
}

export function parseHead(text: string): string | null {
  const t = text.trim()
  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(t)
  if (ref) return ref[1].startsWith('-') || /[\x00-\x1f\x7f]/.test(ref[1]) ? null : ref[1]
  return /^[0-9a-f]{7,40}$/.test(t) ? t.slice(0, 7) : null
}

export function clientName(rules: Rules, id: string | null): string {
  if (id === null) return 'Unassigned'
  return rules.clients.find(c => c.id === id)?.name ?? id
}
