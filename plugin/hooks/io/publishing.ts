import type { Command } from '../core/args.ts'
import { KEY_RE, REPORT_ID_RE, clean, openArgv, openableUrl, parseReports, summaryLines, upsertReport, type Os, type PublishedReport } from '../core/publish.ts'
import { renderReport } from '../core/report.ts'
import type { Rules } from '../core/types.ts'
import type { PublishEngine } from './paths.ts'
import { monthData, snapshotFor } from './report-data.ts'
import { KEY_UNKNOWN, ensureKey, offlineText, request, serverUrl, storedKey, type Reply } from './server.ts'

type Out = { text: string; openPane: boolean }
const say = (text: string): Out => ({ text, openPane: false })
const NO_KEY = 'No key yet: one is created on your first publish.'
const failure = async ($: PublishEngine, r: Exclude<Reply, { kind: 'ok' }>, previewPath?: string) =>
  r.kind === 'offline' ? offlineText(await serverUrl($), previewPath) : r.message

async function readReports($: PublishEngine): Promise<PublishedReport[]> {
  try { return parseReports(await $.store.get('reports')) } catch { return [] }
}

export async function publish($: PublishEngine, ctx: { home: string; rules: Rules; today: string }, cmd: Extract<Command, { kind: 'publish' }>): Promise<Out> {
  const month = cmd.month ?? ctx.today.slice(0, 7)
  const data = await monthData($, ctx.home, ctx.rules, month)
  const { snapshot, notes: commitNotes } = await snapshotFor($, data, ctx.rules, cmd.client, cmd.showCommits)
  const t = snapshot.totals
  if (t.presenceMinutes + t.manualMinutes + t.claudeMinutes === 0) return say(`Nothing recorded for ${cmd.client} in ${month}: nothing to publish.`)
  const notes = [...commitNotes, ...data.notes]
  const previewPath = `${ctx.home}/previews/${cmd.client}-${month}.html`
  await $.fs.write(previewPath, renderReport(snapshot, { banner: ['Preview: this is what your client will see.', ...notes] }))
  if (!cmd.confirm) {
    const confirm = `/hourslip publish ${cmd.client} ${month}${cmd.showCommits ? '' : ' --no-commits'} --confirm`
    return { text: summaryLines(snapshot, notes, previewPath, confirm).join('\n'), openPane: true }
  }
  const k = await ensureKey($)
  if (!('key' in k)) return say(await failure($, k as Exclude<Reply, { kind: 'ok' }>, previewPath))
  const r = await request($, 'POST', '/reports', { key: k.key, json: snapshot })
  if (r.kind !== 'ok') return say(await failure($, r, previewPath))
  const b = r.body as { id?: unknown; url?: unknown; version?: unknown } | null
  if (typeof b?.id !== 'string' || !REPORT_ID_RE.test(b.id) || typeof b.url !== 'string' || typeof b.version !== 'number') return say('The server sent an unexpected reply. Check /hourslip in a minute before publishing again.')
  const url = clean(b.url, 300)
  const entry: PublishedReport = { id: b.id, url, client: cmd.client, month, version: b.version }
  let remembered = true
  try { await $.store.set('reports', upsertReport(await readReports($), entry)) } catch { remembered = false }
  // The server has the report: a failing clipboard or toast must not hide the link.
  const copied = await tryCopy($, url)
  try { $.ui.toast(`Published ${cmd.client} ${month} v${b.version}${copied ? ' · link copied' : ''}`) } catch { /* the text below carries the link */ }
  return say([`Published ${cmd.client} ${month} v${b.version}: ${url}`, ...(copied ? ['The link is copied.'] : []), ...(remembered ? [] : ['This machine could not remember the report, so /hourslip unpublish and the pane will not list it; the link works.']), ...(k.note ? [k.note] : [])].join('\n'))
}

async function tryCopy($: PublishEngine, text: string): Promise<boolean> {
  try { return (await $.ui.copy(text)) === true } catch { return false }
}

async function detectOs($: PublishEngine): Promise<Os | null> {
  if ((await $.env.os()) === 'Windows_NT') return 'windows'
  try {
    const r = await $.process.run(['uname'])
    return r.stdout.trim() === 'Darwin' ? 'mac' : 'linux'
  } catch {
    return null
  }
}

/** Prints and copies the link; on the CLI also tries to open it (argv only, Dodo hosts only). Silent on failure. */
export async function openDodo($: PublishEngine, url: string, label: string): Promise<string> {
  const shown = clean(url, 300)
  const copied = await tryCopy($, shown)
  // A link that clean had to change is never opened.
  if (shown === url && openableUrl(url)) {
    try {
      const os = await detectOs($)
      if (os) await $.process.run(openArgv(os, url))
    } catch {
      // The link is printed and copied: nothing to add.
    }
  }
  return `Open to ${label}: ${shown}${copied ? '\nThe link is copied.' : ''}`
}

async function dodoLink($: PublishEngine, path: string, key: string, json: unknown, label: string): Promise<Out> {
  const r = await request($, 'POST', path, { key, json })
  if (r.kind !== 'ok') return say(await failure($, r))
  const url = (r.body as { url?: unknown } | null)?.url
  if (typeof url !== 'string') return say('The server sent an unexpected reply.')
  return say(await openDodo($, url, label))
}

export async function subscribe($: PublishEngine, plan: 'yearly' | 'monthly'): Promise<Out> {
  const k = await ensureKey($)
  if (!('key' in k)) return say(await failure($, k as Exclude<Reply, { kind: 'ok' }>))
  return dodoLink($, '/checkout', k.key, { plan }, 'subscribe')
}

export async function portal($: PublishEngine): Promise<Out> {
  const key = await storedKey($)
  if (!key) return say(NO_KEY)
  return dodoLink($, '/portal', key, undefined, 'manage your subscription')
}

export async function unpublish($: PublishEngine, client: string, month: string): Promise<Out> {
  const list = await readReports($)
  const entry = list.find(e => e.client === client && e.month === month)
  if (!entry) return say(`No published report for ${client} ${month} on this machine.`)
  const key = await storedKey($)
  if (!key) return say(NO_KEY)
  const r = await request($, 'DELETE', `/reports/${entry.id}`, { key })
  if (r.kind !== 'ok' && !(r.kind === 'refused' && r.status === 404)) return say(await failure($, r))
  try { await $.store.set('reports', list.filter(e => e !== entry)) } catch {
    return say(`The report ${client} ${month} was deleted on the server (its link now answers 410), but this machine could not update its list, so the pane may still show it.`)
  }
  return say(`Unpublished ${client} ${month}: the link now answers 410.`)
}

const tail = (key: string) => `…${key.slice(-4)}`

export async function keyInfo($: PublishEngine): Promise<Out> {
  const key = await storedKey($)
  if (!key) return say(NO_KEY)
  const r = await request($, 'GET', '/keys/me', { key })
  if (r.kind !== 'ok') return say(await failure($, r))
  const b = (r.body ?? {}) as { status?: unknown; plan?: unknown; freeLeft?: unknown }
  if (typeof b.status !== 'string' || typeof b.plan !== 'string') return say('The server sent an unexpected reply.')
  const left = typeof b.freeLeft === 'number' ? ` · free reports left: ${b.freeLeft}` : ''
  return say(`Key ${tail(key)} · ${clean(b.status, 40)} · ${clean(b.plan, 40)}${left}`)
}

export async function keyShow($: PublishEngine): Promise<Out> {
  const key = await storedKey($)
  if (!key) return say(NO_KEY)
  return say(`Key ${key}\nKeep it private: whoever has it can publish and unpublish as you. Use it with /hourslip key set on another machine.`)
}

export async function keySet($: PublishEngine, key: string): Promise<Out> {
  if (!KEY_RE.test(key)) return say('That is not a hourslip key: it starts with hs_ and has 32 letters and digits after it.')
  const r = await request($, 'GET', '/keys/me', { key })
  if (r.kind !== 'ok') return say(r.kind === 'refused' && r.status === 401 ? 'The server does not know that key. Nothing was changed.' : await failure($, r))
  await $.store.set('key', key)
  return say(`Key ${tail(key)} set. Reports published from another machine stay listed there, not here.`)
}

export async function keyForget($: PublishEngine): Promise<Out> {
  await $.store.delete('key')
  return say('The key is forgotten on this machine. Published links keep working; the next publish creates a new free key.')
}

export { KEY_UNKNOWN }

/** Parent §5.6 step 5: ask the server about reports not yet confirmed. Best effort, at most 20 calls. */
export async function refreshStatuses($: PublishEngine): Promise<PublishedReport[]> {
  const list = await readReports($)
  const key = await storedKey($)
  if (!key) return list
  const pending = list.filter(e => !e.confirmedBy).sort((a, b) => b.month.localeCompare(a.month)).slice(0, 20)
  let changed = false
  for (const e of pending) {
    const r = await request($, 'GET', `/reports/${e.id}/status`, { key })
    // An unreachable or failing server would cost one timeout per report: stop at the first sign of it.
    if (r.kind === 'offline' || (r.kind === 'refused' && (r.status === 0 || r.status >= 500))) break
    const b = r.kind === 'ok' ? (r.body as { approvedAt?: unknown; approvedBy?: unknown } | null) : null
    if (typeof b?.approvedBy === 'string' && typeof b.approvedAt === 'string') {
      const by = clean(b.approvedBy, 100)
      if (by) { e.confirmedBy = by; e.confirmedAt = clean(b.approvedAt, 40); changed = true }
    }
  }
  if (changed) { try { await $.store.set('reports', list) } catch { /* the pane still shows them */ } }
  return list
}
