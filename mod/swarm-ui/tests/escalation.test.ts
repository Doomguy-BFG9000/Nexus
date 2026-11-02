import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

type Session = { advisor: string | null; answers?: string[]; classify?: string }

// Everything beneath the plugin stands for the engine.
function engine(on: On, s: Session) {
  const asked: string[] = []
  const answers = [...(s.answers ?? [])]
  const models: string[] = []
  const efforts: unknown[] = []
  let classified = 0
  mock.clock(on)
  mock.env(on, { HOME: '/home/test' })
  on('settings.read', () => ({ value: { advisorModel: s.advisor } }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('config.list', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 44, stdout: '', stderr: 'not found', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.read', () => {
    throw new Error('no agent definition here')
  })
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('model.classify', () => {
    classified++
    return { value: s.classify ?? 'routine' }
  })
  // The person's answer in the native dialog; none left means they dismissed it.
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
    const q = e.questions[0]!.question
    asked.push(q)
    const pick = answers.shift()
    if (pick === undefined) return { deny: 'dismissed' }
    return { result: { questions: e.questions, answers: { [q]: pick } } }
  })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.step', async function* (_, e) {
    models.push(e.model)
    efforts.push(e.effort)
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'ok',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: { model: e.model, input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }
  })
  return { asked, models, efforts, classified: () => classified }
}

async function start($: any) {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
}

async function step($: any, index = 0) {
  const stream = $.turn.step({ turnId: 't1', index, model: 'claude-sonnet-5-5', effort: 'high', messageCount: 1 })
  for await (const _ of stream) {
    // drain
  }
  return stream.result
}

function submit($: any, text: string) {
  return $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
}

const HARD = 'refactor the session store and fix the race condition in the cache layer'

test('no mode chosen: the request goes out as the engine resolved it', async ($, on) => {
  const w = engine(on, { advisor: 'opus' })
  await start($)
  await step($)
  expect(w.models).toEqual(['claude-sonnet-5-5'])
})

test('approving an escalation switches the main model for the next request, this session only', async ($, on) => {
  const w = engine(on, { advisor: 'opus', answers: ['Switch to Deep Engineering'] })
  await start($)
  await submit($, HARD)
  expect(w.asked[0]).toMatch(/Deep Engineering task \(mentions refactor, race condition\)/)
  expect(w.asked[0]).toMatch(/It switches the main model now; the advisor waits for a relaunch/)
  await step($)
  expect(w.models).toEqual(['opus'])
  expect(w.efforts).toEqual(['xhigh'])
  const status = await ($ as any).command.run({ command: 'swarm-mode', args: 'status' })
  expect(status.text).toMatch(/Swarm mode: Deep Engineering/)
  expect(status.text).toMatch(/--resume sess-1 --model opus --effort xhigh --settings '\{"advisorModel":"fable"\}'/)
})

test('keeping the mode changes nothing and is not asked again at that level', async ($, on) => {
  const w = engine(on, { advisor: 'opus', answers: ['Keep Balanced'] })
  await start($)
  await submit($, HARD)
  await submit($, HARD)
  expect(w.asked.length).toBe(1)
  await step($)
  expect(w.models).toEqual(['claude-sonnet-5-5'])
})

test('a dismissed dialog keeps the mode', async ($, on) => {
  const w = engine(on, { advisor: 'opus', answers: [] })
  await start($)
  await submit($, HARD)
  expect(w.asked.length).toBe(1)
  await step($)
  expect(w.models).toEqual(['claude-sonnet-5-5'])
})

test('trivial prompts and slash commands are never assessed or classified', async ($, on) => {
  const w = engine(on, { advisor: 'opus', classify: 'extreme' })
  await start($)
  await submit($, 'thanks!')
  await $.prompt.submit({ text: HARD, wait: false, origin: { kind: 'composer' }, command: { name: 'review', args: '' } })
  expect(w.asked.length).toBe(0)
  expect(w.classified()).toBe(0)
})

test('Haiku settles only an ambiguous prompt, and only up to the cap', async ($, on) => {
  const w = engine(on, { advisor: 'opus', classify: 'complex', answers: ['Keep Balanced'] })
  await start($)
  await submit($, 'please debug why the login form shows twice on submit')
  expect(w.classified()).toBe(1)
  expect(w.asked[0]).toMatch(/Haiku rated it complex/)
  for (let i = 0; i < 25; i++) await submit($, `please debug the upload widget number ${i}`)
  expect(w.classified()).toBe(20)
})

test('Maximum Reasoning under an Opus advisor is refused in-session, with the relaunch', async ($, on) => {
  const w = engine(on, { advisor: 'opus' })
  await start($)
  const out = await ($ as any).command.run({ command: 'swarm-mode', args: 'max' })
  expect(out.text).toMatch(/not applied in this session: fable \(rank 9\) outranks the opus advisor/)
  expect(out.text).toMatch(/--model fable --effort max --settings '\{"advisorModel":"fable"\}'/)
  await step($)
  expect(w.models).toEqual(['claude-sonnet-5-5'])
})

test('Maximum Reasoning in a session launched with a Fable advisor applies at once', async ($, on) => {
  const w = engine(on, { advisor: 'fable' })
  await start($)
  const out = await ($ as any).command.run({ command: 'swarm-mode', args: 'max' })
  expect(out.text).not.toMatch(/relaunch/)
  await step($)
  expect(w.models).toEqual(['fable'])
  expect(w.efforts).toEqual(['max'])
})

test('manual choice with a cost confirmation, then back to the default', async ($, on) => {
  const w = engine(on, { advisor: 'opus', answers: ['Deep Engineering', 'Apply'] })
  await start($)
  const chosen = await ($ as any).command.run({ command: 'swarm-mode', args: '' })
  expect(w.asked[1]).toMatch(/Deep Engineering costs more/)
  expect(chosen.text).toMatch(/Applied now, this session only: main opus/)
  await step($)
  const reset = await ($ as any).command.run({ command: 'swarm-mode', args: 'default' })
  expect(reset.text).toMatch(/as launched/)
  await step($, 1)
  expect(w.models).toEqual(['opus', 'claude-sonnet-5-5'])
})

test('cancelling the cost confirmation changes nothing', async ($, on) => {
  const w = engine(on, { advisor: 'opus', answers: ['Deep Engineering', 'Cancel'] })
  await start($)
  const out = await ($ as any).command.run({ command: 'swarm-mode', args: '' })
  expect(out.text).toMatch(/unchanged/)
  await step($)
  expect(w.models).toEqual(['claude-sonnet-5-5'])
})

test('subagent requests are never rewritten', async ($, on) => {
  const w = engine(on, { advisor: 'opus' })
  await start($)
  await ($ as any).command.run({ command: 'swarm-mode', args: 'deep' })
  const stream = $.turn.step({ turnId: 't2', index: 0, model: 'claude-haiku-5-5', messageCount: 1, agentId: 'agent-9' })
  for await (const _ of stream) {
    // drain
  }
  expect(w.models).toEqual(['claude-haiku-5-5'])
})
