import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const pane = (bodyColumns: number) =>
  ({
    plugin: 'swarm-ui',
    component: 'Pane',
    requestId: 'swarm',
    surface: 'terminal',
    props: {
      title: 'swarm',
      isFocused: false,
      bodyColumns,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 46 },
      view: {},
    },
  }) as const

let reads = 0

function engine(on: On, opts: { reduceMotion?: boolean } = {}) {
  const clock = mock.clock(on, { now: 1_000_000 })
  reads = 0
  // Every frame writes the tick: counting those writes counts frames.
  on('state.set', ($, e, next) => {
    if (JSON.stringify(e).includes('"tick"')) reads++
    return next(e)
  })
  mock.env(on, { HOME: '/home/test' })
  on('settings.read', () => ({ value: { advisorModel: 'opus' } }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('config.list', () => ({
    value: [{ key: 'reduceMotion', label: 'Reduce motion', kind: 'boolean', value: opts.reduceMotion === true, provider: 'engine' as any, isLocked: false }],
  }))
  on('process.run', () => ({ value: { exitCode: 44, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.read', () => {
    throw new Error('no agent definition here')
  })
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'agent-1' }))
  on('classic.SubagentStop', () => ({}))
  // The first check is put to the person; after their yes the call is allowed.
  let checks = 0
  on('tool.check', () => ({ decision: checks++ === 0 ? ('ask' as const) : ('allow' as const) }))
  on('tool.call', () => ({ result: { ok: true } }))
  on('turn.step', async function* (_, e) {
    const at = await Promise.resolve(1_000_000)
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: { model: e.model, input_tokens: 90_000, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      serverToolUses: e.index === 0 ? [{ id: 'srv-1', name: 'advisor', input: {}, startedAt: at, endedAt: at + 7000 }] : undefined,
    }
  })
  return clock
}

async function start($: any) {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
}

async function stepWithAdvisor($: any) {
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-sonnet-5-5', effort: 'high', messageCount: 1 })
  for await (const _ of stream) {
    // drain
  }
}

async function ticks(_: any): Promise<number> {
  return reads
}

async function text($: any, width = 90): Promise<string> {
  const ui = await $.ui.mount(pane(width))
  const found = await ui.findAll({ type: 'Text' })
  await ui.unmount()
  return found.map((n: any) => n.text ?? '').join('\n')
}

test('an advisor call pulses the advisor, then the pane returns to on call', async ($, on) => {
  const clock = engine(on)
  await start($)
  await stepWithAdvisor($)
  const ui = await $.ui.mount(pane(90))
  expect(await ui.find({ type: 'Text', text: /◆ consulted/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /reported just now/ })).toBeTruthy()
  await ui.unmount()
  await clock.advance(7000) // two cycles of the wide Dual-Orbit
  const after = await $.ui.mount(pane(90))
  expect(await after.find({ type: 'Text', text: /◇ on call/ })).toBeTruthy()
  expect(await after.find({ type: 'Text', text: /consulted|reported just now/ })).toBeFalsy()
  expect(await after.find({ type: 'Text', text: /^7s ago$/ })).toBeTruthy()
  await after.unmount()
})

test('the frame timer runs ~10 FPS while an effect plays and stops when idle', async ($, on) => {
  const clock = engine(on)
  await start($)
  const t0 = await ticks($)
  await stepWithAdvisor($)
  await clock.advance(1000)
  const during = (await ticks($)) - t0
  expect(during).toBeGreaterThanOrEqual(8)
  expect(during).toBeLessThanOrEqual(12)
  await clock.advance(9000) // the pulse and the fresh log row are long over
  const idle = await ticks($)
  await clock.advance(10_000)
  expect(await ticks($)).toBe(idle)
})

test('reduced motion: no movement, at most one redraw a second, still stops when idle', async ($, on) => {
  const clock = engine(on, { reduceMotion: true })
  await start($)
  const t0 = await ticks($)
  await stepWithAdvisor($)
  await clock.advance(2000)
  expect((await ticks($)) - t0).toBeLessThanOrEqual(3)
  await clock.advance(5000)
  const idle = await ticks($)
  await clock.advance(10_000)
  expect(await ticks($)).toBe(idle)
})

test('the lead heartbeat stops while a permission dialog waits, and resumes after', async ($, on) => {
  const clock = engine(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  expect(await text($)).toMatch(/working 0s/)
  const verdict = await $.tool.check({ tool: 'Write', file_path: '/x', content: '' } as any)
  expect(verdict.decision).toBe('ask') // passed up unchanged
  expect(await text($)).toMatch(/waiting for you/)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await clock.advance(2000)
  expect(await text($)).toMatch(/working 2s/)
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 2000, isAborted: false, reason: 'answer' })
  expect(await text($)).toMatch(/idle · \d+ steps/)
})

test('a spawned Haiku agent animates in, runs, and flashes done', async ($, on) => {
  const clock = engine(on)
  await start($)
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
  expect(await text($)).toMatch(/running 0s/)
  await clock.advance(4000)
  await $.classic.SubagentStop({ agent_id: 'agent-1', agent_type: 'swarm-search', stop_hook_active: false, agent_transcript_path: '' })
  expect(await text($)).toMatch(/✓ done 4s/)
  // The log names the event with its own icon.
  const band = await $.ui.mount({
    plugin: 'swarm-ui',
    component: 'AbovePrompt',
    surface: 'terminal',
    props: { bodyColumns: 120, maxRows: 12, hasSurvey: false, view: {} },
  } as any)
  expect(await band.find({ type: 'Text', text: /^✓ $/ })).toBeTruthy()
  expect(await band.find({ type: 'Text', text: /^▸ $/ })).toBeTruthy()
  await band.unmount()
})

test('resizing redraws the same state at every breakpoint', async ($, on) => {
  engine(on)
  await start($)
  await stepWithAdvisor($)
  for (const width of [40, 60, 90, 120]) {
    const all = await text($, width)
    expect(all).toMatch(/sonnet 5\.5/)
    expect(all).toMatch(/advis/)
  }
})
