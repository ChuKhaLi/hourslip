import { expect, test } from 'vitest'
import { CONFIRM_NOTE, HONESTY_LINE, renderReport } from '../../plugin/hooks/core/report.ts'
import { sampleHtml } from '../../scripts/build-site.mjs'
import { SAMPLE_SNAPSHOT } from '../../scripts/site/sample-snapshot.ts'
import { PAGES, read } from './pages.ts'

// Parent spec §10 and C1 spec §4: a confirmation is never a signature, an approval or proof of payment,
// and hours are never clock records.
export const FORBIDDEN: [string, RegExp][] = [
  ['verified approval', /verified approval/i], ['signature', /\bsignature\b/i], ['signed by', /\bsigned by\b/i],
  ['clock in', /\bclock[- ]?in\b/i], ['clock out', /\bclock[- ]?out\b/i], ['proof of payment', /proof of payment/i],
  ['approved by', /\bapproved by\b/i],
]
const hits = (text: string) => FORBIDDEN.filter(([, re]) => re.test(text)).map(([label]) => label)

test('the scan catches a planted phrase', () => {
  expect(hits('Signed by the client: verified approval, proof of payment.')).toEqual(['verified approval', 'signed by', 'proof of payment'])
})
test('no page, no sample and no report promises more than the product does', () => {
  for (const p of PAGES) expect(hits(read(p)), p).toEqual([])
  expect(hits(sampleHtml())).toEqual([])
  expect(hits(renderReport(SAMPLE_SNAPSHOT, { confirm: { kind: 'sample' } }))).toEqual([])
  expect(hits(read('llms.txt'))).toEqual([])
})
test('the honesty line and the confirm note stand where a reader meets the claim', () => {
  expect(read('index.html')).toContain(HONESTY_LINE)
  expect(sampleHtml()).toContain(HONESTY_LINE)
  expect(sampleHtml()).toContain(CONFIRM_NOTE)
})
