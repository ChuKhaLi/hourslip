import { localDate } from './dates.ts'
import { attribute } from './rules.ts'
import { GAP_MS, MIN_MS, PAD_MS, type Attribution, type EventLine, type Rules, type Tag, type TicketSource } from './types.ts'

export type Piece = { start: number; end: number; date: string; client: string | null; ticket: string | null }
export type TurnSpan = Piece

type Point = { t: number; tz: number; attr: Attribution; line: EventLine }

function attributePoints(sorted: EventLine[], rules: Rules): Point[] {
  const tags: { t: number; tag: Tag }[] = sorted.filter(l => l.kind === 'tag' && l.tag).map(l => ({ t: Date.parse(l.ts), tag: l.tag as Tag }))
  return sorted.filter(l => l.kind !== 'end' && l.kind !== 'start').map(line => {
    const t = Date.parse(line.ts)
    let best: { t: number; tag: Tag } | null = null
    for (const g of tags) if ((g.tag.scope === 'session' || g.t <= t) && (!best || g.t >= best.t)) best = g
    const attr = best ? { client: best.tag.client, ticket: best.tag.ticket } : attribute(rules, line.cwd, line.branch)
    return { t, tz: line.tz, attr, line }
  })
}

const sameAttr = (a: Attribution, b: Attribution) => a.client === b.client && a.ticket === b.ticket
const byTime = (a: EventLine, b: EventLine) => Date.parse(a.ts) - Date.parse(b.ts)

export function sessionPieces(lines: EventLine[], rules: Rules): { pieces: Piece[]; turns: TurnSpan[]; sources: TicketSource[] } {
  const sorted = [...lines].sort(byTime)
  const points = attributePoints(sorted, rules)
  const ends = sorted.filter(l => l.kind === 'end').map(l => Date.parse(l.ts))
  const pieces: Piece[] = []
  const pointDate = new Map<Point, string>()

  let seg: Point[] = []
  const closeSegment = () => {
    if (seg.length === 0) return
    const first = seg[0]
    const last = seg[seg.length - 1]
    let end = last.t + PAD_MS
    const cut = ends.find(x => x >= last.t && x < end)
    if (cut !== undefined) end = cut
    end = Math.max(end, first.t + MIN_MS)
    const date = localDate(first.t, first.tz)
    for (let i = 0; i < seg.length; i++) {
      const p = seg[i]
      pointDate.set(p, date)
      const pieceEnd = i + 1 < seg.length ? seg[i + 1].t : end
      if (pieceEnd <= p.t) continue
      const prev = pieces[pieces.length - 1]
      if (prev && prev.end === p.t && prev.date === date && sameAttr(prev, p.attr)) prev.end = pieceEnd
      else pieces.push({ start: p.t, end: pieceEnd, date, client: p.attr.client, ticket: p.attr.ticket })
    }
    seg = []
  }
  for (const p of points) {
    if (seg.length > 0 && p.t - seg[seg.length - 1].t > GAP_MS) closeSegment()
    seg.push(p)
  }
  closeSegment()

  const turns: TurnSpan[] = []
  const seen = new Set<string>()
  points.forEach((p, i) => {
    if (p.line.kind !== 'turn-start' || !p.line.turn || seen.has(p.line.turn)) return
    seen.add(p.line.turn)
    const endPoint = points.find((q, j) => j > i && q.line.kind === 'turn-end' && q.line.turn === p.line.turn && !q.line.agent)
    const next = points[i + 1]
    const end = endPoint ? endPoint.t : next ? next.t : p.t + PAD_MS
    turns.push({ start: p.t, end, date: pointDate.get(p) ?? localDate(p.t, p.tz), client: p.attr.client, ticket: p.attr.ticket })
  })

  const sources: TicketSource[] = []
  const keys = new Set<string>()
  for (const p of points) {
    if (!p.attr.client || !p.attr.ticket || !p.line.branch) continue
    const key = JSON.stringify([p.attr.client, p.attr.ticket, p.line.branch, p.line.cwd])
    if (keys.has(key)) continue
    keys.add(key)
    sources.push({ client: p.attr.client, ticket: p.attr.ticket, branch: p.line.branch, cwd: p.line.cwd })
  }
  return { pieces, turns, sources }
}

export function currentAttribution(lines: EventLine[], rules: Rules, cwd: string, branch: string | null, now: number): Attribution {
  const probe: EventLine = { v: 1, ts: new Date(now).toISOString(), tz: 0, sid: '', kind: 'prompt', cwd, branch }
  const points = attributePoints([...lines, probe].sort(byTime), rules)
  return points[points.length - 1].attr
}
