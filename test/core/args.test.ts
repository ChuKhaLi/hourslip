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
    expect(parseCommand('client add acme "ACME Corp" --path F:/work/acme/** --path D:/acme/** --rate 40 USD')).toEqual({ kind: 'client-add', id: 'acme', name: 'ACME Corp', paths: ['F:/work/acme/**', 'D:/acme/**'], repos: [], rate: { amount: 40, currency: 'USD' } })
    expect(parseCommand('client add acme "ACME"').kind).toBe('error')
    expect(parseCommand('client add Acme! "ACME" --path /w/**').kind).toBe('error')
    expect(parseCommand('client add acme "ACME" --path /w/** --rate "" USD').kind).toBe('error')
  })
  test('client add takes --repo, and needs a --path or a --repo', () => {
    expect(parseCommand('client add acme "ACME" --repo github.com/acme/*')).toEqual({ kind: 'client-add', id: 'acme', name: 'ACME', paths: [], repos: ['github.com/acme/*'], rate: null })
    expect(parseCommand('client add acme "ACME" --path /w/** --repo git@github.com:acme/app.git')).toMatchObject({ paths: ['/w/**'], repos: ['git@github.com:acme/app.git'] })
    expect(parseCommand('client add acme "ACME"')).toEqual({ kind: 'error', message: 'Give at least one --path or --repo.' })
    expect(parseCommand('client add acme "ACME" --repo ""').kind).toBe('error')
  })
  test('client path and client repo add one to an existing client', () => {
    expect(parseCommand('client path acme "F:/work/acme.worktrees/**"')).toEqual({ kind: 'client-path', id: 'acme', path: 'F:/work/acme.worktrees/**' })
    expect(parseCommand('client repo acme github.com/acme/app')).toEqual({ kind: 'client-repo', id: 'acme', repo: 'github.com/acme/app' })
    expect(parseCommand('client path acme')).toEqual({ kind: 'error', message: 'Usage: /hourslip client path <id> <glob>' })
    expect(parseCommand('client repo acme a b')).toEqual({ kind: 'error', message: 'Usage: /hourslip client repo <id> <remote>' })
    expect(parseCommand('client repo acme x --rate 1 USD').kind).toBe('error')
  })
  test('USAGE names client path, client repo and --repo', () => {
    for (const s of ['client path <id> <glob>', 'client repo <id> <remote>', '[--repo <remote>]']) expect(USAGE).toContain(s)
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

describe('publishing verbs', () => {
  test('publish', () => {
    expect(parseCommand('publish acme')).toEqual({ kind: 'publish', client: 'acme', month: null, confirm: false, showCommits: true })
    expect(parseCommand('publish acme 2026-10 --confirm --no-commits')).toEqual({ kind: 'publish', client: 'acme', month: '2026-10', confirm: true, showCommits: false })
    expect(parseCommand('publish --confirm acme 2026-10')).toMatchObject({ confirm: true, client: 'acme', month: '2026-10' })
    expect(parseCommand('publish')).toMatchObject({ kind: 'error' })
    expect(parseCommand('publish acme 2026-13')).toMatchObject({ kind: 'error' })
    expect(parseCommand('publish acme --yes')).toEqual({ kind: 'error', message: 'Unknown option --yes. publish takes --confirm and --no-commits.' })
  })
  test('subscribe, portal, unpublish, key', () => {
    expect(parseCommand('subscribe')).toEqual({ kind: 'subscribe', plan: 'yearly' })
    expect(parseCommand('subscribe --monthly')).toEqual({ kind: 'subscribe', plan: 'monthly' })
    expect(parseCommand('portal')).toEqual({ kind: 'portal' })
    expect(parseCommand('unpublish acme 2026-10')).toEqual({ kind: 'unpublish', client: 'acme', month: '2026-10' })
    expect(parseCommand('unpublish acme')).toMatchObject({ kind: 'error' })
    expect(parseCommand('key')).toEqual({ kind: 'key' })
    expect(parseCommand('key set hs_abc')).toEqual({ kind: 'key-set', key: 'hs_abc' })
    expect(parseCommand('key set')).toMatchObject({ kind: 'error' })
    expect(parseCommand('key forget')).toEqual({ kind: 'key-forget' })
  })
  test('key show', () => {
    expect(parseCommand('key show')).toEqual({ kind: 'key-show' })
    expect(parseCommand('key show now')).toMatchObject({ kind: 'error' })
  })
  test('flag strictness: subscribe takes only --monthly; portal, key, unpublish take no flags or extra tokens', () => {
    for (const bad of ['subscribe --yearly', 'subscribe --confirm', 'subscribe monthly', 'subscribe --monthly extra']) expect(parseCommand(bad), bad).toEqual({ kind: 'error', message: 'Usage: /hourslip subscribe [--monthly]' })
    for (const bad of ['portal --x', 'portal now', 'portal --monthly']) expect(parseCommand(bad), bad).toMatchObject({ kind: 'error', message: expect.stringContaining('/hourslip portal') })
    for (const bad of ['key --confirm', 'key forget --x', 'key show --x', 'key set hs_abc --x', 'key set hs_abc extra', 'key now']) expect(parseCommand(bad), bad).toMatchObject({ kind: 'error', message: expect.stringContaining('/hourslip key show') })
    for (const bad of ['unpublish acme 2026-10 --confirm', 'unpublish acme 2026-10 --x y', 'unpublish acme 2026-10 extra']) expect(parseCommand(bad), bad).toMatchObject({ kind: 'error' })
    expect(parseCommand('unpublish acme 2026-10')).toEqual({ kind: 'unpublish', client: 'acme', month: '2026-10' })
  })
  test('USAGE names the new commands', () => {
    for (const s of ['publish <client>', 'subscribe', 'portal', 'unpublish <client> <YYYY-MM>', 'key set <key>', 'key show']) expect(USAGE).toContain(s)
  })
})

describe('import', () => {
  test('preview, --confirm, --undo, flags anywhere after the verb', () => {
    expect(parseCommand('import')).toEqual({ kind: 'import', mode: 'preview' })
    expect(parseCommand('import --confirm')).toEqual({ kind: 'import', mode: 'confirm' })
    expect(parseCommand('import --undo')).toEqual({ kind: 'import', mode: 'undo' })
  })
  test('--confirm with --undo, an unknown flag, or a word is an error', () => {
    expect(parseCommand('import --confirm --undo')).toEqual({ kind: 'error', message: 'Use --confirm or --undo, not both.' })
    expect(parseCommand('import --x')).toEqual({ kind: 'error', message: 'Unknown option --x. import takes --confirm and --undo.' })
    expect(parseCommand('import acme')).toEqual({ kind: 'error', message: 'Usage: /hourslip import [--confirm | --undo]' })
  })
  test('USAGE names import', () => {
    expect(USAGE).toContain('/hourslip import [--confirm | --undo]')
  })
})
