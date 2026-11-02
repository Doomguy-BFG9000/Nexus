import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const pane = (bodyColumns: number, placement: 'dock' | 'inline' = 'dock') =>
  ({
    plugin: 'swarm-ui',
    component: 'Pane',
    requestId: 'swarm',
    surface: 'terminal',
    props: {
      title: 'swarm',
      isFocused: false,
      bodyColumns,
      placement,
      scroll: { offset: 0, bodyRows: 46 },
      view: {},
    },
  }) as const

// Everything beneath the plugin stands for the engine.
function engine(on: On) {
  mock.clock(on)
  mock.env(on, { HOME: '/home/test' })
  on('settings.read', () => ({ value: { advisorModel: 'opus' } }))
  on('fs.read', () => {
    throw new Error('no agent definition here')
  })
  on('command.register', () => ({ value: { command: 'swarm' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'agent-1' }))
}

test('the full layout draws every region, with N/A for what was never reported', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(pane(90))
  expect(await ui.find({ type: 'Text', text: /advisor · on call/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /main session/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /fork layer/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /review \+ verify/ })).toBeTruthy()
  // Nothing reported yet: no invented numbers.
  expect(await ui.find({ type: 'Text', text: /N\/A/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /idle/ })).toBeTruthy()
  await ui.unmount()
})

test('a spawned subagent gets a box from the real spawn event', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({
    tool_use_id: 'toolu_1',
    prompt: 'map the repo',
    description: 'maps the repo',
    subagentType: 'swarm-search',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-sonnet-5-5',
    background: false,
    fork: false,
  })

  for (const width of [90, 60]) {
    const ui = await $.ui.mount(pane(width))
    expect(await ui.find({ type: 'Text', text: /^search$/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /haiku 5\.5/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /running/ })).toBeTruthy()
    await ui.unmount()
  }
})

test('an inline pane falls back to the one-line list', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(pane(120, 'inline'))
  expect(await ui.find({ type: 'Text', text: /fork layer/ })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: /advisor 0/ })).toBeTruthy()
  await ui.unmount()
})
