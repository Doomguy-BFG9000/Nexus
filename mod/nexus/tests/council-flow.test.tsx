// NEXUS Council through the test engine: mocked engine events (spawn, turn.step,
// turn.complete, the Agent tool's result, process.run), not a live Claude Code
// run. The live checks are described in docs/council-and-tool-routing.md.
import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const DIFF = 'diff --git a/src/db.ts b/src/db.ts\n--- a/src/db.ts\n+++ b/src/db.ts\n@@ -1,2 +1,3 @@\n+for (const u of users) await query(u)\n'
const ANSWER = (file = 'src/db.ts', line = 2) =>
  `Reviewed.\n\`\`\`json\n[{"severity":"medium","file":"${file}","line":${line},"title":"Query runs inside the loop over users","evidence":"await query(u) per user","action":"batch the query","confidence":0.7}]\n\`\`\``

type World = {
  t: number
  clock: { advance: (ms: number) => Promise<void> }
  diff: string
  spawned: { type: string; prompt: string; id: string }[]
  answers: Record<string, string>
  registered: { agents: any[]; tools: string[] }
  gitCalls: string[][]
}
let world: World

function engine(on: On, stored: Record<string, unknown> = {}, advisor: string | null = 'opus'): World {
  const clock = mock.clock(on, { now: 5_000_000 })
  const w: World = { t: 5_000_000, clock, diff: DIFF, spawned: [], answers: {}, registered: { agents: [], tools: [] }, gitCalls: [] }
  world = w
  mock.env(on, { HOME: '/home/test' })
  mock.store(on, stored)
  on('settings.read', () => ({ value: { advisorModel: advisor } }))
  on('session.id', () => ({ value: 's' }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('session.surface', () => ({ value: null }) as any) // command replies come back as text
  on('config.list', () => ({ value: [] }))
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }) as any)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }) as any)
  on('prompt.compose', () => ({ sections: [] }) as any)
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
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[0] !== 'git') return { value: { exitCode: 44, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    w.gitCalls.push(argv)
    if (argv[1] === 'rev-parse') return ok('true\n')
    if (argv[1] === 'diff') return ok(w.diff)
    if (argv[1] === 'ls-files') return ok((w as any).noUntracked ? '' : '.env\nnotes/new.ts\n')
    if (argv[1] === 'log') return ok('abc123 first commit\n')
    return ok('')
  })
  on('fs.read', (_, e) => (String(e.path).endsWith('src/db.ts') ? ({ value: 'a\nb\nc\n' } as any) : ({ deny: 'missing' } as any)))
  let n = 0
  // The engine starting an agent (as core would): the plugin's agent.spawn hook runs above this.
  on('agent.spawn', (_, e) => {
    const id = `rev-${++n}`
    w.spawned.push({ type: e.subagentType, prompt: e.prompt, id })
    return { model: 'claude-opus-5-5', agentId: id }
  })
  // The Agent tool's own result, once the foreground agent has finished.
  on('tool.call', (_, e: any) => {
    if (e.tool !== 'Agent') return { result: { ok: true } } as any
    const id = [...w.spawned].reverse().find(s => s.type === e.subagent_type)?.id
    if (!id) return { deny: 'no agent' } as any
    return { result: { status: 'completed', agentId: id, content: [{ type: 'text', text: w.answers[id] ?? '' }] } } as any
  })
  on('turn.step', async function* (_, e) {
    const isLead = !e.agentId
    return {
      turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const,
      usage: { model: isLead ? e.model : 'claude-opus-5-5', input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0 },
      serverToolUses: isLead ? [{ id: `adv-${w.t}`, name: 'advisor', input: {}, startedAt: w.t, endedAt: w.t + 4000 }] : undefined,
    }
  })
  return w
}

const start = ($: any) => $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
const run = async ($: any, args: string) => ((await $.command.run({ command: 'nexus', args })) as { text?: string }).text ?? ''
const status = ($: any) => run($, 'council status')
const councilCall = async ($: any, input: Record<string, unknown>) => (((await $.tool.call({ tool: 'mcp__nexus__council_review', ...input } as any)) as any).result ?? '') as string

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

/** The engine starting a reviewer for the lead's Agent call (as core does once the tool runs). */
const spawn = ($: any, role: string, tu: string) =>
  $.agent.spawn({ tool_use_id: tu, prompt: 'checkpoint #1', description: `${role} review`, subagentType: `nexus:council-${role}`, provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-sonnet-5-5', background: false, fork: false })

/** A reviewer's run: its own request (usage), then its end. */
async function finish($: any, id: string, answer: string, reason: 'answer' | 'aborted' | 'error' = 'answer') {
  world.answers[id] = answer
  for await (const _ of $.turn.step({ turnId: `T-${id}`, index: 0, model: 'opus', messageCount: 1, agentId: id })) {
    // drain
  }
  await $.turn.complete({ turnId: `T-${id}`, agentId: id, answer, durationMs: 1000, isAborted: reason === 'aborted', reason })
}

/** The lead's Agent call returning: what the model reads after it (NEXUS's note) and the call itself. */
async function agentResult($: any, role: string, tu: string) {
  const ran = (await $.tool.call({ tool: 'Agent', tool_use_id: tu, subagent_type: `nexus:council-${role}`, description: `${role} review`, prompt: 'checkpoint #1' } as any)) as any
  return { ran, note: ((ran.context ?? []) as string[]).join('\n') }
}

/** Launch, finish and return one reviewer. */
async function review($: any, role: string, answer: string, reason: 'answer' | 'aborted' | 'error' = 'answer') {
  const tu = `tu-${role}-${world.t}`
  const s = await spawn($, role, tu)
  if (!s.agentId) return { ran: s, note: '' }
  await finish($, s.agentId, answer, reason)
  return agentResult($, role, tu)
}

const paneProps = (bodyColumns: number) =>
  ({ plugin: 'nexus', component: 'Pane', requestId: 'nexus', surface: 'terminal', props: { title: 'NEXUS', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 46 }, view: {} } }) as const

async function panel($: any, width: number): Promise<string> {
  const ui = await $.ui.mount(paneProps(width))
  const all = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text ?? '').join('\n')
  await ui.unmount()
  return all
}

// ---- setup -------------------------------------------------------------------

test('registration: three Opus reviewers, read-only by definition, no turn cap; the review tools are declared', async ($, on) => {
  const w = engine(on)
  await start($)
  expect(w.registered.agents.map(a => a.name)).toEqual(['council-security', 'council-architecture', 'council-performance'])
  for (const a of w.registered.agents) {
    expect(a.model).toBe('opus')
    expect(a.tools).toEqual(['Read', 'Grep', 'Glob', 'mcp__nexus__request_capability', 'mcp__nexus__git_read'])
    for (const t of ['Write', 'Edit', 'Bash', 'WebFetch', 'Agent']) expect(a.disallowedTools).toContain(t)
    expect(a.maxTurns).toBe(undefined)
  }
  expect(w.registered.tools).toEqual(['council_review', 'request_capability', 'git_read'])
})

// ---- adaptive (default) --------------------------------------------------------

test('adaptive: the advisor’s pick authorizes exactly one specialist; it runs on the fixed snapshot and its verdict returns to the lead', async ($, on) => {
  const w = engine(on)
  await start($)
  await leadTurnWithAdvisor($)
  const auth = await councilCall($, { summary: 'batched user queries', selection: 'performance', rationale: 'loop over users' })
  expect(auth).toMatch(/authorized .*: performance\./)
  expect(auth).toMatch(/subagent_type "nexus:council-performance"/)
  expect(await status($)).toMatch(/PERFORMANCE\s+queued/)
  // Not picked: refused at the gate, nothing started.
  expect(JSON.stringify(await spawn($, 'security', 'tu-x'))).toMatch(/not authorized at checkpoint #\d+ \(the advisor picked performance\)/)
  const { note } = await review($, 'performance', ANSWER())
  expect(w.spawned.map(s => s.type)).toEqual(['nexus:council-performance'])
  expect(w.spawned[0]!.prompt).toMatch(/PERFORMANCE reviewer/) // the lead's prompt replaced by the snapshot task
  expect(w.spawned[0]!.prompt).toMatch(/Why you were asked: loop over users/)
  expect(w.spawned[0]!.prompt).toMatch(/await query\(u\)/)
  expect(w.spawned[0]!.prompt).toMatch(/notes\/new\.ts/)
  expect(w.spawned[0]!.prompt).not.toMatch(/\.env/) // a secret-looking untracked file is never pointed out
  expect(w.spawned[0]!.prompt).toMatch(/1 untracked file\(s\) that look like secrets were withheld/)
  expect(note).toMatch(/adaptive \(advisor pick: performance\)/)
  expect(note).toMatch(/PERFORMANCE: done · 1 finding/)
  expect(note).toMatch(/MEDIUM · performance · src\/db\.ts:2/)
  const st = await status($)
  expect(st).toMatch(/PERFORMANCE\s+done\s+1 findings/)
  expect(st).toMatch(/SECURITY\s+idle/)
  expect(st).toMatch(/out 500 \(reported by the reviewers/) // its own reported usage
  expect(st).toMatch(/last checkpoint #\d+: done/)
  expect(w.gitCalls.some(a => ['add', 'stash', 'reset', 'checkout', 'commit'].includes(a[1]!))).toBe(false) // the index is never touched
})

test('adaptive: the advisor picked none, or nothing readable: nothing is authorized', async ($, on) => {
  const w = engine(on)
  await start($)
  await leadTurnWithAdvisor($)
  expect(await councilCall($, { summary: 's', selection: 'none', rationale: 'trivial rename' })).toMatch(/advisor selected no specialist: trivial rename/)
  await leadTurnWithAdvisor($)
  expect(await councilCall($, { summary: 's', selection: 'all of them please' })).toMatch(/no specialist/)
  expect(JSON.stringify(await spawn($, 'security', 'tu-1'))).toMatch(/no open NEXUS Council checkpoint/)
  expect(w.spawned).toEqual([])
})

test('adaptive: without an advisor consultation this turn nothing is authorized', async ($, on) => {
  const w = engine(on)
  await start($)
  await $.turn.start({ text: 'x', turnId: 'L0' })
  expect(await councilCall($, { summary: 's', selection: 'security' })).toMatch(/no advisor consultation was seen this turn/)
  expect(w.spawned).toEqual([])
})

// ---- on -------------------------------------------------------------------------

test('on: all three are authorized; each result says who is still out; the last one carries the merged verdict', async ($, on) => {
  const w = engine(on, { prefs: { version: 3, council: { activation: 'on' } } })
  await start($)
  await leadTurnWithAdvisor($)
  expect(await councilCall($, { summary: 's', selection: 'all' })).toMatch(/security, architecture, performance\.\nLaunch them now .* all in ONE message/)
  // Launched together, before any answers.
  const ids = await Promise.all(['security', 'architecture', 'performance'].map((r, i) => spawn($, r, `tu-${i}`)))
  expect(ids.every((s: any) => s.agentId)).toBe(true)
  expect(await status($)).toMatch(/SECURITY\s+running[\s\S]*ARCHITECTURE\s+running[\s\S]*PERFORMANCE\s+running/)
  await finish($, ids[0].agentId, 'Nothing found.\n```json\n[]\n```')
  const first = await agentResult($, 'security', 'tu-0')
  expect(first.note).toMatch(/SECURITY done\. Waiting for architecture, performance/)
  await finish($, ids[1].agentId, ANSWER())
  await agentResult($, 'architecture', 'tu-1')
  await finish($, ids[2].agentId, ANSWER('src/db.ts', 3))
  const last = await agentResult($, 'performance', 'tu-2')
  expect(last.note).toMatch(/SECURITY: done · 0 findings/)
  expect(last.note).toMatch(/architecture\+performance|performance\+architecture/) // one issue, two reporters
  expect(await status($)).toMatch(/reviewers launched 3/)
  expect(w.spawned.length).toBe(3)
})

test('on: absolute paths from a reviewer are made repo-relative, and personal data is redacted from the verdict', async ($, on) => {
  engine(on, { prefs: { version: 3, council: { activation: 'on' } } })
  await start($)
  await leadTurnWithAdvisor($)
  await councilCall($, { summary: 's', selection: 'all' })
  const leak = '```json\n[{"severity":"low","file":"/repo/src/db.ts","line":1,"title":"Log mentions owner@example.com","evidence":"API_TOKEN=abcd1234secret in config","action":"remove","confidence":0.5}]\n```'
  await review($, 'security', leak)
  await review($, 'architecture', '```json\n[]\n```')
  const { note } = await review($, 'performance', '```json\n[]\n```')
  expect(note).toMatch(/src\/db\.ts:1 · confidence/) // relative, and its reference checks out
  expect(note).not.toMatch(/owner@example\.com|abcd1234secret/)
  expect(note).toMatch(/\[email redacted\]/)
  expect(note).toMatch(/API_TOKEN=\[redacted\]/)
})

// ---- failures, duplicates, staleness ---------------------------------------------

test('failures are never success: interrupted is INCOMPLETE, an API error FAILED, a missing findings block INCOMPLETE', async ($, on) => {
  engine(on, { prefs: { version: 3, council: { activation: 'on' } } })
  await start($)
  await leadTurnWithAdvisor($)
  await councilCall($, { summary: 's', selection: 'all' })
  await review($, 'security', '', 'aborted')
  await review($, 'architecture', 'partial thoughts', 'error')
  const { note } = await review($, 'performance', 'I think it is fine overall.')
  expect(note).toMatch(/SECURITY: INCOMPLETE: interrupted before it answered/)
  expect(note).toMatch(/ARCHITECTURE: FAILED: the run ended on an API error/)
  expect(note).toMatch(/PERFORMANCE: INCOMPLETE: its answer had no readable findings block/)
  expect(await status($)).toMatch(/last checkpoint #\d+: partial/)
  // Nobody answered: the same diff may be tried again.
  await leadTurnWithAdvisor($)
  expect(await councilCall($, { summary: 's', selection: 'all' })).toMatch(/authorized/)
})

test('no duplicates: a reviewer launches once per checkpoint; no second checkpoint while one runs; the same diff is reviewed once', async ($, on) => {
  const w = engine(on)
  await start($)
  await leadTurnWithAdvisor($)
  await councilCall($, { summary: 's', selection: 'security' })
  const s = await spawn($, 'security', 'tu-a')
  expect(JSON.stringify(await spawn($, 'security', 'tu-b'))).toMatch(/already launched for checkpoint/)
  expect(await councilCall($, { summary: 's', selection: 'security' })).toMatch(/already running/)
  await finish($, s.agentId, ANSWER())
  await agentResult($, 'security', 'tu-a')
  // A refused launch's Agent result leaves the finished reviewer alone.
  await $.tool.call({ tool: 'Agent', tool_use_id: 'tu-b', subagent_type: 'nexus:council-security', description: 'x', prompt: 'x' } as any).catch(() => undefined)
  expect(await status($)).toMatch(/SECURITY\s+done\s+1 findings/)
  await leadTurnWithAdvisor($)
  expect(await councilCall($, { summary: 's', selection: 'architecture' })).toMatch(/already reviewed this session/)
  expect(w.spawned.length).toBe(1)
})

test('stale: the working tree changing during the review marks the result stale', async ($, on) => {
  const w = engine(on)
  await start($)
  await leadTurnWithAdvisor($)
  await councilCall($, { summary: 's', selection: 'security' })
  const s = await spawn($, 'security', 'tu-s')
  w.diff = DIFF + '+another edit\n'
  await finish($, s.agentId, ANSWER())
  const { note } = await agentResult($, 'security', 'tu-s')
  expect(note).toMatch(/STALE/)
  expect(await status($)).toMatch(/SECURITY\s+stale/)
})

test('authorized but never launched: the lead’s turn ending closes it as such, not as a failure or a success', async ($, on) => {
  engine(on)
  await start($)
  await leadTurnWithAdvisor($)
  await councilCall($, { summary: 's', selection: 'architecture' })
  await $.turn.complete({ turnId: `L${world.t}`, answer: 'done', durationMs: 1, isAborted: false, reason: 'answer' })
  const st = await status($)
  expect(st).toMatch(/ARCHITECTURE\s+idle\s+· authorized, not launched/)
  expect(st).toMatch(/last checkpoint #\d+: partial · authorized, not launched/)
})

test('nothing to review, and no recursion from a subagent', async ($, on) => {
  const w = engine(on)
  await start($)
  await leadTurnWithAdvisor($)
  w.diff = ''
  ;(w as any).noUntracked = true
  expect(await councilCall($, { summary: 's', selection: 'security' })).toMatch(/no changes to review/)
  expect(w.spawned).toEqual([])
  const out = await $.tool.call({ tool: 'mcp__nexus__council_review', summary: 's', agentId: 'some-agent' } as any).catch((e: unknown) => ({ deny: String(e) }))
  expect(JSON.stringify(out)).toMatch(/lead only|deny/)
})

// ---- enforcement and routing ----------------------------------------------------

test('enforcement: a running reviewer is refused writes, shell, secrets and ungranted git; a git_read grant is recorded and then works', async ($, on) => {
  const w = engine(on)
  await start($)
  await leadTurnWithAdvisor($)
  await councilCall($, { summary: 's', selection: 'security' })
  const { agentId } = await spawn($, 'security', 'tu-e')
  const as = (input: Record<string, unknown>) => $.tool.call({ ...input, agentId } as any).catch((e: unknown) => ({ deny: String(e) }))
  expect(JSON.stringify(await as({ tool: 'Write', file_path: 'x.ts', content: 'y' }))).toMatch(/not available to council reviewers/)
  expect(JSON.stringify(await as({ tool: 'Bash', command: 'rm -rf /' }))).toMatch(/not available to council reviewers/)
  expect(JSON.stringify(await as({ tool: 'Read', file_path: '/repo/.env' }))).toMatch(/looks like a secret/)
  expect(JSON.stringify(await as({ tool: 'mcp__nexus__git_read', op: 'log' }))).toMatch(/needs a grant/)
  expect(JSON.stringify(await as({ tool: 'mcp__nexus__request_capability', capability: 'Bash', reason: 'run tests' }))).toMatch(/Denied/)
  expect(JSON.stringify(await as({ tool: 'mcp__nexus__request_capability', capability: 'git_read', reason: 'history of db.ts' }))).toMatch(/Granted/)
  expect(JSON.stringify(await as({ tool: 'mcp__nexus__git_read', op: 'log' }))).toMatch(/abc123 first commit/)
  expect(JSON.stringify(await as({ tool: 'mcp__nexus__git_read', op: 'blame', path: '--output=/tmp/x' }))).toMatch(/refused: invalid path/)
  expect(w.gitCalls.some(a => a.includes('--output=/tmp/x'))).toBe(false)
  const ledger = await run($, 'council ledger')
  for (const row of [/security\s+Write\s+deny/, /security\s+Bash\s+deny/, /security\s+mcp__nexus__git_read deny/, /security\s+git_read\s+grant/]) expect(ledger).toMatch(row)
  expect(await panel($, 120)).toMatch(/SECURITY[\s\S]*git_read/) // its latest activity on the panel
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

// ---- off, instructions, settings, drawing ------------------------------------------

test('off: nothing is authorized, the reviewer types are not offered, and the original advisor panel is drawn', async ($, on) => {
  const w = engine(on, { prefs: { version: 3, council: { activation: 'off' } } })
  await start($)
  await leadTurnWithAdvisor($)
  expect(await councilCall($, { summary: 's', selection: 'security' })).toMatch(/Council is off/)
  expect(JSON.stringify(await spawn($, 'security', 'tu-o'))).toMatch(/no open NEXUS Council checkpoint/)
  expect(w.spawned).toEqual([])
  const all = await panel($, 120)
  expect(all).toMatch(/recent/)
  expect(all).not.toMatch(/SECURITY|ARCHITECTURE|PERFORMANCE/)
})

test('instructions reach the lead only while Council is not off, and never a reviewer', async ($, on) => {
  engine(on)
  await start($)
  const compose = (tools: string[]) =>
    $.prompt.compose({ model: 'claude-sonnet-5-5', promptModel: 'claude-sonnet-5-5', surfaces: ['terminal'], tools, outputStyle: null, traits: [] } as any)
  expect(JSON.stringify(await compose(['Read', 'mcp__nexus__council_review']))).toMatch(/NEXUS Council is ADAPTIVE/)
  expect(JSON.stringify(await compose(['Read', 'Grep', 'Glob', 'mcp__nexus__request_capability']))).not.toMatch(/NEXUS Council/)
  await run($, 'council off')
  expect(JSON.stringify(await compose(['Read', 'mcp__nexus__council_review']))).not.toMatch(/NEXUS Council/)
})

test('/nexus council on: the yellow warning, saved, in status and on the panel; reviewers are never Haiku cards', async ($, on) => {
  engine(on)
  await start($)
  expect(await run($, 'council on')).toMatch(/Higher token usage: Full Council runs three Opus reviewers per eligible review\. Use Adaptive for lower token consumption\./)
  expect(await run($, 'settings council.activation')).toBe('council.activation is on')
  expect(await status($)).toMatch(/Higher token usage/)
  expect(await panel($, 120)).toMatch(/Higher token usage/)
  await leadTurnWithAdvisor($)
  await councilCall($, { summary: 's', selection: 'all' })
  await spawn($, 'security', 'tu-h')
  expect(await run($, 'agents')).toBe('No agents this session yet.')
  expect(await run($, 'council sometimes')).toMatch(/Unknown "\/nexus council sometimes"/)
})

test('the full sidebar: advisor on top, three reviewers stacked; the right side keeps every region; N/A before anything is reported', async ($, on) => {
  engine(on)
  await start($)
  const all = await panel($, 120)
  for (const want of ['OPUS 5.5', 'Awaiting consultation.', 'council', 'ADAPTIVE', 'SECURITY', 'ARCHITECTURE', 'PERFORMANCE', 'not selected', 'main session', 'fork layer', 'delegate to subagents', 'review + verify', 'USAGE'])
    expect(all).toContain(want)
  expect(all).toMatch(/tok N\/A · cost N\/A/)
})

test('missing telemetry stays N/A: a reviewer that reported no usage shows tok N/A', async ($, on) => {
  engine(on)
  await start($)
  await leadTurnWithAdvisor($)
  await councilCall($, { summary: 's', selection: 'architecture' })
  const s = await spawn($, 'architecture', 'tu-t')
  world.answers[s.agentId] = ANSWER()
  await $.turn.complete({ turnId: 'T-x', agentId: s.agentId, answer: ANSWER(), durationMs: 1, isAborted: false, reason: 'answer' }) // no turn.step: no usage
  await agentResult($, 'architecture', 'tu-t')
  expect(await panel($, 120)).toMatch(/tok N\/A · 1 found/)
})

test('narrow and compact docks get a one-line strip; the warning shows there in On; the list layout too', async ($, on) => {
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

test('reduced motion: the council panel draws still', async ($, on) => {
  engine(on, { prefs: { version: 3, animation: 'reduced', council: { activation: 'on' } } })
  await start($)
  const all = await panel($, 120)
  expect(all).toContain('SECURITY')
  expect(all).not.toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/)
})
