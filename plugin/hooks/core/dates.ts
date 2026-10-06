const DAY_MS = 86_400_000

export function localDate(ts: number, tz: number): string {
  return new Date(ts + tz * 60_000).toISOString().slice(0, 10)
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
}

export function isCalendarDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  if (Number.isNaN(Date.parse(s + 'T00:00:00Z'))) return false
  return addDays(s, 0) === s
}

export function weekdayIndex(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
}

export function mondayOf(date: string): string {
  return addDays(date, -weekdayIndex(date))
}

export function formatMinutes(m: number): string {
  const total = Math.max(0, Math.round(m))
  return `${Math.floor(total / 60)}h${String(total % 60).padStart(2, '0')}`
}

/** First and last day of a `YYYY-MM` month. */
export function monthBounds(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: addDays(addDays(`${month}-28`, 4).slice(0, 7) + '-01', -1) }
}
