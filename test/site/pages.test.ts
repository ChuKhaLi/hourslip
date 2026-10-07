import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { HONESTY_LINE } from '../../plugin/hooks/core/report.ts'
import { SITE } from '../../scripts/build-site.mjs'
import { PAGES, read } from './pages.ts'

const between = (html: string, a: string, b: string) => html.slice(html.indexOf(a), html.indexOf(b) + b.length)

test('no page runs script or carries inline style', () => {
  for (const p of PAGES) {
    const html = read(p)
    expect(html, p).not.toMatch(/<script|<style|\sstyle=|\son[a-z]+=/i)
  }
})
test('every page shares the header and the footer of index.html', () => {
  const head = between(read('index.html'), '<header class="site">', '</header>')
  const foot = between(read('index.html'), '<footer class="site">', '</footer>')
  for (const p of PAGES) {
    expect(between(read(p), '<header class="site">', '</header>'), p).toBe(head)
    expect(between(read(p), '<footer class="site">', '</footer>'), p).toBe(foot)
  }
})
test('every page links the stylesheet and carries the support address as text and link', () => {
  for (const p of PAGES) {
    const html = read(p)
    expect(html, p).toContain('<link rel="stylesheet" href="/style.v1.css">')
    expect(html, p).toContain('<a href="mailto:support@hourslip.dev">support@hourslip.dev</a>')
    expect(html, p).toContain('<!--email_off-->')
  }
})
test('every internal link and asset resolves to a file in site/', () => {
  const target = (href: string) => {
    const path = href.split('#')[0].split('?')[0]
    if (path === '/' || path === '') return 'index.html'
    if (/\.[a-z0-9]+$/i.test(path)) return path.slice(1)
    return `${path.slice(1)}.html`
  }
  for (const p of PAGES) {
    for (const m of read(p).matchAll(/(?:href|src)="(\/[^"]*)"/g)) {
      expect(existsSync(join(SITE, target(m[1]))), `${p}: ${m[1]}`).toBe(true)
    }
    for (const m of read(p).matchAll(/href="\/#([\w-]+)"/g)) expect(read('index.html'), `${p}: #${m[1]}`).toContain(`id="${m[1]}"`)
  }
})
test('the landing carries the honesty line, the install commands, what is never recorded, and the sample numbers', () => {
  const html = read('index.html')
  expect(html).toContain(HONESTY_LINE)
  expect(html).toContain('claude plugin marketplace add ChuKhaLi/hourslip')
  expect(html).toContain('claude plugin install hourslip@hourslip')
  expect(html).toContain('Never your prompts, never file contents.')
  expect(html).toContain('⏱ ACME · ACME-182 · 2h14 today')
  for (const s of ['39h10', '14h05', '12h11', '8h32']) expect(read('sample.html')).toContain(s)
  for (const s of ['39h10', '14h05', '12h11', '8h32']) expect(html).toContain(s)
})
test('pricing: $72 a year preselected wording, $8 monthly, local currency note, Pro coming soon (until C3)', () => {
  const html = read('index.html')
  for (const s of ['$72 a year', '$8 billed monthly', 'Charged in your local currency where available; a conversion fee may apply.', 'Pro is coming soon.', '/hourslip subscribe']) {
    expect(html, s).toContain(s)
  }
})

const NOINDEX = ['404.html', 'thanks.html']

test('"Unlimited" is fair use with the server\'s caps written out, and the price says tax comes on top', () => {
  const html = read('index.html')
  expect(html).toContain('<li>Unlimited reports, fair use</li>')
  expect(html).toContain('Prices exclude sales tax and VAT, which are added at checkout where they apply.')
  const terms = read('terms.html')
  for (const s of ['Unlimited reports means fair use', '50 publishes a day', '20 versions of one client and month', '100 MB of stored reports']) {
    expect(terms, s).toContain(s)
  }
})
test('legal pages carry the date and the facts the spec fixes', () => {
  const updated: Record<string, string> = { 'terms.html': '6 October 2026', 'privacy.html': '7 October 2026', 'refunds.html': '5 October 2026' }
  for (const [p, d] of Object.entries(updated)) expect(read(p), p).toContain(`Last updated: ${d}`)
  const terms = read('terms.html')
  for (const s of ['ChuKhaLi, an individual developer', 'Dodo Payments is the merchant of record', 'FSL-1.1-MIT', 'laws of Vietnam', 'stays online for 2 years']) expect(terms, s).toContain(s)
  const privacy = read('privacy.html')
  for (const s of ["Your IP address is used in memory by hourslip's server to limit free keys, and hourslip's server never stores it.",
    "hourslip.dev is served by Cloudflare, which processes visitors' IP addresses to deliver the site.",
    'hosting provider in Singapore', 'kept for 30 days', 'transferred outside it', 'never records prompt text or file contents',
    '/hourslip unpublish', 'within 30 days', 'sets no cookies, runs no analytics', 'Report links (r.hourslip.dev) are served through Cloudflare',
    'with your email address and its subscription and payment ids in the page address']) expect(privacy, s).toContain(s)
  const refunds = read('refunds.html')
  for (const s of ['within 14 days of your first payment', 'each yearly renewal', 'Monthly renewals are not refunded']) expect(refunds, s).toContain(s)
  expect(read('contact.html')).toContain('within 2 business days')
})
test('noindex pages say so and stay out of the sitemap; every other page is in it', () => {
  const sitemap = read('sitemap.xml')
  for (const p of PAGES) {
    const path = p === 'index.html' ? '/' : `/${p.replace(/\.html$/, '')}`
    const listed = sitemap.includes(`<loc>https://hourslip.dev${path}</loc>`)
    if (NOINDEX.includes(p)) {
      expect(read(p), p).toContain('<meta name="robots" content="noindex">')
      expect(listed, p).toBe(false)
    } else expect(listed, p).toBe(true)
  }
  expect(read('robots.txt')).toContain('Sitemap: https://hourslip.dev/sitemap.xml')
})
test('llms.txt describes the product without promising more than the site', () => {
  const t = read('llms.txt')
  expect(t).toMatch(/^# hourslip\n/)
  expect(t).toContain('lower bound')
  expect(t).toContain('does not verify who confirms')
})
test('og.png is a 1200×630 PNG and og.html is kept off the deploy', () => {
  const png = readFileSync(join(SITE, 'og.png'))
  expect(png.subarray(1, 4).toString('latin1')).toBe('PNG')
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630])
  expect(read('.assetsignore')).toContain('og.html')
})
test('the landing names a client in the export that writes the printable report (export without one writes CSV only)', () => {
  expect(read('index.html')).toContain('<code>/hourslip export acme</code> writes CSV files and a report you can print to PDF')
})
test("refunds promise the plan's price, not a full refund the conversion fee would contradict", () => {
  const html = read('refunds.html')
  expect(html).toContain('the conversion fee is not refunded')
  expect(html).not.toMatch(/full refund\b(?! of the plan's price)/i)
})
