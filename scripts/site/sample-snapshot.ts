// The made-up month behind hourslip.dev/sample. Sums hold: days and tickets both add up to the totals,
// and the invoice follows buildSnapshot's rule (half-up cents). One commit title carries "&" (Review Focus 5).
import type { Snapshot } from '../../plugin/hooks/core/snapshot.ts'

export const SAMPLE_SNAPSHOT: Snapshot = {
  v: 1,
  business: { name: 'Alex Doe Studio', paymentInstructions: 'Bank transfer to Alex Doe Studio. Reference ACME-2026-10.' },
  client: { name: 'ACME Corp' },
  period: { from: '2026-10-01', to: '2026-10-31' },
  totals: { presenceMinutes: 2260, claudeMinutes: 995, manualMinutes: 90 },
  days: [
    { date: '2026-10-01', presenceMinutes: 312, claudeMinutes: 141, manualMinutes: 0, overlap: false, capped: false },
    { date: '2026-10-02', presenceMinutes: 287, claudeMinutes: 120, manualMinutes: 90, overlap: false, capped: false },
    { date: '2026-10-05', presenceMinutes: 401, claudeMinutes: 188, manualMinutes: 0, overlap: false, capped: false },
    { date: '2026-10-06', presenceMinutes: 355, claudeMinutes: 160, manualMinutes: 0, overlap: false, capped: false },
    { date: '2026-10-07', presenceMinutes: 298, claudeMinutes: 133, manualMinutes: 0, overlap: false, capped: false },
    { date: '2026-10-08', presenceMinutes: 344, claudeMinutes: 151, manualMinutes: 0, overlap: false, capped: false },
    { date: '2026-10-09', presenceMinutes: 263, claudeMinutes: 102, manualMinutes: 0, overlap: false, capped: false },
  ],
  tickets: [
    { ticket: 'ACME-182', presenceMinutes: 845, claudeMinutes: 372, branches: ['feat/ACME-182-login'], commits: ['Add the login form', 'Rate-limit login attempts', 'Show a lockout message'] },
    { ticket: 'ACME-190', presenceMinutes: 731, claudeMinutes: 330, branches: ['feat/ACME-190-billing-export'], commits: ['Export invoices as CSV', 'Fix rounding in the CSV export & totals'] },
    { ticket: 'ACME-195', presenceMinutes: 512, claudeMinutes: 221, branches: ['chore/ACME-195-payment-sdk'], commits: ['Upgrade the payment SDK'] },
    { ticket: null, presenceMinutes: 172, claudeMinutes: 72, branches: [], commits: [] },
  ],
  manual: [{ date: '2026-10-02', minutes: 90, note: 'Call with the ACME team about the billing export', ticket: 'ACME-190' }],
  invoice: { number: 'ACME-2026-10', currency: 'USD', rateCents: 4000, billableMinutes: 2350, amountCents: 156667, dueDate: '2026-11-15' },
  showCommits: true,
  generator: { name: 'hourslip', version: '0.1.0' },
}
