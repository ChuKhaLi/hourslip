import { sessionPieces, type Piece, type TurnSpan } from './presence.ts'
import { DAY_CAP_MS, MINUTE, type EventLine, type ManualLine, type Row, type Rules, type TicketSource, type Timesheet } from './types.ts'

type Acc = { date: string; client: string | null; ticket: string | null; presenceMs: number; claudeMs: number; manualMinutes: number; overlap: boolean; capped: boolean; imported: boolean }
const keyOf = (date: string, client: string | null, ticket: string | null) => JSON.stringify([date, client, ticket])

export function buildTimesheet(input: { sessions: EventLine[][]; manual: ManualLine[]; rules: Rules; from: string; to: string }): Timesheet {
  const pieces: Piece[] = []
  const turns: TurnSpan[] = []
  const sources: TicketSource[] = []
  const sourceKeys = new Set<string>()
  for (const lines of input.sessions) {
    const r = sessionPieces(lines, input.rules)
    // An imported session's lines all carry src 'transcript'; its pieces and turns mark the cells they reach.
    const imported = lines[0]?.src === 'transcript'
    pieces.push(...r.pieces.map(p => (imported ? { ...p, imported } : p)))
    turns.push(...r.turns.map(p => (imported ? { ...p, imported } : p)))
    for (const s of r.sources) {
      const k = JSON.stringify(s)
      if (!sourceKeys.has(k)) { sourceKeys.add(k); sources.push(s) }
    }
  }

  const acc = new Map<string, Acc>()
  const cell = (date: string, client: string | null, ticket: string | null): Acc => {
    const k = keyOf(date, client, ticket)
    let a = acc.get(k)
    if (!a) { a = { date, client, ticket, presenceMs: 0, claudeMs: 0, manualMinutes: 0, overlap: false, capped: false, imported: false }; acc.set(k, a) }
    return a
  }

  // Presence: sweep elementary intervals. Same client counts once; different assigned clients split equally; Unassigned keeps its own time.
  const bounds = [...new Set(pieces.flatMap(p => [p.start, p.end]))].sort((a, b) => a - b)
  for (let i = 0; i + 1 < bounds.length; i++) {
    const a = bounds[i]
    const b = bounds[i + 1]
    const active = pieces.filter(p => p.start <= a && p.end >= b)
    if (active.length === 0) continue
    // Unassigned (client null) never competes: it keeps its own full time and neither splits nor flags.
    const byClient = new Map<string | null, Piece[]>()
    for (const p of active) byClient.set(p.client, [...(byClient.get(p.client) ?? []), p])
    const assigned = [...byClient.keys()].filter(k => k !== null).length
    for (const [client, group] of byClient) {
      const share = client === null ? b - a : (b - a) / assigned
      const keys = new Map<string, Piece>()
      const importedKeys = new Set<string>()
      for (const p of group) {
        const k = keyOf(p.date, p.client, p.ticket)
        keys.set(k, p)
        if (p.imported) importedKeys.add(k)
      }
      for (const [k, p] of keys) {
        const c = cell(p.date, p.client, p.ticket)
        c.presenceMs += share / keys.size
        if (importedKeys.has(k)) c.imported = true
        if (client !== null && assigned > 1) c.overlap = true
      }
    }
  }
  for (const t of turns) {
    const c = cell(t.date, t.client, t.ticket)
    c.claudeMs += t.end - t.start
    if (t.imported && t.end > t.start) c.imported = true
  }
  for (const m of input.manual) cell(m.date, m.client, m.ticket).manualMinutes += m.minutes

  // Day cap on presence, over assigned clients only (Unassigned is not competing and is never capped).
  const perDay = new Map<string, number>()
  for (const c of acc.values()) if (c.client !== null) perDay.set(c.date, (perDay.get(c.date) ?? 0) + c.presenceMs)
  for (const c of acc.values()) {
    if (c.client === null) continue
    const total = perDay.get(c.date) ?? 0
    if (total > DAY_CAP_MS) { c.presenceMs *= DAY_CAP_MS / total; c.capped = true }
  }

  // Round presence by largest remainder per (date, client) group, so merged cross-ticket time is never
  // overstated: the group totals Math.round(sum of its presenceMs / MINUTE). A capped day's assigned rows
  // are instead shared out so the day sums to exactly the cap.
  const presenceMin = new Map<Acc, number>()
  const largestRemainder = (cells: Acc[], target: number) => {
    const exact = cells.map(c => c.presenceMs / MINUTE)
    const floors = exact.map(x => Math.floor(x + 1e-9))
    let left = target - floors.reduce((s, x) => s + x, 0)
    const order = exact.map((x, i) => ({ i, frac: x - floors[i] })).sort((x, y) => y.frac - x.frac || x.i - y.i)
    for (const o of order) { if (left <= 0) break; floors[o.i]++; left-- }
    cells.forEach((c, i) => presenceMin.set(c, floors[i]))
  }
  const groups = new Map<string, Acc[]>()
  for (const c of acc.values()) {
    const k = JSON.stringify([c.date, c.client])
    groups.set(k, [...(groups.get(k) ?? []), c])
  }
  for (const cells of groups.values()) largestRemainder(cells, Math.round(cells.reduce((s, c) => s + c.presenceMs, 0) / MINUTE))
  for (const date of new Set([...acc.values()].filter(c => c.capped).map(c => c.date))) {
    largestRemainder([...acc.values()].filter(c => c.date === date && c.client !== null), Math.round(DAY_CAP_MS / MINUTE))
  }

  const inRange = (d: string) => d >= input.from && d <= input.to
  const rows: Row[] = [...acc.values()].filter(c => inRange(c.date)).map(c => ({
    date: c.date, client: c.client, ticket: c.ticket,
    presenceMinutes: presenceMin.get(c) ?? 0, claudeMinutes: Math.round(c.claudeMs / MINUTE),
    manualMinutes: c.manualMinutes, overlap: c.overlap, capped: c.capped, imported: c.imported,
  })).filter(r => r.presenceMinutes + r.claudeMinutes + r.manualMinutes > 0)
  const cmp = (x: string | null, y: string | null) => (x === y ? 0 : x === null ? 1 : y === null ? -1 : x < y ? -1 : 1)
  rows.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : cmp(x.client, y.client) || cmp(x.ticket, y.ticket)))
  const dates = (f: (r: Row) => boolean) => [...new Set(rows.filter(f).map(r => r.date))].sort()
  return { rows, ticketSources: sources, overlapDates: dates(r => r.overlap), cappedDates: dates(r => r.capped) }
}
