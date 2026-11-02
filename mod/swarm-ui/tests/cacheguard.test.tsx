import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { NEW_GUARD, decide } from '../hooks/cacheguard'

const MIN = 60_000
const T0 = 10_000_000
type W = { prefs?: Record<string, unknown>; forkRead?: number; forkFails?: boolean; costPerBeat?: number; animation?: string }

function engine(on: On, w: W) {
  const clock = mock.clock(on, { now: T0 })
  const forks: number[] = []
  const fetches: string[] = []
  const asks: string[] = []
  let cost = 0.1
  mock.env(on, { HOME: '/home/test', TYPESAFE_API_KEY: 'k' })
  mock.store(on, { prefs: { version: 1, animation: w.animation ?? 'auto', cacheGuard: { enabled: true, idleMin: 50, maxHours: 8, maxBeats: 10, budgetUsd: 5, trustTtl: true, ...(w.prefs ?? {}) } } })
  on('settings.read', () => ({ value: { advisorModel: 'opus' } }))
  on('session.id', () => ({ value: 's' }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('config.list', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 44, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: 's' }) as any)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'agent-1' }))
  on('classic.SubagentStop', () => ({}))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 40_000, window: 200_000, percent: 20 }, rateLimits: [], cost: { usd: cost } } as any }))
  on('http.fetch', (_, e) => {
    fetches.push(e.url)
    return { value: { status: 500, ok: false, headers: {}, text: '' } }
  })
  on('tool.call', (_, e) => {
    if (e.tool === 'AskUserQuestion') asks.push('ask')
    return { result: { ok: true } as any }
  })
  on('model.fork', (_, e) => {
    forks.push(clock.now())
    expect(e.prompt).toBe('Reply with exactly "." and nothing else.')
    if (w.forkFails) return { value: { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded' } as any }
    cost += w.costPerBeat ?? 0.01
    const read = w.forkRead ?? 40_000
    return { value: { isAnswered: true, text: '.', usage: { input_tokens: 40, output_tokens: 2, cache_read_input_tokens: read, cache_creation_input_tokens: 40_000 - read } } }
  })
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: { model: e.model, input_tokens: 50, output_tokens: 5, cache_read_input_tokens: 39_000, cache_creation_input_tokens: 100 } }
  })
  return { clock, forks, fetches, asks }
}

const start = ($: any) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
const cache = async ($: any) => ((await ($ as any).command.run({ command: 'swarm', args: 'cache' })).text as string)
async function turn($: any, id: string) {
  await $.turn.start({ text: 'work', turnId: id })
  const st = $.turn.step({ turnId: id, index: 0, model: 'claude-sonnet-5-5', effort: 'high', messageCount: 3 })
  for await (const _ of st) {
    // drain
  }
  await $.turn.complete({ turnId: id, answer: 'ok', durationMs: 1000, isAborted: false, reason: 'answer' })
}

test('decide: never while busy, never past the cache lifetime, never without TTL evidence', async () => {
  const c = { enabled: true, idleMin: 50, maxHours: 8, maxBeats: 10, budgetUsd: 1, trustTtl: false }
  const g = { ...NEW_GUARD, activityAt: 0, armedAt: 0 }
  expect(decide(g, c, { now: 51 * MIN, isBusy: false })).toEqual({ act: 'stop', status: 'PAUSED', reason: '1-hour cache not confirmed yet' })
  const trusted = { ...c, trustTtl: true }
  expect(decide(g, trusted, { now: 51 * MIN, isBusy: false })).toEqual({ act: 'beat' })
  expect(decide(g, trusted, { now: 51 * MIN, isBusy: true }).act).toBe('wait')
  expect(decide(g, trusted, { now: 70 * MIN, isBusy: false })).toEqual({ act: 'stop', status: 'EXPIRED', reason: 'idle past the cache lifetime' })
  expect(decide({ ...g, ttl: '5m' }, trusted, { now: 51 * MIN, isBusy: false }).act).toBe('stop')
  expect(decide(g, { ...trusted, enabled: false }, { now: 51 * MIN, isBusy: false })).toEqual({ act: 'stop', status: 'OFF', reason: 'off' })
})

test('off by default: no beat ever', async ($, on) => {
  const w = engine(on, { prefs: { enabled: false } })
  await start($)
  await turn($, 't1')
  await w.clock.advance(3 * 60 * MIN)
  expect(w.forks).toEqual([])
  expect(await cache($)).toMatch(/Cache Guard: OFF/)
})

test('one beat after 50 idle minutes, then every 50 while warm; a warm beat reads from cache', async ($, on) => {
  const w = engine(on, {})
  await start($)
  await turn($, 't1')
  await w.clock.advance(49 * MIN)
  expect(w.forks.length).toBe(0)
  await w.clock.advance(2 * MIN)
  expect(w.forks).toEqual([T0 + 50 * MIN])
  await w.clock.advance(50 * MIN)
  expect(w.forks.length).toBe(2)
  const text = await cache($)
  expect(text).toMatch(/Cache Guard: WARM \(beat read 100% from cache\)/)
  expect(text).toMatch(/beats      2/)
  expect(text).toMatch(/cost       \$0\.02 API est\./)
  expect(text).toMatch(/savings    N\/A/)
  expect(text).toMatch(/cache TTL  1h \(a beat read from cache after 50m idle\)/)
})

test('activity resets the idle clock; many turns never schedule a second timer', async ($, on) => {
  const w = engine(on, {})
  await start($)
  for (let i = 0; i < 5; i++) await turn($, `t${i}`)
  await w.clock.advance(30 * MIN)
  await turn($, 'late')
  await w.clock.advance(49 * MIN)
  expect(w.forks.length).toBe(0)
  await w.clock.advance(2 * MIN)
  expect(w.forks).toEqual([T0 + 30 * MIN + 50 * MIN])
})

test('a running agent holds the beat until it finishes', async ($, on) => {
  // Animation off: a running agent otherwise animates at 10 FPS for the whole hour.
  const w = engine(on, { animation: 'off' })
  await start($)
  await turn($, 't1')
  await $.agent.spawn({ tool_use_id: 'a', prompt: 'p', description: 'd', subagentType: 'swarm-search', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-sonnet-5-5', background: true, fork: false })
  await w.clock.advance(55 * MIN)
  expect(w.forks.length).toBe(0)
  await $.classic.SubagentStop({ agent_id: 'agent-1', agent_type: 'swarm-search', stop_hook_active: false, agent_transcript_path: '' })
  await w.clock.advance(2 * MIN)
  expect(w.forks.length).toBe(1)
})

test('beat count and budget caps stop it; the budget is never passed', async ($, on) => {
  const w = engine(on, { prefs: { maxBeats: 2 } })
  await start($)
  await turn($, 't1')
  await w.clock.advance(4 * 60 * MIN)
  expect(w.forks.length).toBe(2)
  expect(await cache($)).toMatch(/PAUSED \(2 beats used\)/)
})

test('the budget stops it before a beat that would pass it', async ($, on) => {
  const w = engine(on, { prefs: { budgetUsd: 0.25 }, costPerBeat: 0.1 })
  await start($)
  await turn($, 't1')
  await w.clock.advance(5 * 60 * MIN)
  expect(w.forks.length).toBe(2) // 0.1 + 0.1; a third would make 0.3
  expect(await cache($)).toMatch(/PAUSED \(\$0\.25 budget reached\)/)
})

test('the hours cap stops it', async ($, on) => {
  const w = engine(on, { prefs: { maxHours: 1, idleMin: 20 } })
  await start($)
  await turn($, 't1')
  await w.clock.advance(3 * 60 * MIN)
  expect(w.forks.length).toBe(2) // at 20 and 40 minutes; the hour is up at 60
  expect(await cache($)).toMatch(/PAUSED \(1h cap reached\)/)
})

test('a cold beat (the cache had lapsed) stops it and records a 5-minute cache', async ($, on) => {
  const w = engine(on, { forkRead: 0, prefs: { idleMin: 10 } })
  await start($)
  await turn($, 't1')
  await w.clock.advance(2 * 60 * MIN)
  expect(w.forks.length).toBe(1)
  const text = await cache($)
  expect(text).toMatch(/EXPIRED \(the cache had lapsed: the beat paid to rebuild it\)/)
  expect(text).toMatch(/cache TTL  5m/)
})

test('a failed beat shows ERROR with the reason and plans nothing more', async ($, on) => {
  const w = engine(on, { forkFails: true })
  await start($)
  await turn($, 't1')
  await w.clock.advance(3 * 60 * MIN)
  expect(w.forks.length).toBe(1)
  expect(await cache($)).toMatch(/ERROR \(beat failed: api-error 529\)/)
})

test('without TTL evidence it waits, PAUSED, unless trusted', async ($, on) => {
  const w = engine(on, { prefs: { trustTtl: false } })
  await start($)
  await turn($, 't1')
  await w.clock.advance(2 * 60 * MIN)
  expect(w.forks.length).toBe(0)
  expect(await cache($)).toMatch(/PAUSED \(1-hour cache not confirmed yet\)/)
})

test('session end cancels the timer', async ($, on) => {
  const w = engine(on, {})
  await start($)
  await turn($, 't1')
  await $.session.end({ reason: 'exit' } as any)
  await w.clock.advance(2 * 60 * MIN)
  expect(w.forks).toEqual([])
})

test('/swarm cache off stops a planned beat at once', async ($, on) => {
  const w = engine(on, {})
  await start($)
  await turn($, 't1')
  await ($ as any).command.run({ command: 'swarm', args: 'cache off' })
  await w.clock.advance(2 * 60 * MIN)
  expect(w.forks).toEqual([])
})

test('beats raise no Jev request, no dialog and no model change', async ($, on) => {
  const w = engine(on, {})
  await start($)
  await turn($, 't1')
  const before = { fetches: w.fetches.length, asks: w.asks.length }
  await w.clock.advance(51 * MIN)
  expect(w.forks.length).toBe(1)
  expect(w.fetches.length).toBe(before.fetches)
  expect(w.asks.length).toBe(before.asks)
  expect(await ($ as any).command.run({ command: 'swarm-mode', args: 'status' }).then((r: any) => r.text)).toMatch(/Rewrite in force: none/)
})

test('the next real request after a beat is checked against the cache', async ($, on) => {
  const w = engine(on, {})
  await start($)
  await turn($, 't1')
  await w.clock.advance(51 * MIN)
  await turn($, 't2')
  expect(await cache($)).toMatch(/after beat 100% of the next real request came from cache/)
})

test('the pane shows the guard under the back-to-lead box', async ($, on) => {
  const w = engine(on, {})
  await start($)
  await turn($, 't1')
  await w.clock.advance(51 * MIN)
  const ui = await $.ui.mount({ plugin: 'swarm-ui', component: 'Pane', requestId: 'swarm', surface: 'terminal', props: { title: 'swarm', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } } as const)
  const all = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text ?? '').join('\n')
  await ui.unmount()
  expect(all.indexOf('review + verify')).toBeLessThan(all.indexOf('cache guard'))
  expect(all.indexOf('cache guard')).toBeLessThan(all.indexOf('USAGE'))
  expect(all).toMatch(/warm/)
  expect(all).toMatch(/TTL 1h/)
})

test("a session's first beat writes its own suffix once and is still warm (live: 30k read, 22k written)", async ($, on) => {
  const w = engine(on, { forkRead: 23_000 }) // 23k read, 17k written: 57%, as measured live
  await start($)
  await turn($, 't1')
  await w.clock.advance(51 * MIN)
  expect(w.forks.length).toBe(1)
  expect(await cache($)).toMatch(/Cache Guard: WARM \(beat read 57% from cache\)/)
})
