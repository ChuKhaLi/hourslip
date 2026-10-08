import { formatMinutes } from './dates.ts'
import type { Snapshot } from './snapshot.ts'

export const HONESTY_LINE = 'Measured from Claude Code activity. Time outside Claude Code, such as meetings or manual testing, appears only where it was added by hand, and is labelled so.'

/** By day notes for a day with time read from Claude Code transcripts (`/hourslip import`). */
export const IMPORTED_NOTE = 'from Claude Code transcripts'

/** Stands next to every Confirm (parent spec §6.3, §10). */
export const CONFIRM_NOTE = 'hourslip does not verify who confirms: anyone with this link can.'

/** What the report shows where a client confirms: the site's sample, the live form, or who confirmed. */
export type ConfirmView = { kind: 'sample' } | { kind: 'form'; action: string } | { kind: 'confirmed'; name: string; at: string }

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const e = escapeHtml
const money = (cents: number, currency: string) => `${(cents / 100).toFixed(2)} ${e(currency)}`

// Ledger look (C1 spec §5): light tokens, dark from the system, print always light. System fonts only:
// the report server allows this one hashed inline style and nothing else, and the mod's preview is a local file.
const STYLE = `
:root{--paper:#f6f1e7;--sheet:#fffdf8;--ink:#2a2419;--muted:#5b5143;--rule:#d9ccb4;--accent:#7a5c2e;--warn:#8a4b00}
@media (prefers-color-scheme: dark){:root{--paper:#1a1712;--sheet:#221e17;--ink:#ece4d4;--muted:#b5aa96;--rule:#3a3328;--accent:#e9b44c;--warn:#f0b35a}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 Georgia,'Times New Roman',serif}
main{max-width:780px;margin:24px auto;padding:32px 28px;background:var(--sheet);border:1px solid var(--rule);overflow-wrap:anywhere}
h1{font-size:26px;line-height:1.2;margin:0 0 4px}h2{font-size:17px;margin:30px 0 8px}
a{color:var(--accent)}.muted{color:var(--muted)}.warn{color:var(--warn)}.honesty{font-style:italic}
.banner{border:1px dashed var(--rule);padding:8px 12px;margin-bottom:20px;font-size:14px}
table{width:100%;border-collapse:collapse}
td,th{text-align:left;padding:7px 8px;border-bottom:1px solid var(--rule);vertical-align:top;overflow-wrap:anywhere}
th{font-weight:600}td.n,th.n{text-align:right;font-family:ui-monospace,Consolas,monospace;font-variant-numeric:tabular-nums}
ul{margin:4px 0 0;padding-left:18px}.totals{font-size:19px}
.confirm{margin-top:30px;border-top:1px solid var(--rule)}
.button{display:inline-block;border:1px solid var(--ink);padding:8px 14px;font:600 14px ui-monospace,Consolas,monospace}
button.button{background:none;color:var(--ink);cursor:pointer}input{font:inherit;padding:6px 8px;border:1px solid var(--rule);background:var(--sheet);color:var(--ink);width:100%;max-width:320px}
footer{margin-top:40px;font-size:13px}
@media (max-width:560px){main{margin:0;padding:20px 16px;border:0}}
@media print{:root{--paper:#ffffff;--sheet:#ffffff;--ink:#000000;--muted:#333333;--rule:#999999;--accent:#000000;--warn:#000000}.banner,.confirm .button,.confirm form{display:none}main{margin:0;border:0;padding:0}}`

function confirmBlock(c: ConfirmView | undefined): string {
  const note = `<p class="muted">${e(CONFIRM_NOTE)}</p>`
  if (c?.kind === 'sample') return `<section class="confirm"><h2>Confirm these hours</h2><p>On a published report, whoever holds the link can type a name here and confirm.</p><p><span class="button" aria-disabled="true">Confirm these hours</span></p>${note}</section>`
  if (c?.kind === 'form') return `<section class="confirm"><h2>Confirm these hours</h2><form method="post" action="${e(c.action)}"><p><label for="name">Your name</label><br><input id="name" name="name" required maxlength="100" autocomplete="name"></p><p><button class="button" type="submit">Confirm these hours</button></p></form>${note}</section>`
  if (c?.kind === 'confirmed') return `<section class="confirm"><h2>Confirmed</h2><p>Confirmed by ${e(c.name)} (link holder) at ${e(c.at)}.</p>${note}</section>`
  return ''
}

export function renderReport(s: Snapshot, opts: { banner?: string | string[]; confirm?: ConfirmView; newer?: string } = {}): string {
  const t = s.totals
  const lines = opts.banner === undefined ? [] : [opts.banner].flat().filter(Boolean)
  const newer = opts.newer ? `<div class="banner">A newer version of this report exists. <a href="${e(opts.newer)}">Open the newest version</a>.</div>` : ''
  const banner = newer + (lines.length ? `<div class="banner">${lines.map(l => `<div>${e(l)}</div>`).join('')}</div>` : '')
  const billable = t.presenceMinutes + t.manualMinutes
  const days = s.days.map(d => `<tr><td>${e(d.date)}</td><td class="n">${formatMinutes(d.presenceMinutes)}</td><td class="n">${formatMinutes(d.manualMinutes)}</td><td class="n">${formatMinutes(d.claudeMinutes)}</td><td>${d.overlap ? '<span class="warn">overlapping clients</span>' : ''}${d.capped ? ' <span class="warn">capped at 12h</span>' : ''}${d.imported ? `${d.overlap || d.capped ? ' ' : ''}<span class="muted">${IMPORTED_NOTE}</span>` : ''}</td></tr>`).join('')
  const tickets = s.tickets.map(k => `<tr><td>${k.ticket === null ? '<span class="muted">No ticket</span>' : e(k.ticket)}${k.branches.length ? `<div class="muted">${k.branches.map(e).join(', ')}</div>` : ''}${k.commits.length ? `<ul>${k.commits.map(c => `<li>${e(c)}</li>`).join('')}</ul>` : ''}</td><td class="n">${formatMinutes(k.presenceMinutes)}</td><td class="n">${formatMinutes(k.claudeMinutes)}</td></tr>`).join('')
  const manual = s.manual.length ? `<h2>Added by hand</h2><table><tr><th>Date</th><th>Note</th><th class="n">Time</th></tr>${s.manual.map(m => `<tr><td>${e(m.date)}</td><td>${e(m.note)} <span class="muted">(added by hand${m.ticket ? `, ${e(m.ticket)}` : ''})</span></td><td class="n">${formatMinutes(m.minutes)}</td></tr>`).join('')}</table>` : ''
  const inv = s.invoice
  const invoice = inv ? `<h2>Invoice ${e(inv.number)}</h2><table><tr><td>${formatMinutes(inv.billableMinutes)} at ${money(inv.rateCents, inv.currency)} per hour</td><td class="n totals">${money(inv.amountCents, inv.currency)}</td></tr><tr><td>Due</td><td class="n">${e(inv.dueDate)}</td></tr></table>${s.business.paymentInstructions ? `<p>${e(s.business.paymentInstructions)}</p>` : ''}` : ''
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${e(s.client.name)} · ${e(s.period.from)} to ${e(s.period.to)}</title><style>${STYLE}</style></head>
<body><main>
${banner}
<h1>${e(s.client.name)}</h1>
<div class="muted">${[s.business.name, `${s.period.from} to ${s.period.to}`].filter(Boolean).map(e).join(' · ')}</div>
<p class="totals">Billable ${formatMinutes(billable)} <span class="muted">(measured ${formatMinutes(t.presenceMinutes)}, added by hand ${formatMinutes(t.manualMinutes)}) · Claude working ${formatMinutes(t.claudeMinutes)}</span></p>
<p class="muted honesty">${e(HONESTY_LINE)}</p>
<h2>By day</h2><table><tr><th>Date</th><th class="n">Measured</th><th class="n">By hand</th><th class="n">Claude</th><th></th></tr>${days}</table>
<h2>By ticket</h2><table><tr><th>Ticket</th><th class="n">Measured</th><th class="n">Claude</th></tr>${tickets}</table>
${manual}
${invoice}
${confirmBlock(opts.confirm)}
<footer class="muted"><a href="https://hourslip.dev/">Made with hourslip</a> · Print this page to save it as PDF.</footer>
</main></body></html>`
}
