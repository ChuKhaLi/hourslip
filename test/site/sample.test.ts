import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { CONFIRM_NOTE, HONESTY_LINE } from '../../plugin/hooks/core/report.ts'
import { SAMPLE_SNAPSHOT as S } from '../../scripts/site/sample-snapshot.ts'
import { SITE, sampleHtml, styleHash, withSampleHeaders } from '../../scripts/build-site.mjs'

// The working copy may hold CRLF (core.autocrlf); the committed files and Cloudflare's checkout hold LF.
const lf = (s: string) => s.replace(/\r\n/g, '\n')
const read = (rel: string) => lf(readFileSync(join(SITE, rel), 'utf8'))
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

describe('sample report', () => {
  test('the sample snapshot adds up', () => {
    expect(sum(S.days.map(d => d.presenceMinutes))).toBe(S.totals.presenceMinutes)
    expect(sum(S.tickets.map(t => t.presenceMinutes))).toBe(S.totals.presenceMinutes)
    expect(sum(S.days.map(d => d.claudeMinutes))).toBe(S.totals.claudeMinutes)
    expect(sum(S.tickets.map(t => t.claudeMinutes))).toBe(S.totals.claudeMinutes)
    expect(sum(S.manual.map(m => m.minutes))).toBe(S.totals.manualMinutes)
    const inv = S.invoice!
    expect(inv.billableMinutes).toBe(S.totals.presenceMinutes + S.totals.manualMinutes)
    expect(inv.amountCents).toBe(Math.floor((inv.rateCents * inv.billableMinutes + 30) / 60))
  })
  test('site/sample.html is what the build writes now (run pnpm site:build after changing the report)', () => {
    expect(read('sample.html')).toBe(sampleHtml())
  })
  test('site/_headers carries the hash of the sample style, so the CSP lets it apply', () => {
    const headers = read('_headers')
    expect(withSampleHeaders(headers, styleHash(sampleHtml()))).toBe(headers)
    expect(headers).toContain(`style-src '${styleHash(sampleHtml())}'`)
  })
  test('the sample shows the honesty line, the confirm note, the numbers the landing quotes, and escapes values', () => {
    const html = sampleHtml()
    expect(html).toContain(HONESTY_LINE)
    expect(html).toContain(CONFIRM_NOTE)
    for (const s of ['Billable 39h10', 'measured 37h40', 'added by hand 1h30', '14h05', '12h11', '8h32', '1566.67 USD']) expect(html).toContain(s)
    // Review Focus 5
    expect(html).toContain('CSV export &amp; totals')
    expect(html).not.toContain('export & totals')
  })
  test('the global headers keep the strict CSP and only /sample replaces it', () => {
    const headers = read('_headers')
    expect(headers).toMatch(/^\/\*\n {2}Content-Security-Policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'$/m)
    expect(headers).toMatch(/^\/sample\n {2}! Content-Security-Policy$/m)
  })
})
