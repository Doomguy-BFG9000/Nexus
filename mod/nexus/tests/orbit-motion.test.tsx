import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const pane = (bodyColumns: number) =>
  ({
    plugin: 'nexus',
    component: 'Pane',
    requestId: 'nexus',
    surface: 'terminal',
    props: {
      title: 'NEXUS',
      isFocused: false,
      bodyColumns,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 46 },
      view: {},
    },
  }) as const

let reads = 0

function engine(on: On, opts: { reduceMotion?: boolean; prefs?: Record<string, unknown> } = {}) {
  const clock = mock.clock(on, { now: 1_000_000 })
  reads = 0
  // Every frame writes the tick: counting those writes counts frames.
  on('state.set', ($, e, next) => {
    if (JSON.stringify(e).includes('"tick"')) reads++
    return next(e)
  })
  mock.env(on, { HOME: '/home/test' })
  mock.store(on, { prefs: { version: 4, theme: 'orbit', ...(opts.prefs ?? {}) } })
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


async function text($: any, width = 100): Promise<string> {
  const ui = await $.ui.mount(pane(width))
  const found = await ui.findAll({ type: 'Text' })
  await ui.unmount()
  return found.map((n: any) => n.text ?? '').join('\n')
}
const hole = (t: string) => (t.match(/[\u2800-\u28ff]+/g) ?? []).join('|')
const finish = ($: any) => $.turn.complete({ turnId: 't1', answer: '', durationMs: 2000, isAborted: false, reason: 'answer' })

test('Orbit: about four redraws a second while the lead works, and none when it stops', async ($, on) => {
  const clock = engine(on)
  await start($)
  const t0 = reads
  await $.turn.start({ text: 'go', turnId: 't1' })
  await clock.advance(4000)
  const during = reads - t0
  // 4 a second, against Classic's 10: the black hole drifts, it does not need more.
  expect(during).toBeGreaterThanOrEqual(14)
  expect(during).toBeLessThanOrEqual(18)
  await finish($)
  await clock.advance(5000) // the last log rows are no longer fresh
  const idle = reads
  await clock.advance(30_000)
  expect(reads).toBe(idle)
})

test('Orbit: idle costs nothing: a long idle stretch writes no frames', async ($, on) => {
  const clock = engine(on)
  await start($)
  await clock.advance(5000) // startup's own few frames are over
  const t0 = reads
  await clock.advance(120_000)
  expect(reads).toBe(t0)
})

test('Orbit: the black hole moves while work runs and stands still afterwards', async ($, on) => {
  const clock = engine(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  const a = hole(await text($))
  await clock.advance(6000)
  const b = hole(await text($))
  expect(a).not.toBe(b)
  await finish($)
  await clock.advance(5000)
  const c = hole(await text($))
  await clock.advance(10_000)
  // Re-drawn later with no timer running: drawn from the clock, but nothing redraws it by itself.
  expect(reads).toBeGreaterThan(0)
  expect(c.length).toBeGreaterThan(100)
})

test('Orbit: reduced motion draws one still hole and redraws at most once a second', async ($, on) => {
  const clock = engine(on, { reduceMotion: true })
  await start($)
  const t0 = reads
  await $.turn.start({ text: 'go', turnId: 't1' })
  const a = hole(await text($))
  await clock.advance(5000)
  expect(reads - t0).toBeLessThanOrEqual(7)
  expect(hole(await text($))).toBe(a)
})

test('Orbit: animation off runs no timer at all, and the hole is still', async ($, on) => {
  const clock = engine(on, { prefs: { animation: 'off' } })
  await start($)
  const t0 = reads
  await $.turn.start({ text: 'go', turnId: 't1' })
  const a = hole(await text($))
  await clock.advance(10_000)
  expect(reads).toBe(t0)
  expect(hole(await text($))).toBe(a)
})

test('Orbit: with the graphic off nothing but the text changes, and the timer is the same', async ($, on) => {
  const clock = engine(on, { prefs: { centerpiece: 'off' } })
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  expect(hole(await text($))).toBe('')
  const t0 = reads
  await clock.advance(2000)
  expect(reads - t0).toBeLessThanOrEqual(9)
})

test('Classic keeps its own ten frames a second', async ($, on) => {
  const clock = engine(on, { prefs: { theme: 'classic', version: 3 } })
  await start($)
  const t0 = reads
  await $.turn.start({ text: 'go', turnId: 't1' })
  await clock.advance(1000)
  expect(reads - t0).toBeGreaterThanOrEqual(8)
  expect(reads - t0).toBeLessThanOrEqual(12)
})
