import type { EventLine, ManualLine } from './types.ts'
import { isCalendarDate } from './dates.ts'

const KINDS = new Set(['start', 'prompt', 'turn-start', 'turn-end', 'end', 'tag'])

function isEventLine(o: any): o is EventLine {
  if (!o || typeof o !== 'object' || o.v !== 1) return false
  if (typeof o.ts !== 'string' || Number.isNaN(Date.parse(o.ts))) return false
  if (typeof o.tz !== 'number' || typeof o.sid !== 'string' || typeof o.cwd !== 'string') return false
  if (!KINDS.has(o.kind)) return false
  if (o.branch !== null && typeof o.branch !== 'string') return false
  if (o.kind === 'tag') {
    const t = o.tag
    if (!t || typeof t.client !== 'string' || (t.ticket !== null && typeof t.ticket !== 'string')) return false
    if (t.scope !== 'from-now' && t.scope !== 'session') return false
  }
  // A repo that is not { root: text, remote: text or null } is dropped, not the line (spec §2).
  if (o.repo !== undefined && !(o.repo && typeof o.repo.root === 'string' && (o.repo.remote === null || typeof o.repo.remote === 'string'))) delete o.repo
  return true
}

function isManualLine(o: any): o is ManualLine {
  return !!o && o.v === 1 && typeof o.date === 'string' && isCalendarDate(o.date) &&
    Number.isInteger(o.minutes) && o.minutes > 0 && typeof o.client === 'string' &&
    (o.ticket === null || typeof o.ticket === 'string') && typeof o.note === 'string'
}

function parse<T>(text: string, is: (o: unknown) => o is T): { lines: T[]; skipped: number } {
  const lines: T[] = []
  let skipped = 0
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === '') continue
    try {
      const o = JSON.parse(raw)
      if (is(o)) lines.push(o)
      else skipped++
    } catch {
      skipped++
    }
  }
  return { lines, skipped }
}

export const parseEventLines = (text: string) => parse(text, isEventLine)
export const parseManualLines = (text: string) => parse(text, isManualLine)
export const serializeLine = (line: EventLine | ManualLine): string => JSON.stringify(line)
