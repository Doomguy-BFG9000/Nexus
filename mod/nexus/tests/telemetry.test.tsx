import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { freshness, limitLabel, resetLabel, tone } from '../hooks/telemetry'

const pane = { plugin: 'nexus', component: 'Pane', requestId: 'nexus', surface: 'terminal', props: { title: 'NEXUS', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } } as const
const NOW = Date.parse('2026-11-02T10:00:00Z')

type W = { usage?: unknown; identity?: unknown }

function engine(on: On, w: W) {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/test' })
  on('settings.read', () => ({ value: { advisorModel: 'opus' } }))
  on('session.id', () => ({ value: 's' }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('config.list', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 44, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.identity', () => ({ value: (w.identity ?? { deny: 'not a managed mod' }) as any }))
  on('session.usage', () => {
    if (!w.usage) throw new Error('no ledger')
    return { value: w.usage as any }
  })
  on('session.compact', (_, e) => ({ messages: e.messages }) as any)
  on('turn.step', async function* (_, e) {
    return {
      turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const,
      usage: { model: e.agentId ? 'claude-haiku-5-5' : e.model, input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 5000, cache_creation_input_tokens: 50 },
    }
  })
  return clock
}

const USAGE = {
  startedAt: NOW - 60_000,
  context: { tokens: 97_000, window: 200_000, percent: 49 },
  rateLimits: [
    { kind: 'seven_day', percentUsed: 30, resetsAt: '2026-11-05T05:00:00Z' },
    { kind: 'five_hour', percentUsed: 50, resetsAt: '2026-11-02T13:40:00Z' },
  ],
  cost: { usd: 0.82 },
}

const start = ($: any) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
async function texts($: any): Promise<string> {
  const ui = await $.ui.mount(pane)
  const all = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text ?? '').join('\n')
  await ui.unmount()
  return all
}
async function step($: any, turnId: string, index: number, agentId?: string) {
  const st = $.turn.step({ turnId, index, model: 'claude-sonnet-5-5', effort: 'high', messageCount: 1, ...(agentId ? { agentId } : {}) })
  for await (const _ of st) {
    // drain
  }
}
const usageCmd = async ($: any) => (await ($ as any).command.run({ command: 'nexus', args: 'usage' })).text as string

test('rules: labels, thresholds, freshness and local reset times', async () => {
  expect(limitLabel('five_hour')).toBe('5h')
  expect(limitLabel('seven_day_opus')).toBe('7d opus')
  expect(limitLabel('seven_day_fable')).toBe('7d fable')
  expect(limitLabel('seven_day_omelette')).toBe('7d omelette') // never assumed to be Fable
  expect([tone(69.9), tone(70), tone(89.9), tone(90), tone(null)]).toEqual(['normal', 'warn', 'warn', 'alert', 'none'])
  expect(freshness(null, NOW)).toEqual({ isStale: true, label: 'no response yet' })
  expect(freshness(NOW - 16 * 60_000, NOW).isStale).toBe(true)
  expect(freshness(NOW - 30_000, NOW)).toEqual({ isStale: false, label: 'just now' })
  const local = new Date('2026-11-02T13:40:00Z')
  const hm = `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`
  expect(resetLabel('2026-11-02T13:40:00Z', NOW)).toMatch(new RegExp(`resets (\\w{3} )?${hm}`))
  expect(resetLabel('2026-11-01T00:00:00Z', NOW)).toBe('reset passed')
  expect(resetLabel(null, NOW)).toBe('reset N/A')
})

test('context and cost come straight from Claude Code, labelled API est.', async ($, on) => {
  engine(on, { usage: USAGE })
  await start($)
  const all = await texts($)
  expect(all).toMatch(/97k \/ 200k/)
  expect(all).toMatch(/left[\s\S]{0,3}103k · 49%/)
  expect(all).toMatch(/\$0\.82/)
  expect(all).toMatch(/API est\./)
})

test('USAGE shows only the windows reported, 5h first, with local resets; no Fable row is invented', async ($, on) => {
  engine(on, { usage: USAGE })
  await start($)
  const all = await texts($)
  expect(all).toMatch(/USAGE/)
  expect(all).toMatch(/plan not reported/)
  expect(all.indexOf('5h')).toBeLessThan(all.indexOf('7d'))
  expect(all).toMatch(/50%/)
  expect(all).toMatch(/30%/)
  expect(all).not.toMatch(/fable/i)
  const detail = await usageCmd($)
  expect(detail).toMatch(/fable 7d +not reported by Claude Code for this account/)
  expect(detail).toMatch(/plan: not identified/)
  expect(detail).toMatch(/\[five_hour\]/)
})

test('a Fable window, when Claude Code reports one, gets its own row', async ($, on) => {
  engine(on, { usage: { ...USAGE, rateLimits: [...USAGE.rateLimits, { kind: 'seven_day_fable', percentUsed: 20 }] } })
  await start($)
  const all = await texts($)
  expect(all).toMatch(/7d fable/)
  expect(all).toMatch(/reset N\/A/)
})

test('a plan is named only when Claude Code answers it', async ($, on) => {
  engine(on, { usage: USAGE, identity: { kind: 'claude.ai', organizationType: 'claude_max', isVerified: true } })
  await start($)
  expect(await texts($)).toMatch(/USAGE\n? · claude_max/)
})

test('stale plan figures are marked stale after 15 minutes without a response', async ($, on) => {
  const clock = engine(on, { usage: USAGE })
  await start($)
  await clock.advance(16 * 60_000)
  expect(await texts($)).toMatch(/stale · 16m ago/)
})

test('nothing reported: N/A, never zero', async ($, on) => {
  engine(on, {})
  await start($)
  const all = await texts($)
  expect(all).toMatch(/context[\s\S]{0,3}N\/A/)
  expect(all).toMatch(/no limits yet/)
  expect(all).toMatch(/session[\s\S]{0,3}N\/A API est\./)
})

test('tokens by model: each request once, lead and agents apart', async ($, on) => {
  engine(on, { usage: USAGE })
  await start($)
  await step($, 't1', 0)
  await step($, 't1', 0) // the same request reported again: not counted twice
  await step($, 't1', 1)
  await step($, 'a1', 0, 'agent-1')
  const detail = await usageCmd($)
  expect(detail).toMatch(/sonnet 5\.5 +2 req \(2 lead, 0 agents\) +in 200 +out 20 +cache read 10000/)
  expect(detail).toMatch(/haiku 5\.5 +1 req \(0 lead, 1 agents\)/)
  expect(detail).toMatch(/advisor: not included/)
})

test('compactions are counted, not caused', async ($, on) => {
  engine(on, { usage: USAGE })
  await start($)
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'summary', toolUses: [] }] } as any)
  expect(await texts($)).toMatch(/compactions[\s\S]{0,3}1/)
})
