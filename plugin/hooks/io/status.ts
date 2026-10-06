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
export async function refreshStatus($: StatusEngine, recorder: Recorder): Promise<void> {
  if (recorder.failed()) return
  try {
    const home = await homeDir($)
    const r = await readRules($, home)
    const rules = r.ok ? r.rules : DEFAULT_RULES
    const now = await $.clock.now()
    const tz = rules.tzOffsetMinutes ?? -new Date().getTimezoneOffset()
    const today = localDate(now, tz)
    const { sessions } = await readSessions($, home, now - 2 * 86_400_000)
    const manual = (await readManual($, home)).lines
    const ts = buildTimesheet({ sessions, manual, rules, from: today, to: today })
    const sid = await $.session.id()
    const attr = currentAttribution(recorder.sessionLines(sid), rules, await $.session.cwd(), await readBranch($), now)
    $.ui.status(statusText(ts, rules, attr, today))
  } catch {
    // The status line is best effort; recording is what matters.
  }
}
