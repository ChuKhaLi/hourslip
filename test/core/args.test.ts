import { describe, expect, test } from 'vitest'
import { csvName } from '../../plugin/hooks/core/names.ts'
import { USAGE, parseCommand, parseDuration, tokenize } from '../../plugin/hooks/core/args.ts'

describe('tokenize and parseDuration', () => {
  test('double quotes group words', () => {
    expect(tokenize(' add 1h acme "Call with  client" --date 2026-10-05 ')).toEqual(['add', '1h', 'acme', 'Call with  client', '--date', '2026-10-05'])
  })
  test('durations', () => {
    expect(parseDuration('1h')).toBe(60)
    expect(parseDuration('90m')).toBe(90)
    expect(parseDuration('1h30')).toBe(90)
    expect(parseDuration('1.5h')).toBe(90)
    expect(parseDuration('0m')).toBeNull()
    expect(parseDuration('abc')).toBeNull()
  })
})

describe('parseCommand', () => {
  test('empty is the pane; tz is the probe', () => {
    expect(parseCommand('')).toEqual({ kind: 'pane' })
    expect(parseCommand('tz')).toEqual({ kind: 'tz' })
  })
  test('tag', () => {
    expect(parseCommand('tag acme ACME-1')).toEqual({ kind: 'tag', client: 'acme', ticket: 'ACME-1', scope: 'from-now' })
    expect(parseCommand('tag acme --session')).toEqual({ kind: 'tag', client: 'acme', ticket: null, scope: 'session' })
    expect(parseCommand('tag')).toEqual({ kind: 'error', message: `Usage: /hourslip tag <client> [ticket] [--session]` })
    expect(parseCommand('tag "" ACME-1').kind).toBe('error')
    expect(parseCommand('tag acme ""').kind).toBe('error')
  })
  test('add', () => {
    expect(parseCommand('add 1h30 acme "Call" --ticket A-1 --date 2026-10-04')).toEqual({ kind: 'add', minutes: 90, client: 'acme', note: 'Call', date: '2026-10-04', ticket: 'A-1' })
    expect(parseCommand('add soon acme "x"').kind).toBe('error')
    expect(parseCommand('add 1h acme "x" --date 4/10').kind).toBe('error')
    expect(parseCommand('add 1h acme "x" --date 2026-02-30').kind).toBe('error')
    expect(parseCommand('add 1h "" "x"').kind).toBe('error')
    expect(parseCommand('add 1h acme ""').kind).toBe('error')
    expect(parseCommand('add 1h acme "x" --ticket ""').kind).toBe('error')
  })
  test('client add', () => {
    expect(parseCommand('client add acme "ACME Corp" --path F:/work/acme/** --path D:/acme/** --rate 40 USD')).toEqual({ kind: 'client-add', id: 'acme', name: 'ACME Corp', paths: ['F:/work/acme/**', 'D:/acme/**'], rate: { amount: 40, currency: 'USD' } })
    expect(parseCommand('client add acme "ACME"').kind).toBe('error')
    expect(parseCommand('client add Acme! "ACME" --path /w/**').kind).toBe('error')
    expect(parseCommand('client add acme "ACME" --path /w/** --rate "" USD').kind).toBe('error')
  })
  test('export', () => {
    expect(parseCommand('export')).toEqual({ kind: 'export', client: null, month: null })
    expect(parseCommand('export acme 2026-10')).toEqual({ kind: 'export', client: 'acme', month: '2026-10' })
    expect(parseCommand('export 2026-10')).toEqual({ kind: 'export', client: null, month: '2026-10' })
    expect(parseCommand('export ""').kind).toBe('error')
    expect(parseCommand('export 2026-13')).toEqual({ kind: 'error', message: 'Usage: /hourslip export [client] [YYYY-MM]' })
    expect(parseCommand('export acme 2026-00').kind).toBe('error')
  })
  test('unknown', () => {
    expect(parseCommand('dance')).toEqual({ kind: 'error', message: USAGE })
  })
})

test('csvName names the export files', () => {
  expect(csvName(null, '2026-10')).toBe('hourslip-all-2026-10')
  expect(csvName('acme', '2026-10')).toBe('hourslip-acme-2026-10')
})
