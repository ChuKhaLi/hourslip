import { expect, test } from 'vitest'
import { CONFIRM_NOTE, HONESTY_LINE, renderReport } from '../../plugin/hooks/core/report.ts'
import { sampleHtml } from '../../scripts/build-site.mjs'
import { SAMPLE_SNAPSHOT } from '../../scripts/site/sample-snapshot.ts'
import { FORBIDDEN } from '../helpers/forbidden.ts'
import { PAGES, read } from './pages.ts'

const hits = (text: string) => FORBIDDEN.filter(([, re]) => re.test(text)).map(([label]) => label)

test('the scan catches a planted phrase', () => {
  expect(hits('Signed by the client: verified approval, proof of payment.')).toEqual(['verified approval', 'signed by', 'proof of payment'])
})
test('no page, no sample and no report promises more than the product does', () => {
  for (const p of PAGES) expect(hits(read(p)), p).toEqual([])
  expect(hits(sampleHtml())).toEqual([])
  expect(hits(renderReport(SAMPLE_SNAPSHOT, { confirm: { kind: 'sample' } }))).toEqual([])
  expect(hits(renderReport(SAMPLE_SNAPSHOT, { confirm: { kind: 'form', action: '/r/x/approve' } }))).toEqual([])
  expect(hits(renderReport(SAMPLE_SNAPSHOT, { confirm: { kind: 'confirmed', name: 'Jane', at: '2026-10-07 14:03 UTC' }, newer: 'https://r.hourslip.dev/r/y' }))).toEqual([])
  expect(hits(read('llms.txt'))).toEqual([])
})
test('the honesty line and the confirm note stand where a reader meets the claim', () => {
  expect(read('index.html')).toContain(HONESTY_LINE)
  expect(sampleHtml()).toContain(HONESTY_LINE)
  expect(sampleHtml()).toContain(CONFIRM_NOTE)
})
