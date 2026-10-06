import { describe, expect, test } from 'vitest'
import { DEFAULT_RULES, attribute, clientName, matchPath, parseHead, parseRules } from '../../plugin/hooks/core/rules.ts'
import type { Rules } from '../../plugin/hooks/core/types.ts'

const rules: Rules = {
  ...DEFAULT_RULES,
  clients: [
    { id: 'acme', name: 'ACME Corp', paths: ['f:\\work\\acme\\**'], rate: null, ticketPattern: 'ACME-\\d+' },
    { id: 'beta', name: 'Beta', paths: ['/home/dev/beta/**'], rate: null, ticketPattern: null },
  ],
}

describe('matchPath', () => {
  test('Windows paths match across slash direction and letter case', () => {
    expect(matchPath('f:\\work\\acme\\**', 'F:/Work/ACME/api')).toBe(true)
    expect(matchPath('F:/work/acme/**', 'F:\\work\\acme')).toBe(true)
  })
  test('POSIX paths are case-sensitive', () => {
    expect(matchPath('/home/dev/beta/**', '/home/dev/Beta/x')).toBe(false)
    expect(matchPath('/home/dev/beta/**', '/home/dev/beta/x/y')).toBe(true)
  })
  test('* stays inside one segment and ** does not leak to siblings', () => {
    expect(matchPath('/w/*/api', '/w/a/api')).toBe(true)
    expect(matchPath('/w/*/api', '/w/a/b/api')).toBe(false)
    expect(matchPath('/w/acme/**', '/w/acme-old/x')).toBe(false)
  })
  test('regex characters in paths are literal', () => {
    expect(matchPath('/w/a+b (1)/**', '/w/a+b (1)/x')).toBe(true)
    expect(matchPath('/w/a+b/**', '/w/aab/x')).toBe(false)
  })
})

describe('attribute', () => {
  test('client by path, ticket by the client pattern', () => {
    expect(attribute(rules, 'F:/work/acme/api', 'feat/ACME-182-login')).toEqual({ client: 'acme', ticket: 'ACME-182' })
  })
  test('falls back to the global ticket pattern', () => {
    expect(attribute(rules, '/home/dev/beta/x', 'fix/VSM-T182')).toEqual({ client: 'beta', ticket: 'VSM-T182' })
  })
  test('no ticket without a matching branch; unassigned without a matching path', () => {
    expect(attribute(rules, 'F:/work/acme', 'main')).toEqual({ client: 'acme', ticket: null })
    expect(attribute(rules, 'F:/work/acme', null)).toEqual({ client: 'acme', ticket: null })
    expect(attribute(rules, 'D:/other', 'feat/ACME-1')).toEqual({ client: null, ticket: null })
  })
})

describe('parseRules', () => {
  test('missing fields take defaults', () => {
    const r = parseRules('{"v":1,"clients":[{"id":"acme","name":"ACME","paths":["/w/**"]}]}')
    expect(r).toEqual({ ok: true, rules: { ...DEFAULT_RULES, clients: [{ id: 'acme', name: 'ACME', paths: ['/w/**'], rate: null, ticketPattern: null }] } })
  })
  test('a trailing comma reports the line it is on', () => {
    const r = parseRules('{\n  "v": 1,\n  "clients": [],\n}')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/line 4/)
  })
  test('rejects bad shapes with the field path', () => {
    const bad = (t: string) => { const r = parseRules(t); return r.ok ? '' : r.error }
    expect(bad('{"v":1,"clients":[{"id":"a","name":"A","paths":"/w"}]}')).toMatch(/clients\[0\]\.paths/)
    expect(bad('{"v":1,"clients":[{"id":"a","name":"A","paths":[],"ticketPattern":"("}]}')).toMatch(/clients\[0\]\.ticketPattern/)
    expect(bad('{"v":1,"clients":[{"id":"a","name":"A","paths":[]},{"id":"a","name":"B","paths":[]}]}')).toMatch(/duplicate client id "a"/)
    expect(bad('{"v":1,"csv":"fr"}')).toMatch(/csv/)
    expect(bad('{"v":1,"clients":[{"id":"a","name":"A","paths":[],"rate":{"amount":-1,"currency":"USD"}}]}')).toMatch(/clients\[0\]\.rate/)
  })
})

describe('parseHead and clientName', () => {
  test('a branch starting with - or holding a control character is not a branch', () => {
    expect(parseHead('ref: refs/heads/--output=x')).toBeNull()
    expect(parseHead('ref: refs/heads/-x')).toBeNull()
    expect(parseHead('ref: refs/heads/a\x01b')).toBeNull()
    expect(parseHead('ref: refs/heads/a\x7fb')).toBeNull()
  })
  test('branch, detached sha, garbage', () => {
    expect(parseHead('ref: refs/heads/feat/ACME-1-x\n')).toBe('feat/ACME-1-x')
    expect(parseHead('3f2a9c1d0b8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a\n')).toBe('3f2a9c1')
    expect(parseHead('hello')).toBeNull()
  })
  test('clientName falls back to the id, and null is Unassigned', () => {
    expect(clientName(rules, 'acme')).toBe('ACME Corp')
    expect(clientName(rules, 'gone')).toBe('gone')
    expect(clientName(rules, null)).toBe('Unassigned')
  })
})
