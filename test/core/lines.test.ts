import { describe, expect, test } from 'vitest'
import { parseEventLines, parseManualLines, serializeLine } from '../../plugin/hooks/core/lines.ts'
import type { EventLine } from '../../plugin/hooks/core/types.ts'

const ok: EventLine = { v: 1, ts: '2026-10-05T02:00:00.000Z', tz: 420, sid: 's1', kind: 'prompt', cwd: 'F:/w', branch: null }

describe('event lines', () => {
  test('round-trips, skipping blank lines and CRLF', () => {
    const text = `${serializeLine(ok)}\r\n\r\n${serializeLine({ ...ok, kind: 'end' })}\n`
    expect(parseEventLines(text)).toEqual({ lines: [ok, { ...ok, kind: 'end' }], skipped: 0 })
  })
  test('counts unparseable and malformed lines as skipped', () => {
    const text = [
      '{not json',
      JSON.stringify({ ...ok, v: 2 }),
      JSON.stringify({ ...ok, ts: 'yesterday' }),
      JSON.stringify({ ...ok, kind: 'nap' }),
      JSON.stringify({ ...ok, kind: 'tag' }),
      serializeLine(ok),
    ].join('\n')
    expect(parseEventLines(text)).toEqual({ lines: [ok], skipped: 5 })
  })
  test('accepts a tag line with its tag', () => {
    const tag: EventLine = { ...ok, kind: 'tag', tag: { client: 'acme', ticket: null, scope: 'session' } }
    expect(parseEventLines(serializeLine(tag)).lines).toEqual([tag])
  })
  test('keeps a well-formed repo and reads a line with a malformed one without it', () => {
    const withRepo = { ...ok, repo: { root: 'F:/w', remote: 'https://github.com/a/b' } }
    const bad = { ...ok, repo: { root: 3 } }
    const { lines, skipped } = parseEventLines([JSON.stringify(withRepo), JSON.stringify(bad)].join('\n'))
    expect(skipped).toBe(0)
    expect(lines[0]).toEqual(withRepo)
    expect('repo' in lines[1]).toBe(false)
  })
})

describe('manual lines', () => {
  test('keeps valid lines and skips bad dates or non-positive minutes', () => {
    const good = { v: 1 as const, date: '2026-10-05', minutes: 60, client: 'acme', ticket: null, note: 'call' }
    const text = [serializeLine(good), JSON.stringify({ ...good, date: '5/10' }), JSON.stringify({ ...good, minutes: 0 })].join('\n')
    expect(parseManualLines(text)).toEqual({ lines: [good], skipped: 2 })
  })
  test('skips lines with calendar-invalid dates like 2026-13-01', () => {
    const good = { v: 1 as const, date: '2026-10-05', minutes: 60, client: 'acme', ticket: null, note: 'call' }
    const text = [serializeLine(good), JSON.stringify({ ...good, date: '2026-13-01' }), serializeLine(good)].join('\n')
    expect(parseManualLines(text)).toEqual({ lines: [good, good], skipped: 1 })
  })
})
