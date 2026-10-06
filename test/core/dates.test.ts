import { describe, expect, test } from 'vitest'
import { addDays, formatMinutes, isCalendarDate, localDate, mondayOf, monthBounds, weekdayIndex } from '../../plugin/hooks/core/dates.ts'

describe('dates', () => {
  test('localDate shifts by the offset: 23:30 UTC at +07:00 is the next day', () => {
    expect(localDate(Date.parse('2026-10-04T23:30:00Z'), 420)).toBe('2026-10-05')
    expect(localDate(Date.parse('2026-10-05T01:00:00Z'), -300)).toBe('2026-10-04')
  })
  test('addDays crosses month ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
  test('weekdayIndex is Monday-based and mondayOf finds the week start', () => {
    expect(weekdayIndex('2026-10-05')).toBe(0)
    expect(weekdayIndex('2026-10-11')).toBe(6)
    expect(mondayOf('2026-10-11')).toBe('2026-10-05')
  })
  test('formatMinutes', () => {
    expect(formatMinutes(0)).toBe('0h00')
    expect(formatMinutes(134)).toBe('2h14')
    expect(formatMinutes(605)).toBe('10h05')
  })
  test('isCalendarDate validates real calendar dates', () => {
    expect(isCalendarDate('2026-10-05')).toBe(true)
    expect(isCalendarDate('2024-02-29')).toBe(true)
    expect(isCalendarDate('2026-13-01')).toBe(false)
    expect(isCalendarDate('2026-02-30')).toBe(false)
    expect(isCalendarDate('5/10')).toBe(false)
  })
  test('monthBounds gives the first and last day, leap years included', () => {
    expect(monthBounds('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(monthBounds('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' })
    expect(monthBounds('2026-10').to).toBe('2026-10-31')
    expect(monthBounds('2026-12').to).toBe('2026-12-31')
  })
})
