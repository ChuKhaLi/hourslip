import { localDate } from '../core/dates.ts'
import { currentAttribution } from '../core/presence.ts'
import { DEFAULT_RULES } from '../core/rules.ts'
import { statusText } from '../core/summary.ts'
import { buildTimesheet } from '../core/timesheet.ts'
import { readManual, readRules, readSessions } from './files.ts'
import { readBranch } from './git.ts'
import { homeDir, type StatusEngine } from './paths.ts'
import type { Recorder } from './recorder.ts'

/** Draws today's billable time. Best effort: never throws, and leaves `⏱ !` alone while recording is failing. */
export async function refreshStatus(engine: StatusEngine, recorder: Recorder): Promise<void> {
  if (recorder.failed()) return
  try {
    const home = await homeDir(engine)
    const r = await readRules(engine, home)
    const rules = r.ok ? r.rules : DEFAULT_RULES
    const now = await engine.clock.now()
    const tz = rules.tzOffsetMinutes ?? -new Date().getTimezoneOffset()
    const today = localDate(now, tz)
    const { sessions } = await readSessions(engine, home, now - 2 * 86_400_000)
    const manual = (await readManual(engine, home)).lines
    const ts = buildTimesheet({ sessions, manual, rules, from: today, to: today })
    const sid = await engine.session.id()
    const attr = currentAttribution(recorder.sessionLines(sid), rules, await engine.session.cwd(), await readBranch(engine), now)
    engine.ui.status(statusText(ts, rules, attr, today))
  } catch {
    // The status line is best effort; recording is what matters.
  }
}
