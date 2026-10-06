import { parseEventLines, serializeLine } from '../core/lines.ts'
import type { EventKind, EventLine } from '../core/types.ts'
import { readRules } from './files.ts'
import { readBranch } from './git.ts'
import { homeDir, type RecorderEngine } from './paths.ts'

export type Recorder = {
  record($: RecorderEngine, kind: EventKind, extra?: Partial<EventLine>): Promise<EventLine | null>
  failed(): boolean
  sessionLines(sid: string): EventLine[]
}

export function createRecorder(): Recorder {
  const buffers = new Map<string, string[]>()
  let chain: Promise<unknown> = Promise.resolve()
  let failed = false
  let toasted = false

  const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
    const run = chain.then(job, job)
    chain = run.catch(() => undefined)
    return run
  }

  async function write($: RecorderEngine, kind: EventKind, extra: Partial<EventLine>): Promise<EventLine> {
    const home = await homeDir($)
    const sid = await $.session.id()
    const path = `${home}/events/${sid}.jsonl`
    if (!buffers.has(sid)) {
      let existing: string[] = []
      try {
        existing = (await $.fs.read(path)).split(/\r?\n/).filter(l => l.trim() !== '')
      } catch (err) {
        // Only a missing file starts an empty buffer; any other failure (EBUSY, EPERM) must not truncate the file.
        if (await $.fs.exists(path)) throw err
      }
      buffers.set(sid, existing)
    }
    const rules = await readRules($, home)
    const tz = rules.ok && rules.rules.tzOffsetMinutes !== null ? rules.rules.tzOffsetMinutes : -new Date().getTimezoneOffset()
    const line: EventLine = { v: 1, ts: new Date(await $.clock.now()).toISOString(), tz, sid, kind, cwd: await $.session.cwd(), branch: await readBranch($), ...extra }
    const buffer = buffers.get(sid)!
    buffer.push(serializeLine(line))
    await $.fs.write(path, buffer.join('\n') + '\n')
    return line
  }

  return {
    record: ($, kind, extra = {}) => enqueue(async () => {
      try {
        const line = await write($, kind, extra)
        failed = false
        return line
      } catch (err) {
        failed = true
        try {
          await $.ui.status('⏱ !')
          if (!toasted) { toasted = true; await $.ui.toast(`hourslip could not record time: ${err instanceof Error ? err.message : String(err)}`) }
        } catch { /* the display is best effort */ }
        return null
      }
    }),
    failed: () => failed,
    sessionLines: sid => parseEventLines((buffers.get(sid) ?? []).join('\n')).lines,
  }
}
