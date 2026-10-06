import { atom, read, update, type Register } from 'claude-code'
import { errorText, runCommand } from './io/commands.ts'
import { installRecorder } from './io/install.ts'
import { createRecorder } from './io/recorder.ts'

const PANE = 'hourslip-week'
const pane = atom({ plugin: 'hourslip', key: 'pane' } as const, { lines: [] as string[] })

export const register: Register = on => {
  const recorder = createRecorder()
  installRecorder(on, recorder)
  on('command.run', { command: 'hourslip' }, async ($, e) => {
    try {
      const { text, openPane } = await runCommand({
        env: { hourslipHome: () => $.env.get('HOURSLIP_HOME'), home: () => $.env.get('HOME'), userProfile: () => $.env.get('USERPROFILE') },
        session: { id: () => $.session.id(), cwd: () => $.session.cwd(), repo: () => $.session.repo() },
        fs: { read: p => $.fs.read(p), write: (p, t) => $.fs.write(p, t), exists: p => $.fs.exists(p), list: p => $.fs.list(p) },
        clock: { now: () => $.clock.now() },
        ui: { status: t => $.ui.status(t), toast: t => $.ui.toast(t) },
        process: { run: (argv, init) => $.process.run(argv, init) },
      }, recorder, e.args)
      if (openPane) {
        await update($, pane, () => ({ lines: text.split('\n') }))
        await $.ui.open({ id: PANE, title: 'hourslip · this week' })
      }
      return { text }
    } catch (err) {
      return { text: errorText(err) }
    }
  })
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const { lines } = await read($, pane)
    return <Box flexDirection="column">{lines.map((l, i) => <Text key={`l${i}`} dimColor={l.startsWith('Week of')}>{l}</Text>)}</Box>
  })
}
