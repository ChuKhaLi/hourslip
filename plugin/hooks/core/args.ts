import { isCalendarDate } from './dates.ts'

export type Command =
  | { kind: 'pane' }
  | { kind: 'tz' }
  | { kind: 'tag'; client: string; ticket: string | null; scope: 'from-now' | 'session' }
  | { kind: 'add'; minutes: number; client: string; note: string; date: string | null; ticket: string | null }
  | { kind: 'client-add'; id: string; name: string; paths: string[]; rate: { amount: number; currency: string } | null }
  | { kind: 'export'; client: string | null; month: string | null }
  | { kind: 'publish'; client: string; month: string | null; confirm: boolean; showCommits: boolean }
  | { kind: 'unpublish'; client: string; month: string }
  | { kind: 'subscribe'; plan: 'yearly' | 'monthly' }
  | { kind: 'portal' }
  | { kind: 'key' }
  | { kind: 'key-show' }
  | { kind: 'key-set'; key: string }
  | { kind: 'key-forget' }
  | { kind: 'error'; message: string }

export const USAGE = [
  'Usage:',
  '  /hourslip                                   this week',
  '  /hourslip tag <client> [ticket] [--session] attribute this session',
  '  /hourslip add <1h30> <client> "<note>" [--date YYYY-MM-DD] [--ticket X]',
  '  /hourslip client add <id> "<name>" --path <glob> [--path <glob>] [--rate <amount> <CUR>]',
  '  /hourslip export [client] [YYYY-MM]',
  '  /hourslip publish <client> [YYYY-MM] [--no-commits]   preview a report; add --confirm to publish it',
  '  /hourslip unpublish <client> <YYYY-MM>     delete a published report (its link answers 410)',
  '  /hourslip subscribe [--monthly]            buy Pro (yearly unless --monthly)',
  '  /hourslip portal                           manage or cancel Pro',
  '  /hourslip key | key show | key set <key> | key forget',
  '  /hourslip tz                                the timezone offset hourslip records',
].join('\n')

export function tokenize(s: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) out.push(m[1] ?? m[2])
  return out
}

export function parseDuration(s: string): number | null {
  const hm = /^(\d+)h(\d{1,2})?$/.exec(s)
  const m = /^(\d+)m$/.exec(s)
  const dec = /^(\d+(?:\.\d+)?)h$/.exec(s)
  const minutes = hm ? Number(hm[1]) * 60 + Number(hm[2] ?? 0) : m ? Number(m[1]) : dec ? Math.round(Number(dec[1]) * 60) : NaN
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null
}

const MONTH = /^\d{4}-\d{2}$/
const ID = /^[a-z0-9][a-z0-9-]*$/

const BOOLEAN = new Set(['--session', '--confirm', '--no-commits', '--monthly'])

function flags(tokens: string[]): { rest: string[]; opts: Map<string, string[]> } {
  const rest: string[] = []
  const opts = new Map<string, string[]>()
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (BOOLEAN.has(t)) opts.set(t.slice(2), [])
    else if (t === '--rate') { opts.set('rate', [tokens[i + 1] ?? '', tokens[i + 2] ?? '']); i += 2 }
    else if (t.startsWith('--')) { const k = t.slice(2); opts.set(k, [...(opts.get(k) ?? []), tokens[i + 1] ?? '']); i++ }
    else rest.push(t)
  }
  return { rest, opts }
}

export function parseCommand(args: string): Command {
  const [verb, ...tokens] = tokenize(args)
  const err = (message: string): Command => ({ kind: 'error', message })
  if (verb === undefined) return { kind: 'pane' }
  if (verb === 'tz') return { kind: 'tz' }
  const { rest, opts } = flags(tokens)
  if (verb === 'tag') {
    if (rest.length < 1 || rest.length > 2) return err('Usage: /hourslip tag <client> [ticket] [--session]')
    if (!rest[0] || (rest[1] !== undefined && !rest[1])) return err('Usage: /hourslip tag <client> [ticket] [--session]')
    return { kind: 'tag', client: rest[0], ticket: rest[1] ?? null, scope: opts.has('session') ? 'session' : 'from-now' }
  }
  if (verb === 'add') {
    const usage = 'Usage: /hourslip add <1h30> <client> "<note>" [--date YYYY-MM-DD] [--ticket X]'
    if (rest.length !== 3) return err(usage)
    if (!rest[1] || !rest[2]) return err(usage)
    const minutes = parseDuration(rest[0])
    if (minutes === null) return err(`"${rest[0]}" is not a duration like 1h, 90m, 1h30 or 1.5h.`)
    const date = opts.get('date')?.[0] ?? null
    if (date !== null && !isCalendarDate(date)) return err('--date must be YYYY-MM-DD.')
    const ticket = opts.get('ticket')?.[0] ?? null
    if (ticket !== null && !ticket) return err('--ticket must not be empty.')
    return { kind: 'add', minutes, client: rest[1], note: rest[2], date, ticket }
  }
  if (verb === 'client' && rest[0] === 'add') {
    const usage = 'Usage: /hourslip client add <id> "<name>" --path <glob> [--path <glob>] [--rate <amount> <CUR>]'
    const [, id, name] = rest
    const paths = opts.get('path') ?? []
    if (!id || !name || paths.length === 0 || paths.some(p => p === '')) return err(usage)
    if (!ID.test(id)) return err('A client id is lowercase letters, digits and dashes, like acme or acme-2.')
    let rate: { amount: number; currency: string } | null = null
    const r = opts.get('rate')
    if (r) {
      if (!r[0]) return err('--rate is an amount and a currency, like --rate 40 USD.')
      const amount = Number(r[0])
      if (!(amount >= 0) || !/^[A-Z]{3}$/.test(r[1])) return err('--rate is an amount and a currency, like --rate 40 USD.')
      rate = { amount, currency: r[1] }
    }
    return { kind: 'client-add', id, name, paths, rate }
  }
  if (verb === 'export') {
    const nonEmpty = rest.filter(t => t !== '')
    if (nonEmpty.length !== rest.length) return err('Usage: /hourslip export [client] [YYYY-MM]')
    const month = nonEmpty.find(t => MONTH.test(t)) ?? null
    const client = nonEmpty.find(t => !MONTH.test(t)) ?? null
    if (month !== null && !isCalendarDate(`${month}-01`)) return err('Usage: /hourslip export [client] [YYYY-MM]')
    return { kind: 'export', client, month }
  }
  if (verb === 'publish') {
    const usage = 'Usage: /hourslip publish <client> [YYYY-MM] [--no-commits] [--confirm]'
    const bad = [...opts.keys()].find(k => k !== 'confirm' && k !== 'no-commits')
    if (bad !== undefined) return err(`Unknown option --${bad}. publish takes --confirm and --no-commits.`)
    if (rest.length < 1 || rest.length > 2 || !rest[0] || MONTH.test(rest[0])) return err(usage)
    const month = rest[1] ?? null
    if (month !== null && (!MONTH.test(month) || !isCalendarDate(`${month}-01`))) return err(usage)
    return { kind: 'publish', client: rest[0], month, confirm: opts.has('confirm'), showCommits: !opts.has('no-commits') }
  }
  if (verb === 'unpublish') {
    if (opts.size > 0) return err('Usage: /hourslip unpublish <client> <YYYY-MM> (no options)')
    if (rest.length !== 2 || !rest[0] || !MONTH.test(rest[1]) || !isCalendarDate(`${rest[1]}-01`)) return err('Usage: /hourslip unpublish <client> <YYYY-MM>')
    return { kind: 'unpublish', client: rest[0], month: rest[1] }
  }
  if (verb === 'subscribe') {
    if ([...opts.keys()].some(k => k !== 'monthly') || rest.length > 0) return err('Usage: /hourslip subscribe [--monthly]')
    return { kind: 'subscribe', plan: opts.has('monthly') ? 'monthly' : 'yearly' }
  }
  if (verb === 'portal') {
    if (opts.size > 0 || rest.length > 0) return err('Usage: /hourslip portal (no options)')
    return { kind: 'portal' }
  }
  if (verb === 'key') {
    const usage = 'Usage: /hourslip key | /hourslip key show | /hourslip key set <key> | /hourslip key forget'
    if (opts.size > 0) return err(usage)
    if (rest.length === 0) return { kind: 'key' }
    if (rest[0] === 'forget' && rest.length === 1) return { kind: 'key-forget' }
    if (rest[0] === 'show' && rest.length === 1) return { kind: 'key-show' }
    if (rest[0] === 'set' && rest.length === 2 && rest[1]) return { kind: 'key-set', key: rest[1] }
    return err(usage)
  }
  return err(USAGE)
}
