export type EventKind = 'start' | 'prompt' | 'turn-start' | 'turn-end' | 'end' | 'tag'
export type TagScope = 'from-now' | 'session'
export type Tag = { client: string; ticket: string | null; scope: TagScope }

export type EventLine = {
  v: 1
  ts: string
  tz: number
  sid: string
  kind: EventKind
  cwd: string
  branch: string | null
  turn?: string
  agent?: string
  tag?: Tag
  src?: 'transcript'
}

export type ManualLine = {
  v: 1
  date: string
  minutes: number
  client: string
  ticket: string | null
  note: string
}

export type ClientRule = {
  id: string
  name: string
  paths: string[]
  rate: { amount: number; currency: string } | null
  ticketPattern: string | null
}

export type Rules = {
  v: 1
  business: { name: string; paymentInstructions: string }
  ticketPattern: string
  csv: 'en' | 'vi'
  author: string | null
  tzOffsetMinutes: number | null
  clients: ClientRule[]
}

export type Attribution = { client: string | null; ticket: string | null }

export type Row = {
  date: string
  client: string | null
  ticket: string | null
  presenceMinutes: number
  claudeMinutes: number
  manualMinutes: number
  overlap: boolean
  capped: boolean
  imported: boolean
}

export type TicketSource = { client: string; ticket: string; branch: string; cwd: string }

export type Timesheet = {
  rows: Row[]
  ticketSources: TicketSource[]
  overlapDates: string[]
  cappedDates: string[]
}

export const MINUTE = 60_000
export const GAP_MS = 45 * MINUTE
export const PAD_MS = 10 * MINUTE
export const MIN_MS = 10 * MINUTE
export const DAY_CAP_MS = 12 * 60 * MINUTE
export const DEFAULT_TICKET_PATTERN = '[A-Z][A-Z0-9]+-T?\\d+'
