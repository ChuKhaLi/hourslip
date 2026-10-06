import { expect, test } from 'vitest'
import { DEFAULT_TICKET_PATTERN, GAP_MS, MINUTE } from '../../plugin/hooks/core/types.ts'

test('core constants load through vitest with .ts imports', () => {
  expect(GAP_MS).toBe(45 * MINUTE)
})

test('default ticket pattern matches real tickets', () => {
  const re = new RegExp(DEFAULT_TICKET_PATTERN)
  expect(re.test('VSM-T182')).toBe(true)
  expect(re.test('ABC-123')).toBe(true)
  expect(re.test('ABC-Td1')).toBe(false)
})
