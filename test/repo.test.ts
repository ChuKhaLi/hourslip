import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

// With core.autocrlf=true a CRLF checkout turns '#!/usr/bin/env node' into 'node\r', which Vitest's
// transform rejects ("Invalid or unexpected token"). Every tracked script with a shebang stays LF.
test('every tracked script with a shebang is checked out with LF line endings', () => {
  const files = execFileSync('git', ['ls-files', '*.mjs', '*.js', '*.ts'], { encoding: 'utf8' }).split('\n').filter(Boolean)
    .filter(f => readFileSync(f, 'utf8').startsWith('#!'))
  expect(files.length).toBeGreaterThan(0)
  for (const f of files) expect(execFileSync('git', ['check-attr', 'eol', '--', f], { encoding: 'utf8' }).trim(), f).toBe(`${f}: eol: lf`)
})
