import { atom, read, update, type Register } from 'claude-code'
import { errorText, runCommand } from './io/commands.ts'
import { installRecorder } from './io/install.ts'
import { createRecorder } from './io/recorder.ts'
import { refreshStatus } from './io/status.ts'

const PANE = 'hourslip-week'
const pane = atom({ plugin: 'hourslip', key: 'pane' } as const, { lines: [] as string[] })

export const register: Register = on => {
  const recorder = createRecorder()
  installRecorder(on, recorder)
  on('command.run', { command: 'hourslip' }, async ($, e, next) => {
    let reply: string
    try {
      const { text, openPane, pane: shown } = await runCommand({
        env: { hourslipHome: () => $.env.get('HOURSLIP_HOME'), home: () => $.env.get('HOME'), userProfile: () => $.env.get('USERPROFILE'), server: () => $.env.get('HOURSLIP_SERVER'), os: () => $.env.get('OS'), claudeConfigDir: () => $.env.get('CLAUDE_CONFIG_DIR') },
        session: { id: () => $.session.id(), cwd: () => $.session.cwd(), repo: () => $.session.repo() },
        fs: { read: p => $.fs.read(p), write: (p, t) => $.fs.write(p, t), exists: p => $.fs.exists(p), list: p => $.fs.list(p), stat: p => $.fs.stat(p) },
        clock: { now: () => $.clock.now() },
        ui: { status: t => $.ui.status(t), toast: t => $.ui.toast(t), copy: async t => (await $.ui.copy({ text: t })).isCopied === true },
        process: { run: (argv, init) => $.process.run(argv, init), spawn: req => $.process.spawn(req) },
        http: { fetch: (u, i) => $.http.fetch(u, i) },
        store: { get: k => $.store.get(k), set: (k, v) => $.store.set(k, v), delete: k => $.store.delete(k) },
        // The hook's own time left (the clock stands still during each $ call): the import stops scanning before it runs out.
        budget: () => next.budget.remainingMs,
      }, recorder, e.args)
      if (openPane) {
        await update($, pane, () => ({ lines: shown?.lines ?? text.split('\n') }))
        await $.ui.open({ id: PANE, title: shown?.title ?? 'hourslip · this week' })
      }
      reply = text
    } catch (err) {
      reply = errorText(err)
    }
    // A command can change today's total (add, tag): redraw now, not at the next prompt. Never throws.
    await refreshStatus({
      env: { hourslipHome: () => $.env.get('HOURSLIP_HOME'), home: () => $.env.get('HOME'), userProfile: () => $.env.get('USERPROFILE'), server: () => $.env.get('HOURSLIP_SERVER'), os: () => $.env.get('OS') },
      session: { id: () => $.session.id(), cwd: () => $.session.cwd(), repo: () => $.session.repo() },
      fs: { read: p => $.fs.read(p), list: p => $.fs.list(p) },
      clock: { now: () => $.clock.now() },
      ui: { status: t => $.ui.status(t) },
    }, recorder)
    return { text: reply }
  })
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const { lines } = await read($, pane)
    return <Box flexDirection="column">{lines.map((l, i) => <Text key={`l${i}`} dimColor={l.startsWith('Week of') || l === 'Published'}>{l}</Text>)}</Box>
  })
}
