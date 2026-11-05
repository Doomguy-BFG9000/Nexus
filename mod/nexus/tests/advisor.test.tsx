import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { CLASSIC, classic } from './classic'

const pane = { plugin: 'nexus', component: 'Pane', requestId: 'nexus', surface: 'terminal', props: { title: 'NEXUS', isFocused: false, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 46 }, view: {} } } as const

function engine(on: On, advisor: () => string | null, stored: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: 2_000_000 })
  mock.store(on, classic(stored))
  mock.env(on, { HOME: '/home/test' })
  on('settings.read', () => ({ value: { advisorModel: advisor() } }))
  on('session.id', () => ({ value: 's' }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('config.list', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 44, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 41_000, window: 200_000, percent: 21 }, rateLimits: [] } as any }))
  let n = 0
  on('turn.step', async function* (_, e) {
    const at = 2_000_000 + n++ * 1000
    return {
      turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const,
      usage: { model: e.model, input_tokens: 1000, output_tokens: 5, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 0 },
      serverToolUses: [{ id: `s${n}`, name: 'advisor', input: {}, startedAt: at, endedAt: at + 4000 }],
    }
  })
  return clock
}

async function text($: any): Promise<string> {
  const ui = await $.ui.mount(pane)
  const all = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text ?? '').join('\n')
  await ui.unmount()
  return all
}

async function step($: any, index: number) {
  const st = $.turn.step({ turnId: 't', index, model: 'claude-sonnet-5-5', effort: 'high', messageCount: 1 })
  for await (const _ of st) {
    // drain
  }
}

test('no consultation yet: the empty state, and none of the old explanations', async ($, on) => {
  engine(on, () => 'opus')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const all = await text($)
  expect(all).toMatch(/OPUS 5\.5/)
  expect(all).toMatch(/Awaiting consultation\./)
  for (const gone of [/before a plan/, /reads the whole/, /silent on every/, /never writes/, /before done/]) expect(all).not.toMatch(gone)
})

test('council off: the original panel counts consultations with duration, context and a short history; cost stays N/A', async ($, on) => {
  const clock = engine(on, () => 'opus', { prefs: { version: 3, council: { activation: 'off' } } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (let i = 0; i < 3; i++) await step($, i)
  await clock.advance(65_000)
  const all = await text($)
  expect(all).toMatch(/calls\s*\n?3/)
  expect(all).toMatch(/duration\s*\n?4s/)
  expect(all).toMatch(/context\s*\n?41k/)
  expect(all).toMatch(/cost\s*\n?N\/A/)
  expect(all).toMatch(/recent/)
  expect(all).toMatch(/pair +✓ sonnet → opus$/m)
  expect(all).not.toMatch(/◆ reported|reported just now/) // nothing stale after the pulse
})

test('the label follows the session advisor: Opus to Fable', async ($, on) => {
  let adv = 'opus'
  engine(on, () => adv)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(await text($)).toMatch(/OPUS 5\.5/)
  adv = 'fable'
  await $.turn.start({ text: 'go', turnId: 't2' })
  expect(await text($)).toMatch(/FABLE 5\.1/)
})

test('no advisor configured: says so', async ($, on) => {
  engine(on, () => null)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const all = await text($)
  expect(all).toMatch(/○ off/)
  expect(all).toMatch(/no advisor this session/)
})

test('council adaptive (default): the controller header keeps the advisor\'s calls, duration and context; cost N/A', async ($, on) => {
  const clock = engine(on, () => 'opus')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (let i = 0; i < 3; i++) await step($, i)
  await clock.advance(65_000)
  const all = await text($)
  expect(all).toMatch(/calls 3 · 4s · ctx 41k/)
  expect(all).toMatch(/council\s*\n?ADAPTIVE/)
  expect(all).toMatch(/cost N\/A/)
  for (const role of ['SECURITY', 'ARCHITECTURE', 'PERFORMANCE']) expect(all).toContain(role)
  expect(all).not.toMatch(/◆ reported|reported just now/)
})
