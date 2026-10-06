import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { SITE } from '../../scripts/build-site.mjs'
import { contrast, themes } from '../helpers/css.ts'

const CSS = readFileSync(join(SITE, 'style.v1.css'), 'utf8')
const TOKENS = ['--paper', '--sheet', '--ink', '--muted', '--rule', '--accent', '--button', '--on-button',
  '--term-bg', '--term-bar', '--term-fg', '--term-dim', '--status-bg', '--status-fg', '--focus']
// [foreground, background, floor]: 4.5 for text, 3 for the focus ring.
const PAIRS: [string, string, number][] = [
  ['--ink', '--paper', 4.5], ['--ink', '--sheet', 4.5], ['--muted', '--paper', 4.5], ['--muted', '--sheet', 4.5],
  ['--accent', '--paper', 4.5], ['--accent', '--sheet', 4.5], ['--on-button', '--button', 4.5],
  ['--term-fg', '--term-bg', 4.5], ['--term-dim', '--term-bg', 4.5], ['--term-dim', '--term-bar', 4.5],
  ['--status-fg', '--status-bg', 4.5], ['--focus', '--paper', 3],
]

test('every token is defined in light, dark and print', () => {
  const t = themes(CSS)
  for (const [name, theme] of Object.entries(t)) for (const k of TOKENS) expect(theme.has(k), `${name} ${k}`).toBe(true)
})
test('the spec §5.1 values hold', () => {
  const t = themes(CSS)
  expect(t.light.get('--paper')).toBe('#f6f1e7'); expect(t.dark.get('--paper')).toBe('#1a1712')
  expect(t.light.get('--ink')).toBe('#2a2419'); expect(t.dark.get('--ink')).toBe('#ece4d4')
  expect(t.light.get('--accent')).toBe('#7a5c2e'); expect(t.dark.get('--accent')).toBe('#e9b44c')
  expect(t.light.get('--status-fg')).toBe('#e9b44c')
})
test('every pair clears its floor in light and dark', () => {
  const t = themes(CSS)
  for (const theme of [t.light, t.dark]) for (const [fg, bg, floor] of PAIRS) {
    expect(contrast(theme.get(fg)!, theme.get(bg)!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(floor)
  }
})
test('print is light: white paper, black ink (Review Focus 1)', () => {
  const t = themes(CSS)
  expect(t.print.get('--paper')).toBe('#ffffff'); expect(t.print.get('--ink')).toBe('#000000')
})
test('colours appear only in custom-property declarations', () => {
  const stray = CSS.split('\n').filter(l => /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(l) && !/^\s*--[\w-]+\s*:/.test(l))
  expect(stray).toEqual([])
})
test('long commands and terminal lines wrap instead of scrolling the page (Review Focus 2)', () => {
  for (const sel of ['.install', '.term-body', '.term-bar', '.term-status']) {
    expect(CSS, sel).toMatch(new RegExp(`\\${sel}\\{[^}]*overflow-wrap:anywhere`))
  }
})
test('fonts swap in, every stack ends in a generic family, and every font file exists (Review Focus 4)', () => {
  const faces = [...CSS.matchAll(/@font-face\{[^}]*\}/g)].map(m => m[0])
  expect(faces.length).toBe(3)
  for (const f of faces) expect(f).toContain('font-display:swap')
  // Outside @font-face, every font stack that names a font ends in a generic family.
  const rules = CSS.replace(/@font-face\{[^}]*\}/g, '')
  for (const m of rules.matchAll(/font(?:-family)?:[^;}]*?(['"][^;}]*)[;}]/g)) expect(m[0], m[0]).toMatch(/(serif|monospace)[;}]$/)
  for (const m of CSS.matchAll(/url\((\/fonts\/[^)]+)\)/g)) expect(existsSync(join(SITE, m[1])), m[1]).toBe(true)
})
