// Reads the colour tokens of a stylesheet: the first `:root { … }` (light), the `:root` inside
// `@media (prefers-color-scheme: dark)` and the one inside `@media print`.
export type Tokens = Map<string, string>

function rootBlock(css: string, marker: string | null): string {
  const from = marker === null ? 0 : css.indexOf(marker)
  if (from < 0) return ''
  const start = css.indexOf(':root', from)
  if (start < 0) return ''
  const open = css.indexOf('{', start)
  return css.slice(open + 1, css.indexOf('}', open))
}

function decls(block: string): Tokens {
  const out: Tokens = new Map()
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) out.set(m[1], m[2].trim())
  return out
}

export function themes(css: string): { light: Tokens; dark: Tokens; print: Tokens } {
  return {
    light: decls(rootBlock(css, null)),
    dark: decls(rootBlock(css, '@media (prefers-color-scheme: dark)')),
    print: decls(rootBlock(css, '@media print')),
  }
}

const channel = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map(i => channel(parseInt(h.slice(i, i + 2), 16) / 255))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio of two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** The text of the first <style> element. */
export function styleOf(html: string): string {
  const m = /<style>([\s\S]*?)<\/style>/.exec(html)
  if (!m) throw new Error('no <style> element')
  return m[1]
}
