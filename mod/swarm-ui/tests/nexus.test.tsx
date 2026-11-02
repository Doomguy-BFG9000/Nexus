import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { HELP } from '../hooks/docs'
import { nexusLogo, plain } from '../hooks/orbit'
import { COMMANDS } from '../hooks/register'

const pane = (isFocused = false) =>
  ({ plugin: 'swarm-ui', component: 'Pane', requestId: 'swarm', surface: 'terminal', props: { title: 'NEXUS', isFocused, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } }) as const

function engine(on: On, surface: 'terminal' | null = 'terminal') {
  const clock = mock.clock(on, { now: 7_000_000 })
  const registered: string[] = []
  const placed: string[] = []
  mock.env(on, { HOME: '/home/test' })
  mock.store(on, {})
  on('settings.read', () => ({ value: { advisorModel: 'opus', tui: 'fullscreen' } }))
  on('session.id', () => ({ value: 's' }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('session.surface', () => ({ value: surface }))
  on('session.version', () => ({ value: { version: '2.1.316' } as any }))
  on('config.list', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 44, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.read', () => {
    throw new Error('none')
  })
  on('fs.exists', (_, e) => ({ value: e.path.endsWith('swarm-search.md') }))
  on('command.register', (_, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [{ id: 'swarm' }] as any }))
  on('ui.close', () => ({ value: undefined }) as any)
  on('ui.place', (_, e) => {
    placed.push(e.id)
    return { value: { isPlaced: true, requestId: e.id } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  return { clock, registered, placed }
}

const start = ($: any) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
const run = async ($: any, command: string, args = '') => (await ($ as any).command.run({ command, args })) as { text?: string }
async function texts($: any, props: any): Promise<string> {
  const ui = await $.ui.mount(props)
  const all = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text ?? '').join('\n')
  await ui.unmount()
  return all
}

test('the /nexus commands are registered; /swarm names stay as deprecated aliases', async ($, on) => {
  const w = engine(on)
  await start($)
  expect(w.registered).toEqual(['nexus', 'nexus-mode', 'nexus-jev', 'nexus-help', 'nexus-about', 'swarm', 'swarm-mode', 'swarm-jev'])
  for (const c of COMMANDS.filter(c => c.legacyOf)) expect(c.description).toMatch(/^Deprecated: use \//)
})

test('every command /nexus-help lists is registered, and every /nexus subcommand it lists is handled', async ($, on) => {
  const w = engine(on, null) // text replies, so each one can be read
  await start($)
  for (const row of HELP.flatMap(s => s.rows)) {
    const [name, sub] = row.cmd.slice(1).split(' ')
    expect(w.registered).toContain(name)
    if (name === 'nexus' && sub && !sub.startsWith('[')) {
      const out = await run($, 'nexus', sub === 'layout' ? 'layout auto' : sub === 'width' ? 'width max' : sub)
      expect(out.text ?? '').not.toMatch(/Unknown/)
    }
  }
})

test('a legacy command does the same work and says where it moved', async ($, on) => {
  engine(on, null)
  await start($)
  const now = await run($, 'nexus', 'agents')
  const old = await run($, 'swarm', 'agents')
  expect(old.text).toBe(`${now.text}\n(/swarm is now /nexus; the old name will go away in a later version.)`)
  expect((await run($, 'swarm-mode', 'status')).text).toMatch(/\(\/swarm-mode is now \/nexus-mode;/)
  expect((await run($, 'swarm-jev', 'status')).text).toMatch(/\(\/swarm-jev is now \/nexus-jev;/)
  expect((await run($, 'nexus', 'nonsense')).text).toBe('Unknown "/nexus nonsense". /nexus-help lists every command.')
})

test('/nexus-help and /nexus-about draw in the transcript: mark, wordmark, sections', async ($, on) => {
  const w = engine(on)
  await start($)
  expect(await run($, 'nexus-help')).toEqual({})
  expect(await run($, 'nexus-about')).toEqual({})
  expect(w.placed).toEqual(['help-1', 'about-2'])
  const help = await texts($, { plugin: 'swarm-ui', component: 'Placed', surface: 'terminal', props: { id: 'help-1', plugin: 'swarm-ui' } })
  for (const want of ['N E X U S', 'Multi-agent command center', 'Dashboard', 'Agents', 'Models', 'Telemetry', 'Integrations', 'Help', '/nexus-mode [balanced|deep|max|default|status]', '◉'])
    expect(help).toContain(want)
  expect(help).not.toMatch(/\/swarm /)
  const about = await texts($, { plugin: 'swarm-ui', component: 'Placed', surface: 'terminal', props: { id: 'about-2', plugin: 'swarm-ui' } })
  for (const want of ['What it is', 'Who does the work', 'Modes', 'What the numbers mean', 'Cache Guard', 'Quick start'])
    expect(about).toContain(want)
})

test('where nothing draws, help and about come back as text', async ($, on) => {
  engine(on, null)
  await start($)
  expect((await run($, 'nexus-help')).text).toMatch(/^N E X U S · Multi-agent command center\n\nDashboard\n  \/nexus +open the dashboard/)
  expect((await run($, 'nexus-about')).text).toMatch(/Quick start\n  1\. \/nexus/)
})

test('/nexus doctor checks the install without showing secrets', async ($, on) => {
  engine(on, null)
  await start($)
  const out = (await run($, 'nexus', 'doctor')).text!
  expect(out).toMatch(/^NEXUS doctor/)
  expect(out).toMatch(/✓ Claude Code 2\.1\.316 · NEXUS 0\.5\.0/)
  expect(out).toMatch(/✓ fullscreen TUI: the pane can dock/)
  expect(out).toMatch(/✓ dashboard pane is open/)
  expect(out).toMatch(/! agent definitions: search found, grep missing, audit missing/)
  expect(out).toMatch(/! Jev: no key \(optional/)
})

test('the gear opens settings, which show preferences only: no model or advisor panels', async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount(pane(true))
  expect(await ui.find({ type: 'Button', key: 'gear' } as any)).toBeTruthy()
  await ui.press({ key: 'gear' })
  await ui.unmount()
  const view = await $.ui.mount(pane(true))
  // Choice settings are Select rows while the pane has focus.
  expect(await view.find({ type: 'Select', key: 'set-orbitStyle' } as any)).toBeTruthy()
  expect(await view.find({ type: 'Select', key: 'set-layout' } as any)).toBeTruthy()
  await view.unmount()
  const all = await texts($, pane(true))
  expect(all).toMatch(/settings/)
  expect(all).not.toMatch(/OPUS|opus|advisor|Awaiting consultation/)
})

test('the NEXUS mark moves through the whole turn and is still when idle', async ($, on) => {
  const w = engine(on)
  await start($)
  const header = async () => (await texts($, pane())).split('N E X U S')[0]
  const idle = await header()
  await $.turn.start({ text: 'go', turnId: 't1' })
  await w.clock.advance(400)
  const a = await header()
  await w.clock.advance(700)
  const b = await header()
  expect(a).not.toBe(b)
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
  expect(await header()).toBe(idle)
  // Still form and a moving frame differ; every frame keeps the same footprint.
  expect(plain(nexusLogo(null))).not.toEqual(plain(nexusLogo(300)))
  for (const ms of [0, 500, 1300, 2000, 2500]) expect(plain(nexusLogo(ms)).map(r => r.length)).toEqual([11, 11, 11])
})

test('in the terminal a reply is a NEXUS row: no plugin-id label, the old-name notice dimmed', async ($, on) => {
  const w = engine(on)
  await start($)
  expect(await run($, 'swarm', 'agents')).toEqual({})
  const id = w.placed.at(-1)!
  expect(id).toMatch(/^out-/)
  const row = await texts($, { plugin: 'swarm-ui', component: 'Placed', surface: 'terminal', props: { id, plugin: 'swarm-ui' } })
  expect(row).toMatch(/◉/)
  expect(row).toMatch(/No agents this session yet\./)
  expect(row).toMatch(/\(\/swarm is now \/nexus;/)
  expect(row).not.toMatch(/swarm-ui:/)
})
