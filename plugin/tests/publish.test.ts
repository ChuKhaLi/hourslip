import { describe, expect, test } from 'claude-code/testing'
import { ensureKey, request, storedKey, KEY_UNKNOWN } from '../hooks/io/server.ts'
import { openDodo, unpublish } from '../hooks/io/publishing.ts'
import { fakeNet, world } from './fixtures/world.ts'

const ESC = '\u001b'
const C1 = '\u009b'
const RLO = '\u202e'
const NASTY = `${ESC}[2J${C1}31m${RLO}`

const KEY = 'hs_' + 'k'.repeat(32)

describe('server client', () => {
  test('request sends JSON with the key and parses the reply', async () => {
    const n = fakeNet({ http: () => ({ status: 201, body: { id: 'x' } }) })
    const r = await request(n.engine, 'POST', '/reports', { key: KEY, json: { a: 1 } })
    expect(r).toEqual({ kind: 'ok', status: 201, body: { id: 'x' } })
    expect(n.fetches[0]).toMatchObject({ method: 'POST', url: 'https://r.hourslip.dev/reports', body: '{"a":1}' })
    expect(n.fetches[0]!.headers).toMatchObject({ authorization: `Bearer ${KEY}`, 'content-type': 'application/json' })
  })
  test('a refusal carries the server message', async () => {
    const n = fakeNet({ http: () => ({ status: 402, body: { error: { code: 'payment_required', message: 'Run /hourslip subscribe.' } } }) })
    expect(await request(n.engine, 'POST', '/reports')).toEqual({ kind: 'refused', status: 402, message: 'Run /hourslip subscribe.' })
  })
  test('a 401 says the key is unknown', async () => {
    const n = fakeNet({ http: () => ({ status: 401, body: {} }) })
    expect(await request(n.engine, 'GET', '/keys/me', { key: KEY })).toEqual({ kind: 'refused', status: 401, message: KEY_UNKNOWN })
  })
  test('a thrown fetch is offline', async () => {
    const n = fakeNet()
    expect(await request(n.engine, 'GET', '/healthz')).toEqual({ kind: 'offline' })
  })
  test('ensureKey creates and stores a key once', async () => {
    const n = fakeNet({ http: () => ({ status: 201, body: { key: KEY } }) })
    expect(await ensureKey(n.engine)).toEqual({ key: KEY, note: null })
    expect(await ensureKey(n.engine)).toEqual({ key: KEY, note: null })
    expect(n.fetches.filter(f => f.url.endsWith('/keys/free'))).toHaveLength(1)
    expect(await storedKey(n.engine)).toBe(KEY)
  })
  test('corrupt key: a new key, and the user is told (Review Focus 2)', async () => {
    const n = fakeNet({ http: () => ({ status: 201, body: { key: KEY } }), store: { key: { not: 'a key' } } })
    const r = await ensureKey(n.engine)
    expect(r).toMatchObject({ key: KEY })
    expect((r as { note: string }).note).toMatch(/could not be read.*no longer be managed/)
  })
  test('a key that cannot be saved is shown in the note so the user can keep it', async () => {
    const n = fakeNet({ http: () => ({ status: 201, body: { key: KEY } }), setThrows: true })
    const r = await ensureKey(n.engine)
    expect(r).toMatchObject({ key: KEY })
    const note = (r as { note: string }).note
    expect(note).toContain(KEY)
    expect(note).toContain('key set')
  })
  test('a malformed reply from /keys/free is refused, not stored', async () => {
    const n = fakeNet({ http: () => ({ status: 201, body: { key: 'nope' } }) })
    expect(await ensureKey(n.engine)).toMatchObject({ kind: 'refused' })
    expect(n.store.has('key')).toBe(false)
  })
  test('HOURSLIP_SERVER overrides the server', async () => {
    const n = fakeNet({ http: () => ({ status: 200, body: {} }), server: 'http://localhost:8790/' })
    await request(n.engine, 'GET', '/healthz')
    expect(n.fetches[0]!.url).toBe('http://localhost:8790/healthz')
  })
  test('a store that throws on get: a new key and the note', async () => {
    const n = fakeNet({ http: () => ({ status: 201, body: { key: KEY } }), storeThrows: true })
    const r = await ensureKey(n.engine)
    expect(r).toMatchObject({ key: KEY })
    expect((r as { note: string }).note).toMatch(/could not be read/)
  })
  test('a non-https, non-localhost server is refused before any fetch', async () => {
    for (const path of ['/reports', '/keys/free']) {
      const n = fakeNet({ http: () => ({ status: 200, body: {} }), server: 'http://evil.test' })
      expect(await request(n.engine, 'POST', path, { key: KEY })).toMatchObject({ kind: 'refused', status: 0, message: expect.stringMatching(/https.*key was not sent/) })
      expect(n.fetches).toHaveLength(0)
    }
  })
  test('http://localhost and https servers are allowed', async () => {
    for (const server of ['http://localhost:8790', 'http://127.0.0.1:8790', 'https://r.hourslip.dev']) {
      const n = fakeNet({ http: () => ({ status: 200, body: {} }), server })
      expect(await request(n.engine, 'GET', '/healthz', { key: KEY })).toMatchObject({ kind: 'ok' })
      expect(n.fetches).toHaveLength(1)
    }
  })
  test('KEY_UNKNOWN names both ways out', () => {
    expect(KEY_UNKNOWN).toMatch(/key set <key>.*key forget/)
  })
})

const RULES = JSON.stringify({ v: 1, tzOffsetMinutes: 420, business: { name: 'Alex Doe', paymentInstructions: 'Wise' }, clients: [{ id: 'acme', name: 'ACME', paths: ['/work/acme/**'], rate: { amount: 40, currency: 'USD' }, ticketPattern: 'ACME-[0-9]+' }] })
const MANUAL = JSON.stringify({ v: 1, date: '2026-10-05', minutes: 90, client: 'acme', ticket: null, note: 'Call' }) + '\n'
const FILES = { '/home/dev/.hourslip/rules.json': RULES, '/home/dev/.hourslip/manual.jsonl': MANUAL }
const run = ($: any, args: string) => $.command.run({ command: 'hourslip', args })
const RID = 'R'.repeat(22)
const server = (o: { reports?: number } = {}) => (method: string, url: string) => {
  if (url.endsWith('/keys/free')) return { status: 201, body: { key: KEY } }
  if (method === 'POST' && url.endsWith('/reports')) return o.reports ? { status: o.reports, body: { error: { code: 'payment_required', message: 'This key has used its 2 free reports. Run /hourslip subscribe to publish more.' } } } : { status: 201, body: { id: RID, url: `https://r.hourslip.dev/r/${RID}`, version: 1 } }
  if (url.endsWith('/checkout')) return { status: 200, body: { url: 'https://checkout.dodopayments.com/session/cks_1?a=1&b=2' } }
  if (url.endsWith('/portal')) return { status: 200, body: { url: 'https://customer.dodopayments.com/session/x' } }
  if (method === 'DELETE') return { status: 204 }
  if (url.endsWith('/keys/me')) return { status: 200, body: { status: 'free', plan: 'free', freeUsed: 1, freeLeft: 1 } }
  if (url.includes('/status')) return { status: 200, body: { approvedAt: '2026-10-07T10:00:00.000Z', approvedBy: 'Jane', supersededBy: null } }
  return { status: 404, body: { error: { code: 'not_found', message: 'nope' } } }
}

describe('/hourslip publish', () => {
  test('publish without --confirm writes the preview and sends nothing', async ($, on) => {
    const w = world(on, { files: FILES, http: server() })
    const out = (await run($, 'publish acme 2026-10')).text
    expect(out).toMatch(/ACME · 2026-10-01 to 2026-10-31/)
    expect(out).toMatch(/Publish: \/hourslip publish acme 2026-10 --confirm/)
    expect(out).toMatch(/Nothing has been sent yet\./)
    expect(w.read('/home/dev/.hourslip/previews/acme-2026-10.html')).toContain('Preview: this is what your client will see.')
    expect(w.fetches).toEqual([])
  })
  test('--confirm creates a key, publishes, remembers the report and copies the link', async ($, on) => {
    const w = world(on, { files: FILES, http: server() })
    const out = (await run($, 'publish acme 2026-10 --confirm')).text
    expect(out).toContain(`Published acme 2026-10 v1: https://r.hourslip.dev/r/${RID}`)
    expect(w.fetches.map(f => `${f.method} ${f.url}`)).toEqual(['POST https://r.hourslip.dev/keys/free', 'POST https://r.hourslip.dev/reports'])
    const sent = JSON.parse(w.fetches[1]!.body!)
    expect(sent).toMatchObject({ v: 1, client: { name: 'ACME' }, period: { from: '2026-10-01', to: '2026-10-31' }, generator: { version: '0.4.0' } })
    expect(w.copies).toEqual([`https://r.hourslip.dev/r/${RID}`])
    expect(w.toasts).toContain('Published acme 2026-10 v1 · link copied')
    // The test-side $ has no store: the entry is proven through unpublish, which only acts on a remembered report.
    expect((await run($, 'unpublish acme 2026-10')).text).toBe('Unpublished acme 2026-10: the link now answers 410. On the free plan, unpublishing does not give back a free report.')
  })
  test('--no-commits sends no commit titles', async ($, on) => {
    const w = world(on, { files: FILES, http: server() })
    await run($, 'publish acme 2026-10 --no-commits --confirm')
    expect(JSON.parse(w.fetches.at(-1)!.body!).showCommits).toBe(false)
    expect(w.runs.filter(a => a[0] === 'git')).toEqual([])
  })
  test('402 shows the server message verbatim', async ($, on) => {
    world(on, { files: FILES, http: server({ reports: 402 }) })
    expect((await run($, 'publish acme 2026-10 --confirm')).text).toBe('This key has used its 2 free reports. Run /hourslip subscribe to publish more.')
  })
  test('offline names the preview', async ($, on) => {
    world(on, { files: FILES })
    expect((await run($, 'publish acme 2026-10 --confirm')).text).toBe('Could not reach https://r.hourslip.dev. Nothing was published; the preview is at /home/dev/.hourslip/previews/acme-2026-10.html.')
  })
  test('nothing to publish (Review Focus 1)', async ($, on) => {
    const w = world(on, { files: { '/home/dev/.hourslip/rules.json': RULES }, http: server() })
    expect((await run($, 'publish acme 2026-09 --confirm')).text).toBe('Nothing recorded for acme in 2026-09: nothing to publish.')
    expect(w.fetches).toEqual([])
  })
  test('unknown client', async ($, on) => {
    world(on, { files: FILES, http: server() })
    expect((await run($, 'publish nope --confirm')).text).toMatch(/Unknown client "nope"/)
  })
})

describe('/hourslip subscribe, portal, unpublish, key', () => {
  test('subscribe prints and copies the checkout link', async ($, on) => {
    const w = world(on, { files: FILES, http: server(), env: { OS: 'Windows_NT' } })
    const out = (await run($, 'subscribe')).text
    const url = 'https://checkout.dodopayments.com/session/cks_1?a=1&b=2'
    expect(out).toBe(`Open to subscribe: ${url}\nThe link is copied.`)
    expect(JSON.parse(w.fetches.at(-1)!.body!)).toEqual({ plan: 'yearly' })
    expect(w.copies).toEqual([url])
    // Whether the kit runs process.run for the plugin is probed in the openDodo tests below.
  })
  test('subscribe --monthly sends the monthly plan; an off-host link is not opened (Review Focus 4)', async ($, on) => {
    const w = world(on, { files: FILES, http: (m, u) => u.endsWith('/checkout') ? { status: 200, body: { url: 'https://checkout.dodopayments.com.evil.test/x' } } : server()(m, u), env: { OS: 'Windows_NT' } })
    await run($, 'subscribe --monthly')
    expect(w.runs.filter(a => a[0] === 'rundll32' || a[0] === 'open' || a[0] === 'xdg-open')).toEqual([])
    expect(JSON.parse(w.fetches.at(-1)!.body!)).toEqual({ plan: 'monthly' })
  })
  test('portal without a key', async ($, on) => {
    const w = world(on, { files: FILES, http: server() })
    expect((await run($, 'portal')).text).toBe('No key yet: one is created on your first publish.')
    expect(w.fetches).toEqual([])
  })
  test('portal with a key prints the portal link', async ($, on) => {
    const w = world(on, { files: FILES, http: server() })
    await run($, `key set ${KEY}`)
    expect((await run($, 'portal')).text).toBe('Open to manage your subscription: https://customer.dodopayments.com/session/x\nThe link is copied.')
    expect(w.fetches.at(-1)).toMatchObject({ method: 'POST', url: 'https://r.hourslip.dev/portal' })
  })
  test('unpublish deletes the remembered report', async ($, on) => {
    const w = world(on, { files: FILES, http: server() })
    await run($, 'publish acme 2026-10 --confirm')
    expect((await run($, 'unpublish acme 2026-10')).text).toBe('Unpublished acme 2026-10: the link now answers 410. On the free plan, unpublishing does not give back a free report.')
    expect(w.fetches.at(-1)).toMatchObject({ method: 'DELETE', url: `https://r.hourslip.dev/reports/${RID}` })
    expect((await run($, 'unpublish acme 2026-10')).text).toBe('No published report for acme 2026-10 on this machine.')
  })
  test('key, key set, key forget', async ($, on) => {
    const w = world(on, { files: FILES, http: server() })
    expect((await run($, 'key')).text).toBe('No key yet: one is created on your first publish.')
    expect((await run($, `key set ${KEY}`)).text).toMatch(/Key …kkkk set\./)
    expect((await run($, 'key')).text).toBe('Key …kkkk · free · free reports left: 1')
    expect((await run($, 'key set hs_bad')).text).toMatch(/not a hourslip key/)
    expect((await run($, 'key forget')).text).toMatch(/forgotten/)
    expect((await run($, 'key')).text).toBe('No key yet: one is created on your first publish.')
    expect(w.fetches.every(f => !f.url.includes('/keys/free'))).toBe(true)
  })
  test('an unexpected throw in a publishing command becomes text', async ($, on) => {
    world(on, { files: FILES, http: server(), failWritePattern: /previews/ })
    const out = (await run($, 'publish acme 2026-10')).text
    expect(typeof out).toBe('string')
    expect(out).not.toMatch(/^hourslip: /)
  })
})

describe('openDodo', () => {
  const engine = (os: string | undefined, uname = 'Linux\n') => {
    const runs: string[][] = []
    const copies: string[] = []
    const e = {
      env: { os: async () => os },
      process: { run: async (argv: readonly string[]) => { runs.push([...argv]); return { exitCode: 0, stdout: uname, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } },
      ui: { copy: async (t: string) => { copies.push(t); return true } },
    } as never
    return { e, runs, copies }
  }
  const URL_ = 'https://checkout.dodopayments.com/session/cks_1?a=1&b=2'
  test('Windows opens through rundll32 with the URL as one argv element', async () => {
    const { e, runs, copies } = engine('Windows_NT')
    expect(await openDodo(e, URL_, 'subscribe')).toBe(`Open to subscribe: ${URL_}\nThe link is copied.`)
    expect(runs).toEqual([['rundll32', 'url.dll,FileProtocolHandler', URL_]])
    expect(copies).toEqual([URL_])
  })
  test('elsewhere uname picks open or xdg-open', async () => {
    const mac = engine(undefined, 'Darwin\n')
    await openDodo(mac.e, URL_, 'subscribe')
    expect(mac.runs).toEqual([['uname'], ['open', URL_]])
    const linux = engine(undefined)
    await openDodo(linux.e, URL_, 'subscribe')
    expect(linux.runs).toEqual([['uname'], ['xdg-open', URL_]])
  })
  test('a non-Dodo URL is copied and printed but never opened', async () => {
    const { e, runs, copies } = engine('Windows_NT')
    await openDodo(e, 'https://checkout.dodopayments.com.evil.test/x', 'subscribe')
    expect(runs).toEqual([])
    expect(copies).toHaveLength(1)
  })
  test('a failing opener is silent', async () => {
    const e = { env: { os: async () => 'Windows_NT' }, process: { run: async () => { throw new Error('no') } }, ui: { copy: async () => true } } as never
    expect(await openDodo(e, URL_, 'subscribe')).toContain('The link is copied.')
  })
})

describe('fix round 1', () => {
  const OTHER = 'hs_' + 'o'.repeat(32)
  test('subscribe opens the Dodo link through rundll32 in the kit', async ($, on) => {
    const w = world(on, { files: FILES, http: server(), env: { OS: 'Windows_NT' } })
    await run($, 'subscribe')
    expect(w.runs).toContainEqual(['rundll32', 'url.dll,FileProtocolHandler', 'https://checkout.dodopayments.com/session/cks_1?a=1&b=2'])
  })
  test('publish: a failing clipboard still prints the link and does not claim it was copied', async ($, on) => {
    const w = world(on, { files: FILES, http: server(), copyThrows: true })
    const out = (await run($, 'publish acme 2026-10 --confirm')).text
    expect(out).toContain(`https://r.hourslip.dev/r/${RID}`)
    expect(out).not.toMatch(/copied/)
    expect(w.copies).toEqual([])
  })
  test('openDodo: a failing clipboard still prints the link and does not claim it was copied', async () => {
    const e = { env: { os: async () => undefined }, process: { run: async () => { throw new Error('x') } }, ui: { copy: async () => { throw new Error('no clipboard') } } } as never
    const out = await openDodo(e, 'https://checkout.dodopayments.com/session/cks_1', 'subscribe')
    expect(out).toBe('Open to subscribe: https://checkout.dodopayments.com/session/cks_1')
  })
  test('unpublish: a 404 from the server still forgets the entry', async ($, on) => {
    world(on, { files: FILES, http: (m, u, b, h) => m === 'DELETE' ? { status: 404, body: { error: { code: 'not_found', message: 'gone' } } } : server()(m, u) })
    await run($, 'publish acme 2026-10 --confirm')
    expect((await run($, 'unpublish acme 2026-10')).text).toBe('Unpublished acme 2026-10: the link now answers 410. On the free plan, unpublishing does not give back a free report.')
    expect((await run($, 'unpublish acme 2026-10')).text).toBe('No published report for acme 2026-10 on this machine.')
  })
  test('key set: a key the server does not know changes nothing', async ($, on) => {
    world(on, { files: FILES, http: (m, u, b, h) => (h.authorization ?? '').includes(OTHER) ? { status: 401, body: {} } : server()(m, u) })
    await run($, `key set ${KEY}`)
    expect((await run($, `key set ${OTHER}`)).text).toBe('The server does not know that key. Nothing was changed.')
    expect((await run($, 'key')).text).toMatch(/^Key …kkkk /)
  })
  test('publish: a 401 shows KEY_UNKNOWN', async ($, on) => {
    world(on, { files: FILES, http: (m, u) => m === 'POST' && u.endsWith('/reports') ? { status: 401, body: {} } : server()(m, u) })
    expect((await run($, 'publish acme 2026-10 --confirm')).text).toBe(KEY_UNKNOWN)
  })
  test('publish: a 429 shows the server message verbatim', async ($, on) => {
    world(on, { files: FILES, http: (m, u) => m === 'POST' && u.endsWith('/reports') ? { status: 429, body: { error: { code: 'rate_limited', message: 'Slow down: try again in 60 seconds.' } } } : server()(m, u) })
    expect((await run($, 'publish acme 2026-10 --confirm')).text).toBe('Slow down: try again in 60 seconds.')
  })
})

describe('reports store failure', () => {
  test('publish still prints the link and says the report was not remembered', async ($, on) => {
    world(on, { files: FILES, http: server(), reportsStoreThrows: true })
    const out = (await run($, 'publish acme 2026-10 --confirm')).text
    expect(out).toContain(`https://r.hourslip.dev/r/${RID}`)
    expect(out).toContain('This machine could not remember the report, so /hourslip unpublish and the pane will not list it; the link works.')
  })
})

describe('pane', () => {
  test('the pane lists published reports and fetches status only for unconfirmed ones', async ($, on) => {
    const w = world(on, { files: FILES, http: server() })
    await run($, 'publish acme 2026-10 --confirm')
    const n = w.fetches.length
    const out = (await run($, '')).text
    expect(out).toContain('Published')
    expect(out).toContain('  acme 2026-10 v1 · ✓ confirmed by Jane (link holder, unverified)')
    expect(w.fetches.slice(n).map(f => f.url)).toEqual([`https://r.hourslip.dev/reports/${RID}/status`])
    await run($, '')
    expect(w.fetches.length).toBe(n + 1)
  })
  test('status refresh is bounded and survives failures (Review Focus 5)', async ($, on) => {
    const reports = Array.from({ length: 30 }, (_, i) => ({ id: String(i).padStart(22, 'x'), url: 'u', client: 'acme', month: `20${String(10 + Math.floor(i / 12)).padStart(2, '0')}-${String((i % 12) + 1).padStart(2, '0')}`, version: 1 }))
    const w = world(on, { files: FILES, http: (m, u) => (u.includes('/status') ? { status: 404, text: '<html>' } : server()(m, u)), storeSeed: { key: KEY, reports } })
    const out = (await run($, '')).text
    expect(w.fetches.filter(f => f.url.includes('/status'))).toHaveLength(20)
    expect(out.split('\n').filter((l: string) => l.endsWith('· not confirmed'))).toHaveLength(30)
  })
})

describe('output injection', () => {
  const noNasty = (out: string) => {
    expect(out).not.toContain(ESC)
    expect(out).not.toContain(C1)
    expect(out).not.toContain(RLO)
  }
  test('confirmedBy from the status reply never reaches the pane or the store raw', async ($, on) => {
    const reports = [{ id: RID, url: 'u', client: 'acme', month: '2026-10', version: 1 }]
    const w = world(on, { files: FILES, http: (m, u) => (u.includes('/status') ? { status: 200, body: { approvedAt: '2026-10-07T10:00:00.000Z', approvedBy: `Jane${NASTY}Doe` } } : server()(m, u)), storeSeed: { key: KEY, reports } })
    const out = (await run($, '')).text
    noNasty(out)
    expect(out).toContain('confirmed by Jane[2J31mDoe')
    noNasty(JSON.stringify(w.fetches))
  })
  test('confirmedBy longer than 100 characters is cut', async ($, on) => {
    const reports = [{ id: RID, url: 'u', client: 'acme', month: '2026-10', version: 1 }]
    world(on, { files: FILES, http: (m, u) => (u.includes('/status') ? { status: 200, body: { approvedAt: '2026-10-07T10:00:00.000Z', approvedBy: 'J'.repeat(500) } } : server()(m, u)), storeSeed: { key: KEY, reports } })
    const out = (await run($, '')).text
    expect(out).toContain(`confirmed by ${'J'.repeat(100)}… (link holder`)
  })
  test('a server message is cleaned', async ($, on) => {
    world(on, { files: FILES, http: (m, u) => (m === 'POST' && u.endsWith('/reports') ? { status: 429, body: { error: { code: 'rate_limited', message: `Slow${NASTY} down` } } } : server()(m, u)) })
    const out = (await run($, 'publish acme 2026-10 --confirm')).text
    noNasty(out)
    expect(out).toBe('Slow[2J31m down')
  })
  test('the published url is cleaned before it is printed, copied or stored', async ($, on) => {
    const w = world(on, { files: FILES, http: (m, u) => (m === 'POST' && u.endsWith('/reports') ? { status: 201, body: { id: RID, url: `https://r.hourslip.dev/r/${RID}${NASTY}`, version: 1 } } : server()(m, u)) })
    const out = (await run($, 'publish acme 2026-10 --confirm')).text
    noNasty(out)
    noNasty(w.copies.join(''))
  })
  test('a Dodo url that clean changes is printed cleaned and never opened', async ($, on) => {
    const w = world(on, { files: FILES, env: { OS: 'Windows_NT' }, http: (m, u) => (u.endsWith('/checkout') ? { status: 200, body: { url: `https://checkout.dodopayments.com/session/cks_1${NASTY}` } } : server()(m, u)) })
    const out = (await run($, 'subscribe')).text
    noNasty(out)
    expect(w.runs.filter(a => a[0] === 'rundll32')).toEqual([])
  })
  test('key status and plan are cleaned and capped', async ($, on) => {
    world(on, { files: FILES, http: (m, u) => (u.endsWith('/keys/me') ? { status: 200, body: { status: `active${NASTY}`, plan: 'p'.repeat(100), freeLeft: null } } : server()(m, u)) })
    await run($, `key set ${KEY}`)
    const out = (await run($, 'key')).text
    noNasty(out)
    expect(out).toBe(`Key …kkkk · active[2J31m · ${'p'.repeat(40)}…`)
  })
  test('keyInfo with an empty 200 body prints text, not a TypeError', async ($, on) => {
    world(on, { files: FILES, http: (m, u) => (u.endsWith('/keys/me') ? { status: 200 } : server()(m, u)) })
    await run($, `key set ${KEY}`)
    expect((await run($, 'key')).text).toBe('The server sent an unexpected reply.')
  })
  test('a report id that is not URL-safe is an unexpected reply', async ($, on) => {
    const w = world(on, { files: FILES, http: (m, u) => (m === 'POST' && u.endsWith('/reports') ? { status: 201, body: { id: '../../keys', url: 'https://r.hourslip.dev/r/x', version: 1 } } : server()(m, u)) })
    expect((await run($, 'publish acme 2026-10 --confirm')).text).toMatch(/unexpected reply/)
    expect(w.copies).toEqual([])
  })
  test('a stored report with an unsafe id is dropped from the pane', async ($, on) => {
    const reports = [{ id: '../x', url: 'u', client: 'acme', month: '2026-10', version: 1 }]
    const w = world(on, { files: FILES, http: server(), storeSeed: { key: KEY, reports } })
    expect((await run($, '')).text).not.toContain('Published')
    expect(w.fetches.filter(f => f.url.includes('/status'))).toEqual([])
  })
})

describe('final fix wave', () => {
  test('a clipboard that refuses: publish and subscribe print the link and do not say copied', async ($, on) => {
    const w = world(on, { files: FILES, http: server(), copyRefused: true })
    const out = (await run($, 'publish acme 2026-10 --confirm')).text
    expect(out).toContain(`https://r.hourslip.dev/r/${RID}`)
    expect(out).not.toMatch(/copied/)
    expect(w.toasts.join('\n')).not.toMatch(/link copied/)
    const sub = (await run($, 'subscribe')).text
    expect(sub).toContain('https://checkout.dodopayments.com/session/cks_1?a=1&b=2')
    expect(sub).not.toMatch(/copied/)
  })
  test('the pane stops at the first offline reply', async ($, on) => {
    const reports = Array.from({ length: 30 }, (_, i) => ({ id: String(i).padStart(22, 'x'), url: 'u', client: 'acme', month: `2026-${String((i % 12) + 1).padStart(2, '0')}`, version: 1 }))
    const w = world(on, { files: FILES, storeSeed: { key: KEY, reports } })
    const out = (await run($, '')).text
    expect(w.fetches).toHaveLength(1)
    expect(out).toContain('Week of')
    expect(w.panes).toContain('hourslip-week')
  })
  test('the pane stops at the first 5xx', async ($, on) => {
    const reports = Array.from({ length: 5 }, (_, i) => ({ id: String(i).padStart(22, 'x'), url: 'u', client: 'acme', month: `2026-0${i + 1}`, version: 1 }))
    const w = world(on, { files: FILES, http: () => ({ status: 503, text: 'x' }), storeSeed: { key: KEY, reports } })
    await run($, '')
    expect(w.fetches).toHaveLength(1)
  })
  test('key show prints the full key with a warning', async ($, on) => {
    world(on, { files: FILES, http: server() })
    expect((await run($, 'key show')).text).toBe('No key yet: one is created on your first publish.')
    await run($, `key set ${KEY}`)
    const out = (await run($, 'key show')).text
    expect(out).toContain(KEY)
    expect(out).toContain('Keep it private: whoever has it can publish and unpublish as you. Use it with /hourslip key set on another machine.')
  })
  test('flag strictness reaches the user as an error', async ($, on) => {
    const w = world(on, { files: FILES, http: server() })
    expect((await run($, 'subscribe --yearly')).text).toBe('Usage: /hourslip subscribe [--monthly]')
    expect((await run($, 'portal --x')).text).toMatch(/^Usage: \/hourslip portal/)
    expect(w.fetches).toEqual([])
  })
})

describe('store failures mid-command', () => {
  const failingSets = (n: { sets: number }, real: ReturnType<typeof fakeNet>['engine']['store']) => ({ ...real, set: async (k: string, v: unknown) => { n.sets++; throw new Error('disk full') } })
  test('ensureKey: a store.set that throws still returns the key and says so', async () => {
    const n = fakeNet({ http: () => ({ status: 201, body: { key: KEY } }) })
    const e = { ...n.engine, store: failingSets({ sets: 0 }, n.engine.store) }
    const r = await ensureKey(e)
    expect(r).toMatchObject({ key: KEY })
    expect((r as { note: string }).note).toMatch(/could not be saved/)
  })
  test('unpublish: a store.set that throws after the DELETE says the server deleted it', async () => {
    const reports = [{ id: RID, url: 'u', client: 'acme', month: '2026-10', version: 1 }]
    const n = fakeNet({ http: server(), store: { key: KEY, reports } })
    const e = { ...n.engine, store: { ...n.engine.store, set: async () => { throw new Error('disk full') } } } as never
    const out = (await unpublish(e, 'acme', '2026-10')).text
    expect(out).toMatch(/deleted on the server/)
    expect(out).toMatch(/could not update its list/)
  })
})
