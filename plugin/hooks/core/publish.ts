import { formatMinutes } from './dates.ts'
import type { Snapshot } from './snapshot.ts'

/** One published report as the mod remembers it (`$.store` key `reports`). */
export type PublishedReport = { id: string; url: string; client: string; month: string; version: number; confirmedBy?: string; confirmedAt?: string }

export const KEY_RE = /^hs_[0-9A-Za-z]{32}$/

/** Text from the server or the store ends up in a terminal: strip control, C1 and bidi characters, trim, cap. */
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g
export function clean(s: string, max: number): string {
  const t = s.replace(UNSAFE, '').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/** A report id from the server goes into URL paths. */
export const REPORT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

/** Malformed reads as absent (parent spec §7): a non-array is [], a bad entry is dropped. */
export function parseReports(x: unknown): PublishedReport[] {
  if (!Array.isArray(x)) return []
  const out: PublishedReport[] = []
  for (const e of x) {
    if (!isObj(e)) continue
    const { id, url, client, month, version, confirmedBy, confirmedAt } = e
    if (typeof id !== 'string' || typeof url !== 'string' || typeof client !== 'string' || typeof month !== 'string' || typeof version !== 'number') continue
    if (!REPORT_ID_RE.test(id)) continue
    const cleanClient = clean(client, 64)
    if (!cleanClient) continue
    out.push({ id, url: clean(url, 300), client: cleanClient, month: clean(month, 7), version, ...(typeof confirmedBy === 'string' ? { confirmedBy: clean(confirmedBy, 100) } : {}), ...(typeof confirmedAt === 'string' ? { confirmedAt: clean(confirmedAt, 40) } : {}) })
  }
  return out
}

export function upsertReport(list: PublishedReport[], entry: PublishedReport): PublishedReport[] {
  const old = list.find(e => e.client === entry.client && e.month === entry.month)
  if (old && old.version > entry.version) return list
  return [...list.filter(e => e !== old), entry]
}

export function publishedLines(list: PublishedReport[]): string[] {
  if (list.length === 0) return []
  const sorted = [...list].sort((a, b) => b.month.localeCompare(a.month) || a.client.localeCompare(b.client))
  return ['Published', ...sorted.map(e => `  ${e.client} ${e.month} v${e.version} · ${e.confirmedBy ? `✓ confirmed by ${e.confirmedBy} (link holder, unverified)` : 'not confirmed'}`)]
}

/** The server's own message when it sent one (parent §7), else a sentence that never shows the body. */
export function serverMessage(status: number, body: string): string {
  try {
    const m = (JSON.parse(body) as { error?: { message?: unknown } })?.error?.message
    if (typeof m === 'string' && clean(m, 500)) return clean(m, 500)
  } catch {
    // not JSON: a proxy's error page
  }
  return status >= 500 ? `The hourslip server had a problem (HTTP ${status}). Try again in a few minutes.` : `The hourslip server refused the request (HTTP ${status}).`
}

/** Only Dodo's checkout and portal pages are opened; the path may hold only URL-safe characters. */
const DODO = /^https:\/\/(test\.)?(checkout|customer)\.dodopayments\.com\/[A-Za-z0-9._~/?=&%+-]*$/
export const openableUrl = (url: string) => DODO.test(url)

export type Os = 'windows' | 'mac' | 'linux'
/** argv, never a shell: a checkout URL carries `&`, which cmd.exe would treat as a command separator. */
export function openArgv(os: Os, url: string): string[] {
  if (os === 'windows') return ['rundll32', 'url.dll,FileProtocolHandler', url]
  return [os === 'mac' ? 'open' : 'xdg-open', url]
}

const money = (cents: number, currency: string) => `${(cents / 100).toFixed(2)} ${currency}`
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function summaryLines(s: Snapshot, notes: string[], previewPath: string, confirmCommand: string): string[] {
  const t = s.totals
  return [
    `${s.client.name} · ${s.period.from} to ${s.period.to}`,
    `Billable ${formatMinutes(t.presenceMinutes + t.manualMinutes)} (measured ${formatMinutes(t.presenceMinutes)}, by hand ${formatMinutes(t.manualMinutes)}) · Claude ${formatMinutes(t.claudeMinutes)}`,
    ...(s.invoice ? [`Invoice ${s.invoice.number}: ${money(s.invoice.amountCents, s.invoice.currency)}, due ${s.invoice.dueDate}`] : []),
    `${count(s.days.length, 'day')}, ${count(s.tickets.length, 'ticket')}${s.showCommits ? '' : ' · commit titles hidden'}`,
    ...notes,
    `Preview: ${previewPath}`,
    `Publish: ${confirmCommand}`,
    'Nothing has been sent yet.',
  ]
}
