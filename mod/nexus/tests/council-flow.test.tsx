// The council's hooks driven through the test engine: mocked engine events
// (process.run, turn.step, compose), not a live Claude Code run. The kit does
// not start a subagent for a plugin's $.agent.spawn made inside a tool call (it
// records the request; no agentId comes back), so these tests cover what is
// requested and every path that launches nothing; a launched review's
// lifecycle, enforcement and telemetry are checked live (docs/council-and-tool-routing.md).
import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const DIFF = 'diff --git a/src/db.ts b/src/db.ts\n--- a/src/db.ts\n+++ b/src/db.ts\n@@ -1,2 +1,3 @@\n+for (const u of users) await query(u)\n'
const ANSWER = (role: string, file = 'src/db.ts', line = 2) =>
  `${role} review.\n\`\`\`json\n[{"severity":"medium","file":"${file}","line":${line},"title":"Query runs inside the loop over users","evidence":"await query(u) per user","action":"batch the query","confidence":0.7}]\n\`\`\``

type World = {
  t: number
  clock: { advance: (ms: number) => Promise<void> }
  diff: string
  spawned: { type: string; prompt: string; id: string }[]
  registered: { agents: any[]; tools: string[] }
  gitCalls: string[][]
}

function engine(on: On, stored: Record<string, unknown> = {}, advisor: string | null = 'opus'): World {
  const clock = mock.clock(on, { now: 5_000_000 })
  const w: World = { t: 5_000_000, clock, diff: DIFF, spawned: [], registered: { agents: [], tools: [] }, gitCalls: [] }
  on('turn.complete', (_, e) => ({ text: e.answer }) as any)
  on('prompt.compose', () => ({ sections: [] }) as any)
  on('session.surface', () => ({ value: null }) as any) // command replies come back as text
  on('ui.close', () => ({ value: undefined }) as any)
  mock.env(on, { HOME: '/home/test' })
  mock.store(on, stored)
  on('settings.read', () => ({ value: { advisorModel: advisor } }))
  on('session.id', () => ({ value: 's' }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('config.list', () => ({ value: [] }))
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 41_000, window: 200_000, percent: 21 }, rateLimits: [] } as any }))
  on('agent.register', (_, e) => {
    w.registered.agents.push(e)
    return { value: { agent: `nexus:${e.name}` } } as any
  })
  on('tool.register', (_, e) => {
    w.registered.tools.push(e.name)
    return { value: { tool: `mcp__nexus__${e.name}` } } as any
  })
  on('process.run', (_, e) => {
    const argv = e.argv as string[]
    if (argv[0] === 'git') w.gitCalls.push(argv)
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[0] !== 'git') return { value: { exitCode: 44, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (argv[1] === 'rev-parse') return ok('true\n')
    if (argv[1] === 'diff') return ok(w.diff)
    if (argv[1] === 'ls-files') return ok('')
    if (argv[1] === 'log') return ok('abc123 first commit\n')
    return ok('')
  })
  on('fs.read', (_, e) => (String(e.path).endsWith('src/db.ts') ? ({ value: 'a\nb\nc\n' } as any) : ({ deny: 'missing' } as any)))
  let n = 0
  on('agent.spawn', (_, e) => {
    const id = `rev-${++n}`
    w.spawned.push({ type: e.subagentType ?? (e as any).subagent_type, prompt: e.prompt, id })
    return { model: 'claude-opus-5-5', agentId: id }
  })
  // A plugin's $.agent.spawn reaches the test engine as the Agent tool; its answer starts the agent.
  on('tool.call', (_, e: any) => {
    if (e.tool !== 'Agent') return { result: { ok: true } } as any
    const id = `rev-${++n}`
    w.spawned.push({ type: e.subagent_type ?? e.subagentType, prompt: e.prompt, id })
    return { result: { agentId: id, model: 'claude-opus-5-5', status: 'async_launched' } } as any
  })
  on('turn.step', async function* (_, e) {
    // The lead's step consults the advisor; a reviewer's step reports its own usage.
    const isLead = !e.agentId
    return {
      turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const,
      usage: { model: isLead ? e.model : 'claude-opus-5-5', input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0 },
      serverToolUses: isLead ? [{ id: `adv-${w.t}`, name: 'advisor', input: {}, startedAt: w.t, endedAt: w.t + 4000 }] : undefined,
    }
  })
  world = w
  return w
}

const start = ($: any) => $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

let world: World
/** A lead turn, later than the last, with one advisor consultation in it. */
async function leadTurnWithAdvisor($: any) {
  world.t += 60_000
  await world.clock.advance(60_000)
  const turnId = `L${world.t}`
  await $.turn.start({ text: 'refactor', turnId })
  for await (const _ of $.turn.step({ turnId, index: 0, model: 'claude-sonnet-5-5', effort: 'high', messageCount: 1 })) {
    // drain
  }
}


async function reviewerStep($: any, id: string) {
  for await (const _ of $.turn.step({ turnId: `T-${id}`, index: 0, model: 'opus', messageCount: 1, agentId: id })) {
    // drain
  }
}

const complete = ($: any, id: string, answer: string, reason: 'answer' | 'aborted' | 'error' | 'refusal' = 'answer') =>
  $.turn.complete({ turnId: `T-${id}`, agentId: id, answer, durationMs: 1000, isAborted: reason === 'aborted', reason, ...(reason === 'refusal' ? { refusal: {} } : {}) })

const councilCall = ($: any, input: Record<string, unknown>) => $.tool.call({ tool: 'mcp__nexus__council_review', ...input } as any)

const run = async ($: any, args: string) => ((await $.command.run({ command: 'nexus', args })) as { text?: string }).text ?? ''
const status = ($: any) => run($, 'council status')


const paneProps = (bodyColumns: number) =>
  ({ plugin: 'nexus', component: 'Pane', requestId: 'nexus', surface: 'terminal', props: { title: 'NEXUS', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 46 }, view: {} } }) as const

async function panel($: any, width: number): Promise<string> {
  const ui = await $.ui.mount(paneProps(width))
  const all = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text ?? '').join('\n')
  await ui.unmount()
  return all
}

test('registration: three hidden Opus reviewers, read-only by definition; the review tools are declared', async ($, on) => {
  const w = engine(on)
  await start($)
  expect(w.registered.agents.map(a => a.name)).toEqual(['council-security', 'council-architecture', 'council-performance'])
  for (const a of w.registered.agents) {
    expect(a.model).toBe('opus')
    expect(a.tools).toEqual(['Read', 'Grep', 'Glob', 'mcp__nexus__request_capability', 'mcp__nexus__git_read'])
    for (const t of ['Write', 'Edit', 'Bash', 'WebFetch', 'Agent']) expect(a.disallowedTools).toContain(t)
    expect(a.maxTurns).toBe(undefined) // no hidden cutoff
  }
  expect(w.registered.tools).toEqual(['council_review', 'request_capability', 'git_read'])
})

test('adaptive (default): the advisor’s pick asks the engine for exactly that one specialist, with the snapshot and its reason', async ($, on) => {
  const w = engine(on)
  await start($)
  await leadTurnWithAdvisor($)
  await councilCall($, { summary: 'batched user queries', selection: 'performance', rationale: 'loop over users' })
  expect(w.spawned.map(s => s.type)).toEqual(['nexus:council-performance'])
  expect(w.spawned[0]!.prompt).toMatch(/PERFORMANCE reviewer/)
  expect(w.spawned[0]!.prompt).toMatch(/Why you were asked: loop over users/)
  expect(w.spawned[0]!.prompt).toMatch(/await query\(u\)/)
  expect(w.gitCalls.map(a => a[1])).toEqual(expect.arrayContaining(['rev-parse', 'diff', 'ls-files']))
  expect(w.gitCalls.some(a => ['add', 'stash', 'reset', 'checkout', 'commit'].includes(a[1]!))).toBe(false) // the index is never touched
})

test('on: all three specialists are requested for one checkpoint', async ($, on) => {
  const w = engine(on, { prefs: { version: 3, council: { activation: 'on' } } })
  await start($)
  await leadTurnWithAdvisor($)
  await councilCall($, { summary: 's', selection: 'all' })
  expect(w.spawned.map(s => s.type)).toEqual(['nexus:council-security', 'nexus:council-architecture', 'nexus:council-performance'])
})

test('a reviewer the engine did not start is FAILED (not launched), never done; and that diff can be tried again', async ($, on) => {
  const w = engine(on, { prefs: { version: 3, council: { activation: 'on' } } })
  await start($)
  await leadTurnWithAdvisor($)
  const out = (await councilCall($, { summary: 's', selection: 'all' })).result as string
  expect(out).toMatch(/SECURITY: FAILED: not launched/)
  expect(out).not.toMatch(/done/)
  expect(await status($)).toMatch(/last checkpoint #\d+: partial/)
  await leadTurnWithAdvisor($)
  expect((await councilCall($, { summary: 's', selection: 'all' })).result).not.toMatch(/already reviewed/)
  expect(w.spawned.length).toBe(6)
})

test('adaptive: the advisor picked none, or nothing readable: no reviewer is requested', async ($, on) => {
  const w = engine(on)
  await start($)
  await leadTurnWithAdvisor($)
  expect((await councilCall($, { summary: 's', selection: 'none', rationale: 'trivial rename' })).result).toMatch(/advisor selected no specialist: trivial rename/)
  await leadTurnWithAdvisor($)
  expect((await councilCall($, { summary: 's', selection: 'all of them please' })).result).toMatch(/no specialist/)
  expect(w.spawned).toEqual([])
})

test('adaptive: without an advisor consultation this turn nothing is requested', async ($, on) => {
  const w = engine(on)
  await start($)
  await $.turn.start({ text: 'x', turnId: 'L0' })
  expect((await councilCall($, { summary: 's', selection: 'security' })).result).toMatch(/no advisor consultation was seen this turn/)
  expect(w.spawned).toEqual([])
})

test('off: nothing is requested, and the original advisor panel is drawn', async ($, on) => {
  const w = engine(on, { prefs: { version: 3, council: { activation: 'off' } } })
  await start($)
  await leadTurnWithAdvisor($)
  expect((await councilCall($, { summary: 's', selection: 'security' })).result).toMatch(/Council is off/)
  expect(w.spawned).toEqual([])
  const all = await panel($, 120)
  expect(all).toMatch(/recent/)
  expect(all).not.toMatch(/SECURITY|ARCHITECTURE|PERFORMANCE/)
})

test('nothing to review: refused without a request', async ($, on) => {
  const w = engine(on)
  await start($)
  await leadTurnWithAdvisor($)
  w.diff = ''
  expect((await councilCall($, { summary: 's', selection: 'security' })).result).toMatch(/no changes to review/)
  expect(w.spawned).toEqual([])
})

test('no recursion: a subagent cannot call council_review', async ($, on) => {
  const w = engine(on)
  await start($)
  const out = await $.tool.call({ tool: 'mcp__nexus__council_review', summary: 's', agentId: 'some-agent' } as any).catch((e: unknown) => ({ deny: String(e) }))
  expect(JSON.stringify(out)).toMatch(/lead only|deny/)
  expect(w.spawned).toEqual([])
})

test('capabilities are only for council reviewers: anyone else asking is denied and logged', async ($, on) => {
  engine(on)
  await start($)
  const ask = await $.tool.call({ tool: 'mcp__nexus__request_capability', capability: 'git_read', reason: 'x', agentId: 'haiku-1' } as any)
  expect(JSON.stringify(ask)).toMatch(/Denied \(only council reviewers/)
  const git = await $.tool.call({ tool: 'mcp__nexus__git_read', op: 'log', agentId: 'haiku-1' } as any).catch((e: unknown) => ({ deny: String(e) }))
  expect(JSON.stringify(git)).toMatch(/council reviewers only|deny/)
  expect(await run($, 'council ledger')).toMatch(/-\s+git_read\s+deny\s+only council reviewers/)
})

test('instructions reach the lead only while Council is not off, and never a reviewer', async ($, on) => {
  engine(on)
  await start($)
  const compose = (tools: string[]) =>
    $.prompt.compose({ model: 'claude-sonnet-5-5', promptModel: 'claude-sonnet-5-5', surfaces: ['terminal'], tools, outputStyle: null, traits: [], sections: [] } as any)
  expect(JSON.stringify(await compose(['Read', 'mcp__nexus__council_review']))).toMatch(/NEXUS Council is ADAPTIVE/)
  expect(JSON.stringify(await compose(['Read', 'Grep', 'Glob', 'mcp__nexus__request_capability']))).not.toMatch(/NEXUS Council/)
  await run($, 'council off')
  expect(JSON.stringify(await compose(['Read', 'mcp__nexus__council_review']))).not.toMatch(/NEXUS Council/)
})

test('/nexus council on: the yellow warning, saved, shown in status and on the panel; no stray Haiku cards', async ($, on) => {
  engine(on)
  await start($)
  expect(await run($, 'council on')).toMatch(/Higher token usage: Full Council runs three Opus reviewers per eligible review\. Use Adaptive for lower token consumption\./)
  expect(await run($, 'settings council.activation')).toBe('council.activation is on')
  expect(await status($)).toMatch(/Higher token usage/)
  expect(await panel($, 120)).toMatch(/Higher token usage/)
  await leadTurnWithAdvisor($)
  await councilCall($, { summary: 's', selection: 'all' })
  expect(await run($, 'agents')).toBe('No agents this session yet.')
  expect(await run($, 'council sometimes')).toMatch(/Unknown "\/nexus council sometimes"/)
})

test('the full sidebar: advisor on top, three reviewers stacked, idle ones dim; nothing on the right moves', async ($, on) => {
  engine(on)
  await start($)
  const all = await panel($, 120)
  for (const want of ['OPUS 5.5', 'Awaiting consultation.', 'council', 'ADAPTIVE', 'SECURITY', 'ARCHITECTURE', 'PERFORMANCE', 'not selected', 'main session', 'fork layer', 'delegate to subagents', 'review + verify', 'USAGE'])
    expect(all).toContain(want)
  expect(all).toMatch(/tok N\/A · cost N\/A/) // nothing reported yet: N/A, not 0
})

test('narrow and compact docks get a one-line council strip; the warning shows there in On; the list layout too', async ($, on) => {
  engine(on, { prefs: { version: 3, council: { activation: 'on' } } })
  await start($)
  for (const width of [70, 50]) {
    const all = await panel($, width)
    expect(all).toMatch(/council/)
    expect(all).toMatch(/SEC/)
    expect(all).toMatch(/Higher token usage/)
  }
  const ui = await $.ui.mount({ ...paneProps(120), props: { ...paneProps(120).props, placement: 'inline' } } as any)
  const list = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text ?? '').join('\n')
  await ui.unmount()
  expect(list).toMatch(/council/)
})

test('reduced motion: the council panel draws still, with no frame timer for idle reviewers', async ($, on) => {
  engine(on, { prefs: { version: 3, animation: 'reduced', council: { activation: 'on' } } })
  await start($)
  const all = await panel($, 120)
  expect(all).toContain('SECURITY')
  expect(all).not.toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/)
})
