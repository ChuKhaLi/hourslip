import { describe, expect, test } from 'vitest'
import { KEY_RE, clean, openArgv, openableUrl, parseReports, publishedLines, serverMessage, summaryLines, upsertReport, type PublishedReport } from '../../plugin/hooks/core/publish.ts'
import { SAMPLE_SNAPSHOT } from '../../scripts/site/sample-snapshot.ts'
import { FORBIDDEN } from '../helpers/forbidden.ts'

const r = (o: Partial<PublishedReport> = {}): PublishedReport => ({ id: 'A'.repeat(22), url: 'https://r.hourslip.dev/r/' + 'A'.repeat(22), client: 'acme', month: '2026-10', version: 1, ...o })

const ESC = '\u001b'
const C1 = '\u009b'
const RLO = '\u202e'

describe('clean', () => {
  test('strips C0, DEL, C1 and bidi controls, trims, and caps', () => {
    expect(clean(`${ESC}[2Jhi${C1}there${RLO}`, 50)).toBe('[2Jhithere')
    expect(clean('a\u0000b\u0007c\u007fd\u2066e\u2069f\u202ag', 50)).toBe('abcdefg')
    expect(clean('  spaced  ', 50)).toBe('spaced')
    expect(clean('x'.repeat(10), 10)).toBe('x'.repeat(10))
    expect(clean('x'.repeat(11), 10)).toBe('x'.repeat(10) + '…')
    expect(clean(`${ESC}${C1}`, 5)).toBe('')
  })
  test('parseReports cleans and caps each field, and drops an unsafe id', () => {
    const [e] = parseReports([r({ url: 'https://x/' + 'u'.repeat(400), month: '2026-10' + ESC + 'zzz', confirmedBy: `Jane${ESC}[2J${RLO}`.padEnd(300, 'q'), confirmedAt: '2026-10-07' + C1 })])
    expect(e!.url).toHaveLength(301)
    expect(e!.month).toBe('2026-10zzz'.slice(0, 7) + '…')
    expect(e!.confirmedBy).toHaveLength(101)
    expect(e!.confirmedBy).not.toMatch(/[\u0000-\u001f\u202e]/)
    expect(e!.confirmedAt).toBe('2026-10-07')
    expect(parseReports([r({ id: '../x' }), r({ id: 'a'.repeat(65) }), r({ id: '' }), r({ id: 'Ab_-9' })]).map(x => x.id)).toEqual(['Ab_-9'])
  })
  test('serverMessage cleans and caps the message', () => {
    expect(serverMessage(429, JSON.stringify({ error: { message: `Slow${ESC}[2J down` } }))).toBe('Slow[2J down')
    expect(serverMessage(429, JSON.stringify({ error: { message: 'm'.repeat(600) } }))).toBe('m'.repeat(500) + '…')
    expect(serverMessage(418, JSON.stringify({ error: { message: ESC } }))).toBe('The hourslip server refused the request (HTTP 418).')
  })
})

describe('publish helpers', () => {
  test('parseReports cleans and caps the client, and drops an entry whose client is empty', () => {
    const [e] = parseReports([r({ client: `ac${ESC}[2Jme`.padEnd(100, 'c') })])
    expect(e!.client).not.toMatch(/\u001b/)
    expect(e!.client).toHaveLength(65)
    expect(parseReports([r({ client: `${ESC}${C1}` })])).toEqual([])
  })
  test('parseReports keeps well-formed entries and drops the rest', () => {
    expect(parseReports(undefined)).toEqual([])
    expect(parseReports('x')).toEqual([])
    expect(parseReports([r(), { id: 1 }, null, r({ client: 'beta', confirmedBy: 'Jane', confirmedAt: '2026-10-07T10:00:00.000Z' })])).toEqual([r(), r({ client: 'beta', confirmedBy: 'Jane', confirmedAt: '2026-10-07T10:00:00.000Z' })])
  })
  test('upsertReport keeps one entry per client and month, the higher version', () => {
    const a = upsertReport([r()], r({ id: 'B'.repeat(22), version: 2 }))
    expect(a).toEqual([r({ id: 'B'.repeat(22), version: 2 })])
    expect(upsertReport(a, r({ version: 1 }))).toEqual(a)
    expect(upsertReport(a, r({ month: '2026-09' }))).toHaveLength(2)
  })
  test('publishedLines lists newest month first and never says more than the product does', () => {
    const lines = publishedLines([r({ month: '2026-09' }), r({ client: 'beta', confirmedBy: 'Jane', confirmedAt: '2026-10-07T10:00:00.000Z' })])
    expect(lines).toEqual([
      'Published',
      '  beta 2026-10 v1 · ✓ confirmed by Jane (link holder, unverified)',
      '  acme 2026-09 v1 · not confirmed',
    ])
    expect(publishedLines([])).toEqual([])
    for (const [label, re] of FORBIDDEN) expect(re.test(lines.join('\n')), label).toBe(false)
  })
  test('serverMessage: the server message verbatim, else a sentence (Review Focus 3)', () => {
    expect(serverMessage(402, JSON.stringify({ error: { code: 'payment_required', message: 'Run /hourslip subscribe.' } }))).toBe('Run /hourslip subscribe.')
    expect(serverMessage(502, '<html>Bad gateway</html>')).toBe('The hourslip server had a problem (HTTP 502). Try again in a few minutes.')
    expect(serverMessage(418, '')).toBe('The hourslip server refused the request (HTTP 418).')
  })
  test('openableUrl allows only https Dodo checkout and portal hosts (Review Focus 4)', () => {
    for (const ok of ['https://checkout.dodopayments.com/session/cks_1', 'https://test.checkout.dodopayments.com/session/cks_1', 'https://customer.dodopayments.com/session/x.y-z', 'https://test.customer.dodopayments.com/session/abc?x=1&y=2'])
      expect(openableUrl(ok), ok).toBe(true)
    for (const bad of ['http://checkout.dodopayments.com/s', 'https://checkout.dodopayments.com.evil.test/s', 'https://evil.test/checkout.dodopayments.com', 'https://user@checkout.dodopayments.com/s', 'https://checkout.dodopayments.com:8443/s', 'javascript:alert(1)', 'https://checkout.dodopayments.com/s"&calc', 'https://checkout.dodopayments.com/s x'])
      expect(openableUrl(bad), bad).toBe(false)
  })
  test('openArgv per OS, the URL as one argument', () => {
    const u = 'https://checkout.dodopayments.com/session/cks_1?a=1&b=2'
    expect(openArgv('windows', u)).toEqual(['rundll32', 'url.dll,FileProtocolHandler', u])
    expect(openArgv('mac', u)).toEqual(['open', u])
    expect(openArgv('linux', u)).toEqual(['xdg-open', u])
  })
  test('summaryLines', () => {
    const lines = summaryLines(SAMPLE_SNAPSHOT, ['3 unreadable event lines were skipped.'], '/home/dev/.hourslip/previews/acme-2026-10.html', '/hourslip publish acme 2026-10 --confirm')
    expect(lines[0]).toBe('ACME Corp · 2026-10-01 to 2026-10-31')
    expect(lines).toContain('3 unreadable event lines were skipped.')
    expect(lines).toContain('Preview: /home/dev/.hourslip/previews/acme-2026-10.html')
    expect(lines).toContain('Publish: /hourslip publish acme 2026-10 --confirm')
    expect(lines.at(-1)).toBe('Nothing has been sent yet.')
    expect(lines.some(l => l.startsWith('Invoice ACME-2026-10:'))).toBe(true)
  })
  test('KEY_RE', () => {
    expect(KEY_RE.test('hs_' + 'a1'.repeat(16))).toBe(true)
    expect(KEY_RE.test('hs_short')).toBe(false)
  })
})
