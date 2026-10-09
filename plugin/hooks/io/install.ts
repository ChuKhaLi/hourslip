import type { On } from 'claude-code'
import type { Recorder } from './recorder.ts'
import { refreshStatus } from './status.ts'

/**
 * The recording hooks. `claude plugin validate` refuses a hook that passes `$` itself to a helper,
 * so each hook hands the recorder closures (only the ports it uses), each one spelling a single `$.noun.method(...)` call.
 * Also, a hook must be a function literal (or the name of one), so no hook factory.
 */
export function installRecorder(on: On, recorder: Recorder): void {

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    try { await $.command.register({ name: 'hourslip', description: 'hourslip: billable hours per client and ticket' }) } catch { /* never block */ }
    await recorder.record({
      env: { hourslipHome: () => $.env.get('HOURSLIP_HOME'), home: () => $.env.get('HOME'), userProfile: () => $.env.get('USERPROFILE'), server: () => $.env.get('HOURSLIP_SERVER'), os: () => $.env.get('OS') },
      session: { id: () => $.session.id(), cwd: () => $.session.cwd(), repo: () => $.session.repo() },
      fs: { read: p => $.fs.read(p), write: (p, t) => $.fs.write(p, t), exists: p => $.fs.exists(p) },
      clock: { now: () => $.clock.now() },
      ui: { status: t => $.ui.status(t), toast: t => $.ui.toast(t), copy: async t => (await $.ui.copy({ text: t })).isCopied === true },
    }, 'start')
    await refreshStatus({
      env: { hourslipHome: () => $.env.get('HOURSLIP_HOME'), home: () => $.env.get('HOME'), userProfile: () => $.env.get('USERPROFILE'), server: () => $.env.get('HOURSLIP_SERVER'), os: () => $.env.get('OS') },
      session: { id: () => $.session.id(), cwd: () => $.session.cwd(), repo: () => $.session.repo() },
      fs: { read: p => $.fs.read(p), list: p => $.fs.list(p) },
      clock: { now: () => $.clock.now() },
      ui: { status: t => $.ui.status(t) },
    }, recorder)
    return result
  })
  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    await recorder.record({
      env: { hourslipHome: () => $.env.get('HOURSLIP_HOME'), home: () => $.env.get('HOME'), userProfile: () => $.env.get('USERPROFILE'), server: () => $.env.get('HOURSLIP_SERVER'), os: () => $.env.get('OS') },
      session: { id: () => $.session.id(), cwd: () => $.session.cwd(), repo: () => $.session.repo() },
      fs: { read: p => $.fs.read(p), write: (p, t) => $.fs.write(p, t), exists: p => $.fs.exists(p) },
      clock: { now: () => $.clock.now() },
      ui: { status: t => $.ui.status(t), toast: t => $.ui.toast(t), copy: async t => (await $.ui.copy({ text: t })).isCopied === true },
    }, 'prompt')
    await refreshStatus({
      env: { hourslipHome: () => $.env.get('HOURSLIP_HOME'), home: () => $.env.get('HOME'), userProfile: () => $.env.get('USERPROFILE'), server: () => $.env.get('HOURSLIP_SERVER'), os: () => $.env.get('OS') },
      session: { id: () => $.session.id(), cwd: () => $.session.cwd(), repo: () => $.session.repo() },
      fs: { read: p => $.fs.read(p), list: p => $.fs.list(p) },
      clock: { now: () => $.clock.now() },
      ui: { status: t => $.ui.status(t) },
    }, recorder)
    return result
  }).catch(($, e, next) => next(e)) // Recording never refuses a prompt: a failed hook lets it through (next replays when already called).
  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    await recorder.record({
      env: { hourslipHome: () => $.env.get('HOURSLIP_HOME'), home: () => $.env.get('HOME'), userProfile: () => $.env.get('USERPROFILE'), server: () => $.env.get('HOURSLIP_SERVER'), os: () => $.env.get('OS') },
      session: { id: () => $.session.id(), cwd: () => $.session.cwd(), repo: () => $.session.repo() },
      fs: { read: p => $.fs.read(p), write: (p, t) => $.fs.write(p, t), exists: p => $.fs.exists(p) },
      clock: { now: () => $.clock.now() },
      ui: { status: t => $.ui.status(t), toast: t => $.ui.toast(t), copy: async t => (await $.ui.copy({ text: t })).isCopied === true },
    }, 'turn-start', { turn: e.turnId })
    await refreshStatus({
      env: { hourslipHome: () => $.env.get('HOURSLIP_HOME'), home: () => $.env.get('HOME'), userProfile: () => $.env.get('USERPROFILE'), server: () => $.env.get('HOURSLIP_SERVER'), os: () => $.env.get('OS') },
      session: { id: () => $.session.id(), cwd: () => $.session.cwd(), repo: () => $.session.repo() },
      fs: { read: p => $.fs.read(p), list: p => $.fs.list(p) },
      clock: { now: () => $.clock.now() },
      ui: { status: t => $.ui.status(t) },
    }, recorder)
    return result
  })
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await recorder.record({
      env: { hourslipHome: () => $.env.get('HOURSLIP_HOME'), home: () => $.env.get('HOME'), userProfile: () => $.env.get('USERPROFILE'), server: () => $.env.get('HOURSLIP_SERVER'), os: () => $.env.get('OS') },
      session: { id: () => $.session.id(), cwd: () => $.session.cwd(), repo: () => $.session.repo() },
      fs: { read: p => $.fs.read(p), write: (p, t) => $.fs.write(p, t), exists: p => $.fs.exists(p) },
      clock: { now: () => $.clock.now() },
      ui: { status: t => $.ui.status(t), toast: t => $.ui.toast(t), copy: async t => (await $.ui.copy({ text: t })).isCopied === true },
    }, 'turn-end', { turn: e.turnId, ...(e.agentId ? { agent: e.agentId } : {}) })
    await refreshStatus({
      env: { hourslipHome: () => $.env.get('HOURSLIP_HOME'), home: () => $.env.get('HOME'), userProfile: () => $.env.get('USERPROFILE'), server: () => $.env.get('HOURSLIP_SERVER'), os: () => $.env.get('OS') },
      session: { id: () => $.session.id(), cwd: () => $.session.cwd(), repo: () => $.session.repo() },
      fs: { read: p => $.fs.read(p), list: p => $.fs.list(p) },
      clock: { now: () => $.clock.now() },
      ui: { status: t => $.ui.status(t) },
    }, recorder)
    return result
  })
  // Records before next(e): the session is gone afterwards and has only a short budget.
  on('session.end', async ($, e, next) => {
    await recorder.record({
      env: { hourslipHome: () => $.env.get('HOURSLIP_HOME'), home: () => $.env.get('HOME'), userProfile: () => $.env.get('USERPROFILE'), server: () => $.env.get('HOURSLIP_SERVER'), os: () => $.env.get('OS') },
      session: { id: () => $.session.id(), cwd: () => $.session.cwd(), repo: () => $.session.repo() },
      fs: { read: p => $.fs.read(p), write: (p, t) => $.fs.write(p, t), exists: p => $.fs.exists(p) },
      clock: { now: () => $.clock.now() },
      ui: { status: t => $.ui.status(t), toast: t => $.ui.toast(t), copy: async t => (await $.ui.copy({ text: t })).isCopied === true },
    }, 'end')
    return next(e)
  })
}
