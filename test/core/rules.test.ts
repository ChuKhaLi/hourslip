import { describe, expect, test } from 'vitest'
import { DEFAULT_RULES, attribute, clientName, matchPath, matchRemote, normalizeRemote, parseHead, parseRules, stripCredentials } from '../../plugin/hooks/core/rules.ts'
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

describe('remotes', () => {
  test('stripCredentials drops user and password from a URL, and leaves scp form alone', () => {
    expect(stripCredentials('https://user:tok@github.com/Acme/App.git')).toBe('https://github.com/Acme/App.git')
    expect(stripCredentials('https://x-access-token:ghp_abc@github.com/a/b')).toBe('https://github.com/a/b')
    expect(stripCredentials('ssh://git@github.com:22/acme/app.git')).toBe('ssh://github.com:22/acme/app.git')
    expect(stripCredentials('git@github.com:acme/app.git')).toBe('git@github.com:acme/app.git')
    expect(stripCredentials('https://github.com/a/b')).toBe('https://github.com/a/b')
  })
  test('normalizeRemote gives one form for https, ssh, scp, .git and case', () => {
    for (const r of ['https://github.com/Acme/App.git', 'git@github.com:acme/app', 'ssh://git@github.com:22/acme/app.git', 'https://u:p@GitHub.com/acme/app/', ' github.com/acme/app ']) {
      expect(normalizeRemote(r), r).toBe('github.com/acme/app')
    }
  })
  test('local-path remotes are paths, and a drive letter is not an scp host', () => {
    expect(normalizeRemote('C:\\git\\App.git')).toBe('c:/git/app')
    expect(normalizeRemote('/srv/git/app.git')).toBe('/srv/git/app')
    expect(normalizeRemote('file:///srv/git/app.git')).toBe('/srv/git/app')
    expect(normalizeRemote('file:///C:/git/App.git')).toBe('c:/git/app')
  })
  test('a self-hosted scp remote with an absolute path matches its ssh:// form', () => {
    expect(normalizeRemote('git@server:/srv/git/app.git')).toBe('server/srv/git/app')
    expect(normalizeRemote('ssh://git@server/srv/git/app.git')).toBe('server/srv/git/app')
    expect(matchRemote('server/srv/git/*', 'git@server:/srv/git/app.git')).toBe(true)
  })
  test('matchRemote takes globs: * in one segment, ** across', () => {
    expect(matchRemote('github.com/acme/app', 'git@github.com:Acme/App.git')).toBe(true)
    expect(matchRemote('github.com/acme/*', 'https://github.com/acme/api.git')).toBe(true)
    expect(matchRemote('github.com/acme/*', 'https://github.com/acme/team/api.git')).toBe(false)
    expect(matchRemote('github.com/acme/**', 'https://github.com/acme/team/api.git')).toBe(true)
    expect(matchRemote('github.com/acme/app', 'https://github.com/acme/app-old.git')).toBe(false)
  })
})

describe('attribute by repository', () => {
  const byRepo: Rules = {
    ...DEFAULT_RULES,
    clients: [
      { id: 'acme', name: 'ACME', paths: ['/work/acme/**'], rate: null, ticketPattern: 'ACME-[0-9]+' },
      { id: 'gh', name: 'GH', paths: [], repos: ['github.com/gh-org/*'], rate: null, ticketPattern: null },
      { id: 'late', name: 'Late', paths: [], repos: ['github.com/acme/app'], rate: null, ticketPattern: null },
    ],
  }
  test('a worktree outside the folder counts through the repository root', () => {
    expect(attribute(byRepo, '/work/acme.worktrees/x', 'feature/ACME-7-x', { root: '/work/acme', remote: null })).toEqual({ client: 'acme', ticket: 'ACME-7' })
  })
  test('a remote pattern names the client wherever the clone lives', () => {
    expect(attribute(byRepo, '/tmp/clone', 'fix/GH-12', { root: '/tmp/clone', remote: 'git@github.com:GH-Org/Api.git' })).toEqual({ client: 'gh', ticket: 'GH-12' })
  })
  test('the first client in the file wins when two match', () => {
    expect(attribute(byRepo, '/work/acme/api', 'main', { root: '/work/acme', remote: 'https://github.com/acme/app' })).toEqual({ client: 'acme', ticket: null })
  })
  test('no repository, or none that matches: folder only, as before', () => {
    expect(attribute(byRepo, '/work/acme.worktrees/x', 'feature/ACME-7-x')).toEqual({ client: null, ticket: null })
    expect(attribute(byRepo, '/work/acme.worktrees/x', 'main', null)).toEqual({ client: null, ticket: null })
    expect(attribute(byRepo, '/elsewhere', 'main', { root: '/elsewhere', remote: 'https://gitlab.com/x/y' })).toEqual({ client: null, ticket: null })
  })
})

describe('parseRules repos', () => {
  test('repos is kept when given, and absent when not', () => {
    const r = parseRules('{"v":1,"clients":[{"id":"a","name":"A","paths":[],"repos":["github.com/a/*"]},{"id":"b","name":"B","paths":["/b/**"]}]}')
    expect(r.ok && r.rules.clients[0].repos).toEqual(['github.com/a/*'])
    expect(r.ok && 'repos' in r.rules.clients[1]).toBe(false)
  })
  test('rejects repos that is not a list of text', () => {
    const r = parseRules('{"v":1,"clients":[{"id":"a","name":"A","paths":[],"repos":"github.com/a"}]}')
    expect(r.ok ? '' : r.error).toMatch(/clients\[0\]\.repos must be a list of text/)
  })
})
