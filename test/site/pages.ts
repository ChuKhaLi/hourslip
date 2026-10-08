import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SITE } from '../../scripts/build-site.mjs'

/** Every hand-written page. sample.html is generated and checked in sample.test.ts. */
export const PAGES = ['index.html', '404.html', 'terms.html', 'privacy.html', 'refunds.html', 'contact.html', 'thanks.html', 'guides.html', 'guides/track-time-in-claude-code.html', 'guides/bill-clients-for-claude-code-hours.html', 'guides/timesheet-per-ticket-from-branch.html', 'guides/send-client-timesheet-to-confirm.html', 'guides/claude-code-time-trackers.html']
export const read = (rel: string) => readFileSync(join(SITE, rel), 'utf8').replace(/\r\n/g, '\n')
