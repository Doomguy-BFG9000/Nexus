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
  gitCwds: unknown[]
  fsReads: string[]
  /** Untracked file contents as git hash-object would see them. */
  untrackedBody: string
  /** path → where a symlink lands (absolute). */
  real: Record<string, string>
  cwd: string
  /** The repository's top level when the session sits in a subfolder of it. */
  top: string | null
  failSpawn: boolean
  saved: Record<string, unknown>
  sets: string[]
  unreadable: boolean
}
let world: World

function engine(on: On, stored: Record<string, unknown> = {}, advisor: string | null = 'opus', env: Record<string, string> = {}): World {
  const clock = mock.clock(on, { now: 5_000_000 })
  const w: World = { t: 5_000_000, clock, diff: DIFF, spawned: [], answers: {}, registered: { agents: [], tools: [] }, gitCalls: [], gitCwds: [], fsReads: [], untrackedBody: 'v1', real: {}, cwd: '/repo', top: null, failSpawn: false, saved: { ...stored }, sets: [], unreadable: false }
  world = w
  mock.env(on, { HOME: '/home/test', ...env })
  // The plugin store as a plain object, so a test can see exactly what was saved (and make it unreadable).
  on('store.get', (_, e) => (w.unreadable ? ({ deny: 'disk busy' } as any) : ({ value: w.saved[String(e.key)] } as any)))
  on('store.set', (_, e) => (w.sets.push(String(e.key)), (w.saved[String(e.key)] = e.value), { value: undefined }) as any)
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
  on('prompt.submit', (_, e: any) => ({ text: e.text, context: e.context ?? [] }) as any)
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
    w.gitCwds.push((e as any).init?.cwd)
    if (argv[1] === 'rev-parse' && (w as any).notRepo) return { value: { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository', isStdoutTruncated: false, isStderrTruncated: false } }
    if (argv[1] === 'rev-parse') return ok(argv.includes('--show-toplevel') ? `${w.top ?? w.cwd}\n` : 'true\n')
    // The secret-only diff (pathspecs that select secret files) is its own call.
    if (argv[1] === 'diff' && argv.some(a => a.startsWith(':(glob,icase)'))) return ok((w as any).secretDiff ?? '')
    if (argv[1] === 'diff') return ok(w.diff)
    if (argv[1] === 'ls-files') return ok((w as any).noUntracked ? '' : '.env\0notes/new.ts\0')
    if (argv[1] === 'hash-object' && (w as any).hashFail?.(++(w as any).hashCalls)) return { value: { exitCode: 124, stdout: '', stderr: 'timed out', isStdoutTruncated: false, isStderrTruncated: false } }
    if (argv[1] === 'hash-object') return ok(argv.slice(argv.indexOf('--') + 1).map(f => `${w.untrackedBody}-${f}`).join('\n') + '\n')
    if (argv[1] === 'log') return ok('abc123 first commit\n')
    return ok('')
  })
  on('session.cwd', () => ({ value: w.cwd }) as any)
  on('session.root', () => ({ value: '/home/me' }) as any) // where the session started: not the repository
  on('fs.stat', (_, e) => {
    const p = String(e.path)
    const abs = p.startsWith('/') ? p : `${w.cwd}/${p}`
    if ((w as any).statFail?.[abs]) return { deny: (w as any).statFail[abs] } as any
    return { value: { kind: 'file', size: 1, mtimeMs: 0, isLink: abs in w.real, realPath: w.real[abs] ?? abs } } as any
  })
  on('fs.read', (_, e) => (w.fsReads.push(String(e.path)), String(e.path).endsWith('src/db.ts') ? ({ value: 'a\nb\nc\n' } as any) : ({ deny: 'missing' } as any)))
  let n = 0
  // The engine starting an agent (as core would): the plugin's agent.spawn hook runs above this.
  on('agent.spawn', (_, e) => {
    if (w.failSpawn) throw new Error('engine fell over')
    const id = `rev-${++n}`
    w.spawned.push({ type: e.subagentType, prompt: e.prompt, id })
    return { model: 'claude-opus-5-5', agentId: id }
  })
  // The Agent tool's own result, once the foreground agent has finished.
  on('tool.call', (_, e: any) => {
    ;((w as any).toolInputs ??= []).push(e)
    if (e.tool !== 'Agent') return { result: { ok: true } } as any
    const id = [...w.spawned].reverse().find(s => s.type === e.subagent_type)?.id
    if (!id) return { deny: 'no agent' } as any
    if ((w as any).async) return { result: { status: 'async_launched', agentId: id, description: e.description, prompt: e.prompt, outputFile: `/tmp/${id}.output` } } as any
    return { result: { status: 'completed', agentId: id, content: [{ type: 'text', text: w.answers[id] ?? '' }] } } as any
  })
  on('turn.step', async function* (_, e) {
    const isLead = !e.agentId
    if (isLead && (w as any).hold) await (w as any).hold // a response still streaming
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

test('adaptive: the advisor and council_review in the same response: NEXUS waits for that request to end, then authorizes', async ($, on) => {
  const w = engine(on)
  await start($)
  w.t += 60_000
  await w.clock.advance(60_000)
  const turnId = `L${w.t}`
  await $.turn.start({ text: 'review', turnId })
  let release!: () => void
  ;(w as any).hold = new Promise<void>(r => (release = r))
  const stepping = (async () => {
    for await (const _ of $.turn.step({ turnId, index: 0, model: 'claude-sonnet-5-5', effort: 'high', messageCount: 1 })) {
      // drain
    }
  })()
  const settle = async () => {
    for (let i = 0; i < 5; i++) await status($) // dispatches of their own: the step's dispatch moves on meanwhile
  }
  await settle() // the request is under way
  const pending = councilCall($, { summary: 's', selection: 'security', rationale: 'injection' })
  await settle()
  release() // the response ends: the API reports its advisor call
  await stepping
  expect(await pending).toMatch(/authorized .*: security\./)
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

// ---- background reviewers (an interactive session can force the background) ----

const notification = ($: any, id: string, st = 'completed', result = "This agent's report was delivered to you as a message.") =>
  $.prompt.submit({ text: `<task-notification>\n<task-id>${id}</task-id>\n<status>${st}</status>\n<result>${result}</result>\n</task-notification>`, origin: { kind: 'task-notification' }, isMeta: true } as any) as Promise<any>
const ctx = async (p: Promise<any>) => ((await p).context as string[]).join('\n')
const ended = ($: any, id: string, answer: string, aborted = false) =>
  $.turn.complete({ turnId: `T-${id}`, agentId: id, answer, durationMs: 1000, isAborted: aborted, reason: aborted ? 'aborted' : 'answer' })

/** On, three reviewers launched; the engine runs each in the background. */
async function launchBackground($: any, on: any) {
  const w = engine(on)
  ;(w as any).async = true
  await start($)
  await run($, 'council on')
  await councilCall($, { summary: 'two changes', selection: 'all' })
  const ids: Record<string, string> = {}
  const notes: string[] = []
  for (const role of ['security', 'performance', 'architecture']) {
    ids[role] = (await spawn($, role, `tu-${role}`)).agentId
    notes.push((await agentResult($, role, `tu-${role}`)).note)
  }
  return { w, ids, notes }
}

test('background: an async launch is not read as an answer; each completion notification carries the checked result, the last one the merged verdict', async ($, on) => {
  const { w, ids, notes } = await launchBackground($, on)
  for (const n of notes) expect(n).toMatch(/is running in the background for checkpoint #\d+.*Do not message, resume or relaunch it/)
  for (const n of notes) expect(n).not.toMatch(/INCOMPLETE|no readable findings/)
  expect(await status($)).toMatch(/SECURITY\s+running/)
  // Auto mode: the report comes through the engine's hand-back tool, which a reviewer may use; Bash is still refused.
  expect(((await $.tool.call({ tool: 'SubagentHandback', agentId: ids.security, message: ANSWER() } as any)) as any).deny).toBe(undefined)
  expect(JSON.stringify(await $.tool.call({ tool: 'Bash', agentId: ids.security, command: 'cat .env' } as any))).toMatch(/not available to council reviewers/)
  // Auto mode's order: the hand-back message reaches the lead (from the reviewer's task) before its turn.complete.
  const handback = $.prompt.submit({ text: `Another Claude session sent a message: <agent-message from="${ids.security}"> [Subagent hand-back] …</agent-message>`, origin: { kind: 'peer' }, isMeta: true } as any)
  expect(await ctx(handback)).toMatch(/checkpoint #\d+: SECURITY done\. Waiting for architecture, performance/)
  await ended($, ids.security!, 'Report handed back.')
  expect(await ctx(notification($, 'not-a-reviewer'))).toBe('') // nothing pending: no council context
  // turn.complete first also works: the note rides on the next prompt.
  await ended($, ids.performance!, ANSWER())
  // A slash command is not read by the model: the note waits for the next real prompt.
  expect(await ctx($.prompt.submit({ text: '/nexus council status', command: 'nexus', origin: { kind: 'composer' } } as any))).toBe('')
  expect(await ctx(notification($, ids.performance!))).toMatch(/PERFORMANCE done/)
  // Stopped from the task list: INCOMPLETE, and its notification carries the merged verdict.
  const last = await ctx(notification($, ids.architecture!, 'killed', 'stopped'))
  expect(last).toMatch(/NEXUS Council · snapshot [0-9a-f]+ · on/)
  expect(last).toMatch(/ARCHITECTURE: INCOMPLETE: interrupted before it answered/)
  expect(last).toMatch(/MEDIUM · security\+performance · src\/db\.ts:2/) // the same finding from both, merged once
  await ended($, ids.architecture!, '', true)
  expect(await status($)).toMatch(/last checkpoint #\d+: partial/)
  // The checkpoint closed: a new diff can be reviewed.
  w.diff = DIFF + '+// another change\n'
  expect(await councilCall($, { summary: 'next', selection: 'all' })).toMatch(/authorized/)
})

test('background: every reviewer stopped before it answered: INCOMPLETE, not marked reviewed, the next review is allowed', async ($, on) => {
  const { ids } = await launchBackground($, on)
  for (const id of Object.values(ids)) await ended($, id, '', true)
  const note = await ctx(notification($, 'x'))
  expect(note).toMatch(/SECURITY: INCOMPLETE: interrupted before it answered/)
  expect(note).not.toMatch(/STALE/) // nothing answered: the tree is not re-hashed, and nothing is called stale
  expect(await status($)).toMatch(/last checkpoint #\d+: partial/)
  expect(await councilCall($, { summary: 'again', selection: 'all' })).toMatch(/authorized/)
})

// ---- audit regressions (branch audit/council-reliability-security-perf) ---------

test('audit: a reviewer is confined to the repository and cannot reach a secret by glob, symlink or path', async ($, on) => {
  const w = engine(on)
  w.real['/repo/notes.txt'] = '/repo/.env' // innocent name, secret target
  w.real['/repo/docs/out'] = '/Users/me/.ssh'
  await start($)
  await leadTurnWithAdvisor($)
  await councilCall($, { summary: 's', selection: 'security' })
  const { agentId } = await spawn($, 'security', 'tu-c')
  const as = async (input: Record<string, unknown>) => JSON.stringify(await $.tool.call({ ...input, agentId } as any).catch((e: unknown) => ({ deny: String(e) })))
  expect(await as({ tool: 'Grep', pattern: 'KEY', path: '/repo', glob: '.env*' })).toMatch(/could select secret files/)
  expect(await as({ tool: 'Grep', pattern: 'KEY', glob: '*' })).toMatch(/could select secret files/)
  expect(await as({ tool: 'Read', file_path: 'notes.txt' })).toMatch(/leads to a secret/)
  expect(await as({ tool: 'Grep', pattern: 'x', path: 'docs/out' })).toMatch(/leads outside the repository/)
  expect(await as({ tool: 'Read', file_path: '/etc/passwd' })).toMatch(/outside the repository/)
  expect(await as({ tool: 'Read', file_path: '../elsewhere/x.ts' })).toMatch(/outside the repository/)
  expect(await as({ tool: 'Read', file_path: '~/.claude.json' })).toMatch(/looks like a secret|inside the repository only/)
  // The ordinary review work still goes through, and every refusal is in the ledger.
  expect(await as({ tool: 'Read', file_path: 'src/db.ts' })).not.toMatch(/deny/)
  expect(await as({ tool: 'Read', file_path: '/repo/src/db.ts' })).not.toMatch(/deny/)
  expect(await as({ tool: 'Grep', pattern: 'query', glob: '*.ts' })).not.toMatch(/deny/)
  expect(await as({ tool: 'Glob', pattern: '**/*.ts' })).not.toMatch(/deny/)
  expect((await run($, 'council ledger')).match(/deny/g)?.length).toBeGreaterThanOrEqual(7)
})

test('audit: new untracked file CONTENT is part of the snapshot: an edited new file is a new diff, and an edit during the review is stale', async ($, on) => {
  const w = engine(on)
  await start($)
  await leadTurnWithAdvisor($)
  await councilCall($, { summary: 's', selection: 'security' })
  const s = await spawn($, 'security', 'tu-u')
  w.untrackedBody = 'v2' // the new file is edited while the reviewer reads it
  await finish($, s.agentId, ANSWER())
  const { note } = await agentResult($, 'security', 'tu-u')
  expect(note).toMatch(/STALE/)
  // Same names, same tracked diff, different new-file content: not "already reviewed".
  await leadTurnWithAdvisor($)
  expect(await councilCall($, { summary: 's', selection: 'security' })).toMatch(/authorized/)
  // Secret-looking untracked files are hashed but never named to a reviewer.
  expect(w.spawned.every(x => !x.prompt.includes('.env'))).toBe(true)
  expect(w.gitCalls.some(a => a[1] === 'hash-object' && !a.includes('--'))).toBe(false)
})

test('audit: unchanged untracked content and diff is still reviewed once', async ($, on) => {
  engine(on)
  await start($)
  await leadTurnWithAdvisor($)
  await councilCall($, { summary: 's', selection: 'security' })
  await review($, 'security', ANSWER())
  await leadTurnWithAdvisor($)
  expect(await councilCall($, { summary: 's', selection: 'security' })).toMatch(/already reviewed this session/)
})

test('audit: a launch the engine throws on does not wedge Council for the rest of the session', async ($, on) => {
  const w = engine(on)
  await start($)
  await leadTurnWithAdvisor($)
  await councilCall($, { summary: 's', selection: 'security' })
  w.failSpawn = true
  const failed = JSON.stringify(await spawn($, 'security', 'tu-f').catch((e: unknown) => ({ deny: String(e) })))
  expect(failed).toMatch(/deny|refused/)
  expect(await status($)).toMatch(/SECURITY\s+failed/)
  w.failSpawn = false
  await leadTurnWithAdvisor($)
  const again = await councilCall($, { summary: 's', selection: 'security' })
  expect(again).not.toMatch(/already running/)
  expect(again).toMatch(/authorized/)
  const s = await spawn($, 'security', 'tu-g')
  expect(s.agentId).toBeTruthy()
})

test('audit: finding paths from a reviewer are never read outside the repository, and secrets are not read to count lines', async ($, on) => {
  const w = engine(on)
  await start($)
  await leadTurnWithAdvisor($)
  await councilCall($, { summary: 's', selection: 'security' })
  const answer = (file: string) => `{"severity":"low","file":"${file}","line":1,"title":"t ${file.length}","evidence":"leaked: hunter2","action":"a"}`
  const { note } = await review($, 'security', '```json\n[' + [answer('../../../etc/passwd'), answer('/etc/hosts'), answer('config/.env'), answer('src/db.ts')].join(',') + ']\n```')
  expect(w.fsReads.some(p => /passwd|hosts|\.env/.test(p))).toBe(false)
  expect(w.fsReads.some(p => p.endsWith('src/db.ts'))).toBe(true)
  expect(note).toMatch(/reference outside-repo/)
  expect(note).toMatch(/reference secret-path/)
  expect(note).not.toMatch(/hunter2.*\n.*hunter2.*\n.*hunter2.*\n.*hunter2/) // withheld for three of the four
  expect((note.match(/hunter2/g) ?? []).length).toBe(1)
})

test('audit: Council follows the session\'s directory now, and works from the repository\'s top level when that is a subfolder', async ($, on) => {
  const w = engine(on)
  await start($)
  w.cwd = '/repo/mod/nexus' // the lead moved (a worktree, /cd) after session.start, into a folder of the repository
  w.top = '/repo'
  await leadTurnWithAdvisor($)
  await councilCall($, { summary: 's', selection: 'security' })
  const inits = w.gitCalls.map((a, i) => ({ a, cwd: w.gitCwds[i] }))
  expect(inits.find(x => x.a.includes('--show-toplevel'))!.cwd).toBe('/repo/mod/nexus') // asked from where the session is
  const rest = inits.filter(x => !x.a.includes('--show-toplevel'))
  expect(rest.length).toBeGreaterThan(0)
  expect(rest.every(x => x.cwd === '/repo')).toBe(true) // everything else from the top level, where git names files from
  // Reviewers: the repository is the boundary, not the folder, and not where the session started (/home/me).
  const s = await spawn($, 'security', 'tu-top')
  const as = async (input: Record<string, unknown>) => JSON.stringify(await $.tool.call({ ...input, agentId: s.agentId } as any).catch((e: unknown) => ({ deny: String(e) })))
  expect(await as({ tool: 'Read', file_path: '/home/me/.zsh_history' })).toMatch(/outside the repository/)
  expect(await as({ tool: 'Read', file_path: '/repo/tests/x.ts' })).not.toMatch(/deny/)
  expect(await as({ tool: 'Read', file_path: '../../src/db.ts' })).not.toMatch(/deny/) // climbs out of the folder, still inside the repository
  expect(await as({ tool: 'Read', file_path: '../../../etc/hosts' })).toMatch(/outside the repository/)
  // A finding's path is the repository's: its lines are counted from the top level.
  await finish($, s.agentId, ANSWER('src/db.ts', 2))
  const { note } = await agentResult($, 'security', 'tu-top')
  expect(w.fsReads).toContain('/repo/src/db.ts')
  expect(note).not.toMatch(/reference missing-file/)
})

test('audit: a developer env override for the council mode is for the session only: it is not written to the saved settings', async ($, on) => {
  const st = engine(on, { prefs: { version: 3, council: { activation: 'adaptive' } } }, 'opus', { NEXUS_COUNCIL_ACTIVATION: 'on' })
  await start($)
  expect(await status($)).toMatch(/NEXUS Council: on/)
  await run($, 'settings animation reduced') // any later settings change saves the preferences
  expect((st.saved.prefs as any).animation).toBe('reduced')
  expect((st.saved.prefs as any).council.activation).toBe('adaptive')
  // The user's own choice still saves, even the one the override already set.
  await run($, 'council on')
  expect((st.saved.prefs as any).council.activation).toBe('on')
  await run($, 'council off')
  expect((st.saved.prefs as any).council.activation).toBe('off')
})

test('audit: a store that cannot be read at start does not overwrite the saved settings with defaults', async ($, on) => {
  const st = engine(on, { prefs: { version: 3, council: { activation: 'on' }, animation: 'full' } })
  st.unreadable = true
  await start($)
  await run($, 'settings animation reduced')
  expect(st.sets).toEqual([])
  expect((st.saved.prefs as any).council.activation).toBe('on')
  expect(await status($)).toMatch(/NEXUS Council: adaptive/) // defaults serve this session
})

// ---- audit round 2: the council's own review of this diff (checkpoint #1) --------

test('audit: a partial checkpoint (some authorized reviewers never launched) still hands the lead its verdict', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'council on')
  await leadTurnWithAdvisor($)
  await councilCall($, { summary: 's', selection: 'all' })
  const { note } = await review($, 'security', ANSWER())
  expect(note).toMatch(/SECURITY done\. Waiting for architecture, performance/) // the others were never launched
  await $.turn.complete({ turnId: `L${world.t}`, answer: 'done', durationMs: 1, isAborted: false, reason: 'answer' })
  expect(await status($)).toMatch(/last checkpoint #\d+: partial/)
  // Not dropped: the verdict rides on the lead's next prompt, with the findings and what did not run.
  const next = await ctx($.prompt.submit({ text: 'what did the council say?', origin: { kind: 'composer' } } as any))
  expect(next).toMatch(/NEXUS Council · snapshot [0-9a-f]+ · on/)
  expect(next).toMatch(/Query runs inside the loop over users/)
  expect(next).toMatch(/ARCHITECTURE: (idle|not launched|authorized)/i)
})

test('audit: a peer hand-back is read from its message body when the SubagentHandback call itself was not seen', async ($, on) => {
  const { ids } = await launchBackground($, on)
  // No tool.call for SubagentHandback: the only copy of the report is the indented body of the message to the lead.
  const body = ANSWER().split('\n').map(l => `  ${l}`).join('\n')
  const text = `Another Claude session sent a message:\n<agent-message from="${ids.security}">\n[Subagent hand-back] The text below is the final report. The report follows:\n${body}\n</agent-message>`
  expect(await ctx($.prompt.submit({ text, origin: { kind: 'peer' }, isMeta: true } as any))).toMatch(/SECURITY done\. Waiting for architecture, performance/)
  expect(await status($)).not.toMatch(/SECURITY\s+incomplete/)
})

test('audit: new files that cannot be hashed are said so, never called stale; a failed hash never counts as "already reviewed"', async ($, on) => {
  const w = engine(on) as any
  w.hashCalls = 0
  w.hashFail = (n: number) => n === 2 // the re-check after the review times out
  await start($)
  await leadTurnWithAdvisor($)
  await councilCall($, { summary: 's', selection: 'security' })
  const { note } = await review($, 'security', ANSWER())
  expect(note).not.toMatch(/STALE/)
  expect(note).toMatch(/could not re-check new files/)
  // Every hash fails from here: two failed snapshots of one tree do not look alike.
  w.hashFail = () => true
  await leadTurnWithAdvisor($)
  expect(await councilCall($, { summary: 's', selection: 'security' })).toMatch(/authorized/)
  const second = await review($, 'security', ANSWER())
  expect(second.note).not.toMatch(/already reviewed/)
  await leadTurnWithAdvisor($)
  expect(await councilCall($, { summary: 's', selection: 'security' })).toMatch(/authorized/) // not skipped as reviewed
})

test('audit: the checkpoint keeps its repository root when the session moves: line counts, git_read and confinement stay on it', async ($, on) => {
  const w = engine(on)
  await start($)
  await leadTurnWithAdvisor($)
  await councilCall($, { summary: 's', selection: 'security' })
  const s = await spawn($, 'security', 'tu-mv')
  w.cwd = '/other'
  w.top = '/other' // /cd into another repository while the reviewer runs
  const as = async (input: Record<string, unknown>) => JSON.stringify(await $.tool.call({ ...input, agentId: s.agentId } as any).catch((e: unknown) => ({ deny: String(e) })))
  expect(await as({ tool: 'Read', file_path: '/repo/src/db.ts' })).not.toMatch(/deny/)
  expect(await as({ tool: 'Read', file_path: '/other/src/db.ts' })).toMatch(/outside the repository/)
  // Council round 2: with no path, Grep and Glob would search /other, the session's directory now.
  expect(await as({ tool: 'Grep', pattern: 'KEY' })).toMatch(/outside the repository under review/)
  expect(await as({ tool: 'Glob', pattern: '**/*.ts' })).toMatch(/outside the repository under review/)
  expect(await as({ tool: 'Grep', pattern: 'KEY', path: '/repo/src' })).not.toMatch(/deny/)
  w.gitCalls.length = 0
  w.gitCwds.length = 0
  await as({ tool: 'mcp__nexus__request_capability', capability: 'git_read', reason: 'history' })
  expect(await as({ tool: 'mcp__nexus__git_read', op: 'log' })).toMatch(/abc123 first commit/)
  expect(w.gitCalls.some(a => a[1] === 'log')).toBe(true)
  await finish($, s.agentId, ANSWER('src/db.ts', 2))
  const { note } = await agentResult($, 'security', 'tu-mv')
  expect(w.fsReads.every(p => !p.startsWith('/other'))).toBe(true)
  expect(w.fsReads).toContain('/repo/src/db.ts')
  expect(w.gitCwds.filter(Boolean).every(c => c === '/repo')).toBe(true)
  expect(note).not.toMatch(/STALE/)
})

test('audit: when the file system cannot say where a path leads, the read is refused; only a missing file is "not there yet"', async ($, on) => {
  const w = engine(on) as any
  w.statFail = { '/repo/linked.txt': 'EACCES: permission denied', '/repo/src/new.ts': 'ENOENT: no such file' }
  await start($)
  await leadTurnWithAdvisor($)
  await councilCall($, { summary: 's', selection: 'security' })
  const { agentId } = await spawn($, 'security', 'tu-st')
  const as = async (input: Record<string, unknown>) => JSON.stringify(await $.tool.call({ ...input, agentId } as any).catch((e: unknown) => ({ deny: String(e) })))
  expect(await as({ tool: 'Read', file_path: 'linked.txt' })).toMatch(/could not tell where it leads/)
  expect(await as({ tool: 'Read', file_path: 'src/new.ts' })).not.toMatch(/deny/)
})

test('council round 2: a stat error on the repository root refuses that call only; it is not cached for the session', async ($, on) => {
  const w = engine(on) as any
  await start($)
  await leadTurnWithAdvisor($)
  await councilCall($, { summary: 's', selection: 'security' })
  const { agentId } = await spawn($, 'security', 'tu-root')
  const as = async (input: Record<string, unknown>) => JSON.stringify(await $.tool.call({ ...input, agentId } as any).catch((e: unknown) => ({ deny: String(e) })))
  w.statFail = { '/repo': 'EBUSY: resource busy' }
  expect(await as({ tool: 'Read', file_path: 'src/db.ts' })).toMatch(/could not tell where it leads/)
  w.statFail = {}
  expect(await as({ tool: 'Read', file_path: 'src/db.ts' })).not.toMatch(/deny/)
})

test('council round 3: the reviewer Grep that reaches the tool carries the secret negations after its own glob', async ($, on) => {
  const w = engine(on) as any
  await start($)
  await leadTurnWithAdvisor($)
  await councilCall($, { summary: 's', selection: 'security' })
  const { agentId } = await spawn($, 'security', 'tu-neg')
  await $.tool.call({ tool: 'Grep', pattern: 'KEY', glob: '*.ts', agentId } as any)
  await $.tool.call({ tool: 'Grep', pattern: 'KEY', agentId } as any)
  const greps = w.toolInputs.filter((e: any) => e.tool === 'Grep')
  expect(greps[0].glob.startsWith('*.ts ')).toBe(true)
  expect(greps[0].glob).toContain('!.[eE][nN][vV].*')
  expect(greps[1].glob.startsWith('!')).toBe(true)
  // The lead's own Grep is not rewritten.
  await $.tool.call({ tool: 'Grep', pattern: 'KEY', glob: '*.ts' } as any)
  expect(w.toolInputs.filter((e: any) => e.tool === 'Grep').at(-1).glob).toBe('*.ts')
})

test('council round 3: when the root and the path both fail to resolve, the read is refused (the two failures do not match each other)', async ($, on) => {
  const w = engine(on) as any
  await start($)
  await leadTurnWithAdvisor($)
  await councilCall($, { summary: 's', selection: 'security' })
  const { agentId } = await spawn($, 'security', 'tu-both')
  w.statFail = { '/repo': 'EIO: i/o error', '/etc/passwd': 'EIO: i/o error' }
  const r = JSON.stringify(await $.tool.call({ tool: 'Read', file_path: '/etc/passwd', agentId } as any).catch((e: unknown) => ({ deny: String(e) })))
  expect(r).toMatch(/deny/)
  expect(w.fsReads).not.toContain('/etc/passwd')
})

test('council round 3: a reviewer left running outside any repository is refused, not confined to wherever the session is', async ($, on) => {
  const w = engine(on) as any
  await start($)
  await leadTurnWithAdvisor($)
  await councilCall($, { summary: 's', selection: 'security' })
  const s = await spawn($, 'security', 'tu-norepo')
  await finish($, s.agentId, ANSWER('src/db.ts', 2))
  await agentResult($, 'security', 'tu-norepo') // the checkpoint closes; the reviewer id stays known to the gate
  w.cwd = '/tmp/elsewhere'
  w.notRepo = true
  const as = async (input: Record<string, unknown>) => JSON.stringify(await $.tool.call({ ...input, agentId: s.agentId } as any).catch((e: unknown) => ({ deny: String(e) })))
  expect(await as({ tool: 'Grep', pattern: 'KEY' })).toMatch(/could not tell where the repository is/)
  expect(await as({ tool: 'Read', file_path: 'x.ts' })).toMatch(/could not tell where the repository is/)
})

test('council round 4: a changed tracked secret is left out of the reviewers\' diff, and changing it is still a new snapshot', async ($, on) => {
  const w = engine(on) as any
  w.secretDiff = 'diff --git a/.env b/.env\n--- a/.env\n+++ b/.env\n@@ -1 +1 @@\n-A=1\n+A=MARKER\n'
  await start($)
  await leadTurnWithAdvisor($)
  await councilCall($, { summary: 's', selection: 'security' })
  const diffCall = w.gitCalls.find((a: string[]) => a[1] === 'diff' && !a.some(x => x.startsWith(':(glob,icase)')))
  expect(diffCall).toContain(':(exclude,glob,icase)**/.env')
  const s = await spawn($, 'security', 'tu-sec')
  const task = w.spawned.find((x: any) => x.id === s.agentId).prompt as string
  expect(task).not.toContain('MARKER')
  expect(task).toMatch(/1 changed file\(s\) that look like secrets were left out of the diff/)
  // Editing only the secret during the review makes the checkpoint stale.
  w.secretDiff = w.secretDiff.replace('MARKER', 'MARKER2')
  await finish($, s.agentId, ANSWER('src/db.ts', 2))
  const { note } = await agentResult($, 'security', 'tu-sec')
  expect(note).toMatch(/STALE/i)
})
