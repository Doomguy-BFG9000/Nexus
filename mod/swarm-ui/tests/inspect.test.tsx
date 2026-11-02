import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const pane = (isFocused: boolean, bodyColumns = 90) =>
  ({ plugin: 'swarm-ui', component: 'Pane', requestId: 'swarm', surface: 'terminal', props: { title: 'swarm', isFocused, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 46 }, view: {} } }) as const

function engine(on: On) {
  const clock = mock.clock(on, { now: 3_000_000 })
  mock.env(on, { HOME: '/home/test' })
  on('settings.read', () => ({ value: { advisorModel: 'opus' } }))
  on('session.id', () => ({ value: 's' }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('config.list', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 44, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.read', (_, e) => {
    if (e.path.endsWith('swarm-search.md')) return { value: '---\nname: swarm-search\nmaxTurns: 25\n---\nbody' }
    throw new Error('none')
  })
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', () => ({ cwd: '/repo' }))
  let n = 0
  on('agent.spawn', (_, e) => ({ model: e.subagentType.startsWith('swarm-') ? 'claude-haiku-5-5' : 'claude-sonnet-5-5', agentId: `agent-${++n}` }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('classic.SubagentStop', () => ({}))
  on('tool.call', (_, e) => (e.tool === 'Agent' ? { result: { totalTokens: 48_200, resolvedModel: 'claude-haiku-5-5' } as any } : { result: { ok: true } as any }))
  on('turn.step', async function* (_, e) {
    return {
      turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const,
      usage: { model: e.model, input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 9000, cache_creation_input_tokens: 500 },
    }
  })
  return clock
}

const spawn = ($: any, subagentType: string, description: string, tool_use_id: string) =>
  $.agent.spawn({ tool_use_id, prompt: `${description}\nmore detail`, description, subagentType, provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-sonnet-5-5', background: false, fork: false })

async function step($: any, agentId: string) {
  const st = $.turn.step({ turnId: `t-${agentId}`, index: 0, model: 'claude-haiku-5-5', messageCount: 1, agentId })
  for await (const _ of st) {
    // drain
  }
}

async function texts($: any, isFocused = false): Promise<string> {
  const ui = await $.ui.mount(pane(isFocused))
  const all = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text ?? '').join('\n')
  await ui.unmount()
  return all
}

const run = ($: any, args: string) => ($ as any).command.run({ command: 'nexus', args })

test('overlapping instances of one type get their own identity; a fallback agent is marked', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await spawn($, 'swarm-search', 'maps the api', 'tu1')
  await spawn($, 'swarm-search', 'maps the ui', 'tu2')
  await spawn($, 'general-purpose', 'writes a summary', 'tu3')
  const all = await texts($)
  expect(all).toMatch(/search#1/)
  expect(all).toMatch(/search#2/)
  expect(all).toMatch(/sonnet 5\.5 · fa(llback|…)/) // cut to the card's width
  const list = (await run($, 'agents')).text
  expect(list).toMatch(/1  search#1 +haiku 5\.5 +● running/)
  expect(list).toMatch(/3  general-purpose#1 +sonnet 5\.5 +● running +\[fallback\] writes a summary/)
})

test('inspect shows real lifecycle, tokens, files, recent activity, totals and the result', async ($, on) => {
  const clock = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await spawn($, 'swarm-search', 'maps the api', 'tu1')
  await step($, 'agent-1')
  await step($, 'agent-1')
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/api.ts', agentId: 'agent-1' })
  await $.tool.call({ tool: 'Bash', command: 'ls src', agentId: 'agent-1' } as any)
  await $.tool.call({ tool: 'Agent', tool_use_id: 'tu1', prompt: 'x', description: 'maps the api', subagent_type: 'swarm-search' } as any)
  await clock.advance(7000)
  await $.classic.SubagentStop({ agent_id: 'agent-1', agent_type: 'swarm-search', stop_hook_active: false, agent_transcript_path: '', last_assistant_message: 'The API lives in src/api.ts.' })
  const out = (await run($, 'inspect search#1')).text
  expect(out).toMatch(/search#1 · haiku 5\.5 · ✓ done 7s/)
  expect(out).toMatch(/turns     2\/25 turns · tools 3 · last Agent|turns     2\/25 turns · tools 2 · last Bash/)
  expect(out).toMatch(/tokens    in 2k · out 600 · cache read 18k · cache write 1k/)
  expect(out).toMatch(/reported  48k total tokens \(Agent tool result\)/)
  expect(out).toMatch(/files     src\/api\.ts/)
  expect(out).toMatch(/Read api\.ts/)
  expect(out).toMatch(/Bash ls src/)
  expect(out).toMatch(/The API lives in src\/api\.ts\./)
  expect(out).toMatch(/cost      API est\. N\/A per agent/)
  // The pane now shows that agent in detail.
  expect(await texts($)).toMatch(/The API lives in src\/api\.ts\./)
})

test('cancelled and failed runs keep that state; a late stop report does not reopen them', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await spawn($, 'swarm-grep', 'finds x', 'tu1')
  await spawn($, 'swarm-audit', 'reviews y', 'tu2')
  await $.turn.complete({ turnId: 'a', answer: '', durationMs: 1, isAborted: true, reason: 'aborted', agentId: 'agent-1' })
  await $.turn.complete({ turnId: 'b', answer: '', durationMs: 1, isAborted: false, reason: 'error', agentId: 'agent-2' })
  await $.classic.SubagentStop({ agent_id: 'agent-1', agent_type: 'swarm-grep', stop_hook_active: false, agent_transcript_path: '' })
  const all = await texts($)
  expect(all).toMatch(/◌ cancelled/)
  expect(all).toMatch(/✗ failed/)
  expect((await run($, 'inspect 2')).text).toMatch(/ended     the run ended on an error/)
})

test('keyboard: a focused pane offers hotkeys that open an agent and go back', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await spawn($, 'swarm-search', 'maps the api', 'tu1')
  const unfocused = await texts($, false)
  expect(unfocused).toMatch(/ctrl\+x tab, then 1-1 to inspect/)
  const ui = await $.ui.mount(pane(true))
  await ui.press({ key: 'inspect-agent-1' })
  await ui.unmount()
  expect(await texts($, true)).toMatch(/prompt +maps the api/)
  const again = await $.ui.mount(pane(true))
  await again.press({ key: 'back' })
  await again.unmount()
  expect(await texts($)).toMatch(/delegate to subagents/)
})

test('inspecting an unknown agent explains and lists the real ones', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect((await run($, 'inspect 4')).text).toMatch(/No agents this session yet\./)
  await spawn($, 'swarm-search', 'maps', 'tu1')
  expect((await run($, 'inspect nope')).text).toMatch(/No agent "nope"[\s\S]*search#1/)
})

test('an answer handed back through a tool call becomes the result; the working folder reads as .', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await spawn($, 'swarm-grep', 'finds x', 'tu1')
  await $.tool.call({ tool: 'Bash', path: '/repo', command: 'grep -rn x', agentId: 'agent-1' } as any)
  await $.tool.call({ tool: 'SubagentHandback', result: 'x is defined in src/x.ts:12', agentId: 'agent-1' } as any)
  const out = (await ($ as any).command.run({ command: 'nexus', args: 'inspect grep#1' })).text
  expect(out).toMatch(/x is defined in src\/x\.ts:12/)
  expect(out).toMatch(/files     \./)
})

test('cards keep their footprint: long labels and tasks are cut with an ellipsis, status is always the last row', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await spawn($, 'general-purpose', 'Audit: correctness of the whole cache layer and its tests', 'tu1')
  const all = await texts($)
  expect(all).toMatch(/general-pu…|general-p…/)
  expect(all).toMatch(/Audit: corr[a-z]*…/)
  expect(all).not.toMatch(/Audit: correctness of the whole cache layer/)
  expect(all).toMatch(/● running 0s/)
})
