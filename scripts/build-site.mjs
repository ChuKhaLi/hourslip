// Writes site/sample.html from core.renderReport and the sample snapshot, and the sha256 of its inline
// style into the /sample block of site/_headers (C1 spec §3, §6). Run `pnpm site:build`; commit both files.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderReport } from '../plugin/hooks/core/report.ts'
import { SAMPLE_SNAPSHOT } from './site/sample-snapshot.ts'

export const SITE = join(dirname(fileURLToPath(import.meta.url)), '..', 'site')
export const SAMPLE_BANNER = 'Sample report: made-up data, laid out exactly as your client sees a published report.'

const BEGIN = '# BEGIN sample (written by scripts/build-site.mjs)'
const END = '# END sample'

export function sampleHtml() {
  return renderReport(SAMPLE_SNAPSHOT, { banner: SAMPLE_BANNER, confirm: { kind: 'sample' } })
}

export function styleHash(html) {
  const m = /<style>([\s\S]*?)<\/style>/.exec(html)
  if (!m) throw new Error('the report has no <style> element')
  return `sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}`
}

function sampleBlock(hash) {
  return [
    BEGIN,
    '/sample',
    '  ! Content-Security-Policy',
    `  Content-Security-Policy: default-src 'none'; style-src '${hash}'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    END,
  ].join('\n')
}

export function withSampleHeaders(headers, hash) {
  const a = headers.indexOf(BEGIN), b = headers.indexOf(END)
  if (a < 0 || b < a) throw new Error(`site/_headers has no "${BEGIN}" … "${END}" block`)
  return headers.slice(0, a) + sampleBlock(hash) + headers.slice(b + END.length)
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  const html = sampleHtml()
  writeFileSync(join(SITE, 'sample.html'), html)
  const path = join(SITE, '_headers')
  writeFileSync(path, withSampleHeaders(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'), styleHash(html)))
  console.log('wrote site/sample.html and the /sample CSP hash in site/_headers')
}
