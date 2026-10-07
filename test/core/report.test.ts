import { describe, expect, test } from 'vitest'
import { CONFIRM_NOTE, HONESTY_LINE, escapeHtml, renderReport } from '../../plugin/hooks/core/report.ts'
import { contrast, styleOf, themes } from '../helpers/css.ts'
import type { Snapshot } from '../../plugin/hooks/core/snapshot.ts'

const evil = '<script>alert(1)</script>"\'&'
const snap: Snapshot = {
  v: 1, business: { name: evil, paymentInstructions: evil }, client: { name: evil },
  period: { from: '2026-10-01', to: '2026-10-31' },
  totals: { presenceMinutes: 61, claudeMinutes: 20, manualMinutes: 30 },
  days: [{ date: '2026-10-05', presenceMinutes: 61, claudeMinutes: 20, manualMinutes: 30, overlap: true, capped: false }],
  tickets: [{ ticket: evil, presenceMinutes: 61, claudeMinutes: 20, branches: [evil], commits: [evil] }],
  manual: [{ date: '2026-10-05', minutes: 30, note: evil, ticket: null }],
  invoice: { number: 'ACME-2026-10', currency: 'USD', rateCents: 4000, billableMinutes: 91, amountCents: 6067, dueDate: '2026-11-15' },
  showCommits: true, generator: { name: 'hourslip', version: '0.1.0' },
}

describe('report', () => {
  test('escapeHtml', () => {
    expect(escapeHtml(evil)).toBe('&lt;script&gt;alert(1)&lt;/script&gt;&quot;&#39;&amp;')
  })
  test('every user field renders inert', () => {
    const html = renderReport(snap)
    expect(html).not.toContain('<script>')
    expect(html.split('&lt;script&gt;').length - 1).toBe(8)
  })
  test('a banner may carry several escaped notes', () => {
    const html = renderReport(snap, { banner: ['Preview: x', '3 <b>lines</b> skipped'] })
    expect(html).toContain('Preview: x')
    expect(html).toContain('3 &lt;b&gt;lines&lt;/b&gt; skipped')
  })
  test('carries the honesty line, the footer, totals, the invoice amount and manual labels', () => {
    const html = renderReport(snap)
    expect(html).toContain(HONESTY_LINE)
    expect(html).toContain('Made with hourslip')
    expect(html).toContain('1h31')
    expect(html).toContain('60.67 USD')
    expect(html).toContain('added by hand')
    expect(html).toContain('<!doctype html>')
  })
  test('the period line names the business only when there is one', () => {
    const named = renderReport({ ...snap, business: { name: 'Alex Doe', paymentInstructions: '' } })
    expect(named).toContain('<div class="muted">Alex Doe · 2026-10-01 to 2026-10-31</div>')
    const unnamed = renderReport({ ...snap, business: { name: '', paymentInstructions: '' } })
    expect(unnamed).toContain('<div class="muted">2026-10-01 to 2026-10-31</div>')
  })
  test('Ledger tokens: light, dark from the system, and a light print set', () => {
    const t = themes(styleOf(renderReport(snap)))
    const names = ['--paper', '--sheet', '--ink', '--muted', '--rule', '--accent', '--warn']
    for (const theme of [t.light, t.dark, t.print]) for (const n of names) expect(theme.has(n), n).toBe(true)
    expect(t.light.get('--paper')).toBe('#f6f1e7')
    expect(t.dark.get('--paper')).toBe('#1a1712')
    // Review Focus 1: printing from a dark system gives white paper and black ink.
    expect(t.print.get('--paper')).toBe('#ffffff')
    expect(t.print.get('--ink')).toBe('#000000')
  })
  test('every text colour clears 4.5:1 on paper and on the sheet, in light and dark', () => {
    const t = themes(styleOf(renderReport(snap)))
    for (const theme of [t.light, t.dark]) {
      for (const fg of ['--ink', '--muted', '--accent', '--warn']) {
        for (const bg of ['--paper', '--sheet']) {
          const c = contrast(theme.get(fg)!, theme.get(bg)!)
          expect(c, `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })
  test('table cells wrap long unbroken values (Review Focus 2)', () => {
    expect(styleOf(renderReport(snap))).toMatch(/td,th\{[^}]*overflow-wrap:anywhere/)
  })
  test('everything on the sheet wraps long unbroken values, not only table cells (a payment URL in the instructions)', () => {
    expect(styleOf(renderReport(snap))).toMatch(/main\{[^}]*overflow-wrap:anywhere/)
  })
  test('the inline style loads nothing: no url(), no @import (the server allows one hashed style only)', () => {
    expect(styleOf(renderReport(snap))).not.toMatch(/url\(|@import/)
  })
  test('the footer links home with the words "Made with hourslip"', () => {
    expect(renderReport(snap)).toContain('<a href="https://hourslip.dev/">Made with hourslip</a>')
  })
  test('a sample confirm block shows the button and the unverified note; without it, neither', () => {
    const html = renderReport(snap, { confirm: { kind: 'sample' } })
    expect(html).toContain('Confirm these hours')
    expect(html).toContain(CONFIRM_NOTE)
    expect(CONFIRM_NOTE).toBe('hourslip does not verify who confirms: anyone with this link can.')
    expect(renderReport(snap)).not.toContain(CONFIRM_NOTE)
  })
  test('an optional banner renders escaped at the top', () => {
    expect(renderReport(snap, { banner: '<b>Preview</b>' })).toContain('&lt;b&gt;Preview&lt;/b&gt;')
  })
  test('the live form posts the name to the given action, with the note beside it', () => {
    const html = renderReport(snap, { confirm: { kind: 'form', action: '/r/abc/approve' } })
    expect(html).toContain('<form method="post" action="/r/abc/approve">')
    expect(html).toContain('name="name"')
    expect(html).toContain('maxlength="100"')
    expect(html).toContain(CONFIRM_NOTE)
    expect(html).not.toContain('<script')
  })
  test('the confirmed state names the link holder, escaped, with the note beside it', () => {
    const html = renderReport(snap, { confirm: { kind: 'confirmed', name: evil, at: '2026-10-07 14:03 UTC' } })
    expect(html).toContain('Confirmed by &lt;script&gt;')
    expect(html).toContain('(link holder) at 2026-10-07 14:03 UTC')
    expect(html).toContain(CONFIRM_NOTE)
    expect(html).not.toContain('<form')
  })
  test('an older version links to the newest one', () => {
    const html = renderReport(snap, { newer: 'https://r.hourslip.dev/r/"x' })
    expect(html).toContain('A newer version of this report exists.')
    expect(html).toContain('href="https://r.hourslip.dev/r/&quot;x"')
  })
  test('without confirm there is no confirm section', () => {
    expect(renderReport(snap)).not.toContain('class="confirm"')
  })
})
