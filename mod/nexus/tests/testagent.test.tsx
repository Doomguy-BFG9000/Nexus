import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const pane = { plugin: 'nexus', component: 'Pane', requestId: 'nexus', surface: 'terminal', props: { title: 'NEXUS', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 46 }, view: {} } } as const

/** The tool calls that got past NEXUS to the engine, as the engine would have run them. */
let failPrefs = false

function engine(on: On, stored: Record<string, unknown> = {}) {
  const reached: Record<string, unknown>[] = []
  failPrefs = false
  // A state read that fails, on demand: the gate must then refuse, not let the call through.
  on('state.get', (_, e, next) => (failPrefs && JSON.stringify(e).includes('"prefs"') ? ({ deny: 'state unavailable' } as any) : next(e)))
  mock.clock(on, { now: 3_000_000 })
  mock.env(on, { HOME: '/home/test' })
  mock.store(on, { prefs: { version: 4, theme: 'orbit', ...stored } })
  on('settings.read', () => ({ value: { advisorModel: 'opus' } }))
  on('session.id', () => ({ value: 's' }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('config.list', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 44, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.read', () => {
    throw new Error('none')
  })
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', () => ({ cwd: '/repo' }))
  let n = 0
  on('agent.spawn', (_, e) => ({ model: 'claude-haiku-5-5', agentId: `agent-${++n}`, ...(e.subagentType ? {} : {}) }))
  on('classic.SubagentStop', () => ({}))
  on('tool.call', (_, e) => (reached.push(e as unknown as Record<string, unknown>), { result: { ok: true } as any }))
  return reached
}
const spawn = ($: any, subagentType: string, tool_use_id: string) =>
  $.agent.spawn({ tool_use_id, prompt: 'task\nmore', description: 'run the tests', subagentType, provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-sonnet-5-5', background: false, fork: false })
const start = ($: any) => $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
const call = ($: any, input: Record<string, unknown>) => $.tool.call(input as any).catch((e: unknown) => ({ deny: String(e) }))
const stop = ($: any, id: string, text?: string) => $.classic.SubagentStop({ agent_id: id, agent_type: 'nexus-test', stop_hook_active: false, agent_transcript_path: '', ...(text ? { last_assistant_message: text } : {}) })
async function tape($: any): Promise<string> {
  const ui = await $.ui.mount(pane)
  const out = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text ?? '').join('\n')
  await ui.unmount()
  return out
}
const denied = (r: unknown) => JSON.stringify(r)

test('a known test command reaches the engine in the foreground with a timeout', async ($, on) => {
  const reached = engine(on)
  await start($)
  await spawn($, 'nexus-test', 'tu1')
  await call($, { tool: 'Bash', command: 'npm test', agentId: 'agent-1' })
  expect(reached.at(-1)).toMatchObject({ tool: 'Bash', command: 'npm test', timeout: 120_000, run_in_background: false })
  await call($, { tool: 'Bash', command: 'pytest tests/test_cart.py -x', timeout: 99_999_999, run_in_background: true, agentId: 'agent-1' })
  expect(reached.at(-1)).toMatchObject({ command: 'pytest tests/test_cart.py -x', timeout: 300_000, run_in_background: false })
  await call($, { tool: 'Bash', command: 'go test ./...', timeout: 20_000, agentId: 'agent-1' })
  expect(reached.at(-1)).toMatchObject({ timeout: 20_000 })
})

test('anything else the Test agent asks for is refused with the reason, and never reaches the engine', async ($, on) => {
  const reached = engine(on)
  await start($)
  await spawn($, 'nexus-test', 'tu1')
  const before = reached.length
  const as = (input: Record<string, unknown>) => call($, { ...input, agentId: 'agent-1' })
  expect(denied(await as({ tool: 'Bash', command: 'rm -rf .' }))).toMatch(/NEXUS Test agent: `rm` is not a known test command/)
  expect(denied(await as({ tool: 'Bash', command: 'npm test && rm -rf .' }))).toMatch(/shell syntax/)
  expect(denied(await as({ tool: 'Bash', command: 'npm install' }))).toMatch(/is accepted here/)
  expect(denied(await as({ tool: 'Bash', command: 'npx vitest run' }))).toMatch(/can download code/)
  expect(denied(await as({ tool: 'Bash', command: 'jest -u' }))).toMatch(/not an accepted flag/)
  expect(denied(await as({ tool: 'Bash', command: 'jest --watch' }))).toMatch(/not an accepted flag/)
  expect(denied(await as({ tool: 'Bash', command: 'git checkout -- .' }))).toMatch(/not a known test command/)
  expect(denied(await as({ tool: 'Bash', command: 'CI=1 npm test' }))).toMatch(/environment variables/)
  expect(denied(await as({ tool: 'Bash' }))).toMatch(/no command given/)
  expect(denied(await as({ tool: 'Write', file_path: 'src/a.ts', content: 'x' }))).toMatch(/Write is not available to the Test agent/)
  expect(denied(await as({ tool: 'Edit', file_path: 'src/a.ts' }))).toMatch(/Edit is not available/)
  expect(denied(await as({ tool: 'NotebookEdit' }))).toMatch(/not available/)
  expect(denied(await as({ tool: 'WebFetch', url: 'https://x.test' }))).toMatch(/not available/)
  expect(denied(await as({ tool: 'Agent', prompt: 'x' }))).toMatch(/not available/)
  expect(denied(await as({ tool: 'BashOutput' }))).toMatch(/foreground/)
  expect(denied(await as({ tool: 'Read', file_path: '/repo/.env' }))).toMatch(/looks like a secret/)
  expect(reached.length).toBe(before)
  // Ordinary reads still work.
  await as({ tool: 'Read', file_path: '/repo/package.json' })
  expect(reached.at(-1)).toMatchObject({ tool: 'Read', file_path: '/repo/package.json' })
})

test('a Grep by the Test agent carries the secret negations', async ($, on) => {
  const reached = engine(on)
  await start($)
  await spawn($, 'nexus-test', 'tu1')
  await call($, { tool: 'Grep', pattern: 'x', glob: '*.ts', agentId: 'agent-1' })
  expect(String(reached.at(-1)!.glob)).toMatch(/^\*\.ts/)
  expect(String(reached.at(-1)!.glob).length).toBeGreaterThan(10)
})

test('only the Test agent is checked: the lead and other agents keep the permissions Claude Code gives them', async ($, on) => {
  const reached = engine(on)
  await start($)
  await spawn($, 'nexus-test', 'tu1')
  await spawn($, 'nexus-grep', 'tu2')
  await call($, { tool: 'Bash', command: 'rm -rf build' })
  expect(reached.at(-1)).toMatchObject({ command: 'rm -rf build' })
  await call($, { tool: 'Bash', command: 'rm -rf build2', agentId: 'agent-2' })
  expect(reached.at(-1)).toMatchObject({ command: 'rm -rf build2' })
  // ...and a command refused to the Test agent is not an exception for the lead.
  await call($, { tool: 'Bash', command: 'npm install', timeout: 1 })
  expect(reached.at(-1)).toMatchObject({ command: 'npm install', timeout: 1 })
})

test('Settings → Agents → Run tests: off stops every command, and reads still work', async ($, on) => {
  const reached = engine(on, { testRunner: 'off' })
  await start($)
  await spawn($, 'nexus-test', 'tu1')
  const n = reached.length
  expect(denied(await call($, { tool: 'Bash', command: 'npm test', agentId: 'agent-1' }))).toMatch(/switched off \(Settings → Agents → Run tests\)/)
  expect(reached.length).toBe(n)
  await call($, { tool: 'Read', file_path: '/repo/a.ts', agentId: 'agent-1' })
  expect(reached.length).toBe(n + 1)
})

test('the setting is read at the call: turning tests on or off applies to the running agent', async ($, on) => {
  const reached = engine(on)
  await start($)
  await spawn($, 'nexus-test', 'tu1')
  await ($ as any).command.run({ command: 'nexus', args: 'settings testRunner off' })
  expect(denied(await call($, { tool: 'Bash', command: 'npm test', agentId: 'agent-1' }))).toMatch(/switched off/)
  await ($ as any).command.run({ command: 'nexus', args: 'settings testRunner allowlist' })
  await call($, { tool: 'Bash', command: 'npm test', agentId: 'agent-1' })
  expect(reached.at(-1)).toMatchObject({ command: 'npm test' })
})

test('a refusal is on the activity tape, with the reason, and the card is a test agent', async ($, on) => {
  engine(on)
  await start($)
  await spawn($, 'nexus-test', 'tu1')
  await call($, { tool: 'Bash', command: 'rm -rf .', agentId: 'agent-1' })
  const out = await tape($)
  expect(out).toMatch(/test#1/)
  expect(out).toMatch(/test agent refused Bash/)
})

test('the tape reports the test run from the agent’s own report, never more', async ($, on) => {
  engine(on)
  await start($)
  await spawn($, 'nexus-test', 'tu1')
  await spawn($, 'nexus-test', 'tu2')
  await spawn($, 'nexus-test', 'tu3')
  await stop($, 'agent-1', 'ran: npm test\nresult: failed\npassed: 40  failed: 2  skipped: 0')
  await stop($, 'agent-2', 'I ran the tests and they look fine.')
  await stop($, 'agent-3', 'ran: none\nresult: not run\npassed: unknown')
  const out = await tape($)
  expect(out).toMatch(/test#1 failed · 2 failed, 40 passed/)
  expect(out).toMatch(/test#2 finished · no result line in its report/)
  expect(out).toMatch(/test#3 not run/)
  // The second agent's "fine" is not turned into a pass.
  expect(out).not.toMatch(/test#2 passed/)
})

test('doctor lists the test agent definition', async ($, on) => {
  engine(on)
  await start($)
  const out = ((await ($ as any).command.run({ command: 'nexus', args: 'doctor' })).text ?? '') as string
  expect(out).toMatch(/agent definitions: search missing, grep missing, audit missing, test missing/)
})

test('council round 1: only Read, Glob, Grep and Bash pass; any other tool is refused, MCP tools included', async ($, on) => {
  const reached = engine(on)
  await start($)
  await spawn($, 'nexus-test', 'tu1')
  const n = reached.length
  for (const tool of ['mcp__slack__send_message', 'Skill', 'SlashCommand', 'ExitPlanMode', 'FutureTool']) {
    expect(denied(await call($, { tool, agentId: 'agent-1' }))).toMatch(/not available to the Test agent/)
  }
  expect(reached.length).toBe(n)
  await call($, { tool: 'Glob', pattern: '*.ts', agentId: 'agent-1' })
  expect(reached.at(-1)).toMatchObject({ tool: 'Glob' })
})

test('council round 1: a sandbox or permission switch in the Bash call is dropped before it reaches the engine', async ($, on) => {
  const reached = engine(on)
  await start($)
  await spawn($, 'nexus-test', 'tu1')
  await call($, { tool: 'Bash', command: 'npm test', dangerouslyDisableSandbox: true, sandbox: false, agentId: 'agent-1' })
  const sent = reached.at(-1)!
  expect(sent.command).toBe('npm test')
  expect(JSON.stringify(sent)).not.toMatch(/sandbox/i)
})

test('council round 1: a spawn that arrives Agent-tool shaped (subagent_type) is still the Test agent', async ($, on) => {
  const reached = engine(on)
  await start($)
  await $.agent.spawn({ tool_use_id: 'tu-s', prompt: 'x', description: 'tests', subagent_type: 'nexus-test', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-sonnet-5-5', background: false, fork: false } as any).catch(() => undefined)
  const n = reached.length
  expect(denied(await call($, { tool: 'Bash', command: 'rm -rf .', agentId: 'agent-1' }))).toMatch(/not a known test command/)
  expect(reached.length).toBe(n)
})

test('council round 1: if the gate itself cannot read the setting, the Test agent is refused, not let through', async ($, on) => {
  const reached = engine(on)
  await start($)
  await spawn($, 'nexus-test', 'tu1')
  failPrefs = true
  const n = reached.length
  const out = denied(await call($, { tool: 'Bash', command: 'npm test', agentId: 'agent-1' }))
  expect(out).toMatch(/deny|refused|state unavailable/i)
  expect(reached.length).toBe(n)
})
