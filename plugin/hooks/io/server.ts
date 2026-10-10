import { KEY_RE, serverMessage } from '../core/publish.ts'
import type { ServerEngine } from './paths.ts'

export const DEFAULT_SERVER = 'https://r.hourslip.dev'
export const KEY_UNKNOWN = 'This key is not known to the server. Run /hourslip key set <key>, or /hourslip key forget to start a new one.'

export type Reply = { kind: 'ok'; status: number; body: any } | { kind: 'offline' } | { kind: 'refused'; status: number; message: string }

export async function serverUrl(engine: ServerEngine): Promise<string> {
  return ((await engine.env.server()) || DEFAULT_SERVER).replace(/\/+$/, '')
}

/** https anywhere, or plain http only to this machine: the Bearer key never travels in the clear to another host. */
function trustedServer(server: string): boolean {
  try {
    const u = new URL(server)
    return u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'))
  } catch { return false }
}

export const offlineText = (server: string, previewPath?: string) =>
  previewPath ? `Could not reach ${server}. Nothing was published; the preview is at ${previewPath}.` : `Could not reach ${server}.`

export async function request(engine: ServerEngine, method: string, path: string, o: { key?: string; json?: unknown } = {}): Promise<Reply> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (o.key) headers.authorization = `Bearer ${o.key}`
  if (o.json !== undefined) headers['content-type'] = 'application/json'
  const server = await serverUrl(engine)
  if (!trustedServer(server)) return { kind: 'refused', status: 0, message: 'HOURSLIP_SERVER must be an https:// address (or http://localhost for tests). The key was not sent.' }
  let res
  try {
    res = await engine.http.fetch(`${server}${path}`, { method, headers, body: o.json === undefined ? undefined : JSON.stringify(o.json) })
  } catch {
    return { kind: 'offline' }
  }
  if (!res.ok) return { kind: 'refused', status: res.status, message: res.status === 401 ? KEY_UNKNOWN : serverMessage(res.status, res.text) }
  let body: unknown = null
  try { body = res.text ? JSON.parse(res.text) : null } catch { body = null }
  return { kind: 'ok', status: res.status, body }
}

const UNREADABLE = Symbol('unreadable')

async function readKey(engine: ServerEngine): Promise<unknown> {
  try { return await engine.store.get('key') } catch { return UNREADABLE }
}

export async function storedKey(engine: ServerEngine): Promise<string | null> {
  const k = await readKey(engine)
  return typeof k === 'string' && KEY_RE.test(k) ? k : null
}

/** The stored key, or a new free key (parent §5.6 step 3). A malformed stored key is replaced and the user told. */
export async function ensureKey(engine: ServerEngine): Promise<{ key: string; note: string | null } | Reply> {
  const raw = await readKey(engine)
  if (typeof raw === 'string' && KEY_RE.test(raw)) return { key: raw, note: null }
  const r = await request(engine, 'POST', '/keys/free')
  if (r.kind !== 'ok') return r
  const key = (r.body as { key?: unknown } | null)?.key
  if (typeof key !== 'string' || !KEY_RE.test(key)) return { kind: 'refused', status: r.status, message: 'The server sent an unexpected reply. Nothing was published.' }
  const notes: string[] = []
  if (raw !== undefined && raw !== null) notes.push('The stored key could not be read, so a new key was created. Reports published with the old key stay online but can no longer be managed from here.')
  // The key exists on the server now: use it for this command even if this machine cannot keep it.
  try { await engine.store.set('key', key) } catch { notes.push(`This key could not be saved on this machine: ${key}. Keep it private; run /hourslip key set ${key} once the store works, or the next command creates another free key.`) }
  return { key, note: notes.length ? notes.join('\n') : null }
}
