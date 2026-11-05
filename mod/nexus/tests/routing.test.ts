import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { CLASSIC } from './classic'

const KEY = 'apikey_routing_test_key'
const CWD = '/work/repo'

type Ask = { history: string[]; question: string; criteria: string[] }
type Answer = { choice: string; p: number; confidence: number } | 'fail'

/** Jev's answers by question; calibration cases answered right unless `calibration` says otherwise. */
type World = {
  answer?: (a: Ask) => Answer
  calibration?: 'right' | 'unsafe'
  /** What the read-only tool beneath returns, call by call. */
  reads?: ('ok' | 'missing' | 'timeout')[]
  readOnly?: boolean
  siblings?: string[]
  /** Set mid-test: every Jev request fails from then on. */
  isDown?: boolean
}

const RIGHT: Record<string, string> = {
  'missing file': 'change',
  'no permission': 'stop',
  transient: 'retry',
  import: 'router.ts',
  'failing test': 'parser.ts',
  'setup docs': 'INSTALL.md',
}

function engine(on: On, w: World) {
  const clock = mock.clock(on, { now: 9_000_000 })
  const asks: Ask[] = []
  const toolRuns: string[] = []
  const reads = [...(w.reads ?? [])]
  mock.env(on, { HOME: '/home/test' })
  mock.store(on, CLASSIC)
  on('settings.read', () => ({ value: { advisorModel: 'opus' } }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('config.list', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: KEY, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.read', () => {
    throw new Error('none')
  })
  on('fs.list', () => ({ value: (w.siblings ?? []).map(name => ({ name, kind: 'file' as const, size: 10, mtimeMs: 0, isLink: false })) }))
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', () => ({ cwd: CWD }))
  on('tool.call', (_, e) => {
    toolRuns.push(String(e.tool))
    const outcome = e.tool === 'Read' ? (reads.shift() ?? 'ok') : 'ok'
    const isError = outcome !== 'ok'
    const text = outcome === 'missing' ? 'File does not exist.' : outcome === 'timeout' ? 'EAGAIN: resource temporarily unavailable' : 'contents'
    return { result: { text } as any, text, isError, isReadOnly: e.tool === 'Read' ? (w.readOnly ?? true) : false } as any
  })
  on('http.fetch', (_, e) => {
    if (w.isDown) return { value: { status: 503, ok: false, headers: {}, text: '' } }
    const body = JSON.parse(String(e.init?.body ?? '{}'))
    const history: string[] = JSON.parse(body.state).recent_actions
    const answers: Record<string, unknown> = {}
    for (const [question, q] of Object.entries<any>(body.questions)) {
      const ask = { history, question, criteria: Object.keys(q.criteria) }
      asks.push(ask)
      const cal = Object.entries(RIGHT).find(([id]) => history.join(' ').includes(CASE_MARK[id]!))
      let a: Answer
      if (cal) {
        const right = cal[1]
        a = w.calibration === 'unsafe' && cal[0] === 'missing file' ? { choice: 'retry', p: 0.95, confidence: 0.9 } : { choice: right, p: 0.95, confidence: 0.9 }
      } else a = w.answer?.(ask) ?? { choice: ask.criteria[0]!, p: 0.4, confidence: 0.2 }
      if (a === 'fail') return { value: { status: 503, ok: false, headers: {}, text: '' } }
      answers[question] = { choice: a.choice, confidence: a.confidence, probabilities: { [a.choice]: a.p } }
    }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ answers, usage: { input_tokens: 300 } }) } }
  })
  return { clock, asks, toolRuns, world: w }
}

// A phrase only each calibration case's history holds.
const CASE_MARK: Record<string, string> = {
  'missing file': 'Read src/app.ts',
  'no permission': '/etc/secret.conf',
  transient: 'data/report.csv',
  import: 'createRouter',
  'failing test': 'parser.test.ts',
  'setup docs': 'INSTALL.md',
}

async function start($: any) {
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
}

async function jev($: any, args: string): Promise<string> {
  return (await $.command.run({ command: 'nexus-jev', args })).text
}

async function active($: any) {
  expect(await jev($, 'active')).toMatch(/calibration passed: 6\/6 right, 0 unsafe[\s\S]*Routing is now active/)
}

const read = ($: any, file_path: string, agentId?: string) => $.tool.call({ tool: 'Read', file_path, ...(agentId ? { agentId } : {}) })

test('routing starts as observe-only: a failed read is not re-run, a read gets no note', async ($, on) => {
  const w = engine(on, { reads: ['timeout'], siblings: ['a.ts', 'b.ts'], answer: a => ({ choice: a.criteria[0]!, p: 0.99, confidence: 0.99 }) })
  await start($)
  expect(await jev($, 'status')).toMatch(/routing observe/)
  const ran = await read($, `${CWD}/src/a.ts`)
  expect(ran.isError).toBe(true)
  expect(w.toolRuns).toEqual(['Read'])
})

test('calibration passes on deterministic cases and turns routing on', async ($, on) => {
  engine(on, {})
  await start($)
  await active($)
  expect(await jev($, 'status')).toMatch(/Calibration: passed 6\/6, 0 unsafe/)
})

test('an unsafe calibration answer keeps routing off the tool path', async ($, on) => {
  const w = engine(on, { calibration: 'unsafe', reads: ['timeout'], answer: () => ({ choice: 'retry', p: 0.99, confidence: 0.99 }) })
  await start($)
  const out = await jev($, 'active')
  expect(out).toMatch(/calibration failed: 5\/6 right, 1 unsafe/)
  expect(out).toMatch(/✗ UNSAFE missing file: retry/)
  expect(out).toMatch(/Routing is now observe/)
  await read($, `${CWD}/a.ts`)
  expect(w.toolRuns).toEqual(['Read'])
})

test('active: a transient read failure is retried once when Jev is sure, and recovers', async ($, on) => {
  const w = engine(on, { reads: ['timeout', 'ok'], answer: a => (a.question === 'retry or stop' ? { choice: 'retry', p: 0.93, confidence: 0.8 } : { choice: 'Read', p: 0.3, confidence: 0.2 }) })
  await start($)
  await active($)
  const ran = await read($, '/elsewhere/data.csv')
  expect(w.toolRuns).toEqual(['Read', 'Read'])
  expect(ran.isError).not.toBe(true)
  // Only the kind of failure left the machine, never the message or the path.
  const retryAsk = w.asks.filter(a => a.question === 'retry or stop').at(-1)!
  expect(retryAsk.history.at(-1)).toBe('FAILED Read: timed out (transient)')
  expect(await jev($, 'status')).toMatch(/retries 1 \(recovered 1\)/)
})

test('active: Jev saying change or stop leaves the failure to the lead', async ($, on) => {
  const w = engine(on, { reads: ['missing'], answer: a => (a.question === 'retry or stop' ? { choice: 'change', p: 0.97, confidence: 0.9 } : { choice: 'Read', p: 0.3, confidence: 0.2 }) })
  await start($)
  await active($)
  const ran = await read($, '/elsewhere/gone.ts')
  expect(ran.isError).toBe(true)
  expect(w.toolRuns).toEqual(['Read'])
  expect(await jev($, 'status')).toMatch(/Last: no retry: change \(file not found\)/)
})

test('active: below the bar (p or confidence) falls back to the lead', async ($, on) => {
  for (const answer of [{ choice: 'retry', p: 0.7, confidence: 0.9 }, { choice: 'retry', p: 0.95, confidence: 0.3 }]) {
    const w = engine(on, { reads: ['timeout'], answer: a => (a.question === 'retry or stop' ? answer : { choice: 'Read', p: 0.3, confidence: 0.2 }) })
    await start($)
    await active($)
    await read($, '/elsewhere/x.ts')
    expect(w.toolRuns).toEqual(['Read'])
    expect(await jev($, 'status')).toMatch(/fallbacks 1/)
    break // one engine per test: the second case runs below
  }
})

test('active: low confidence alone also falls back', async ($, on) => {
  const w = engine(on, { reads: ['timeout'], answer: a => (a.question === 'retry or stop' ? { choice: 'retry', p: 0.95, confidence: 0.3 } : { choice: 'Read', p: 0.3, confidence: 0.2 }) })
  await start($)
  await active($)
  await read($, '/elsewhere/x.ts')
  expect(w.toolRuns).toEqual(['Read'])
  expect(await jev($, 'status')).toMatch(/Last: fallback: confidence 0\.30 < 0\.6/)
})

test('active: a sure next-file pick is attached as an optional note, and following it is measured', async ($, on) => {
  engine(on, { siblings: ['router.ts', 'index.ts', 'styles.css', '.env'], answer: a => (a.question === 'which file' ? { choice: 'router.ts', p: 0.92, confidence: 0.85 } : { choice: 'Read', p: 0.3, confidence: 0.2 }) })
  await start($)
  await active($)
  const ran = await read($, `${CWD}/src/index.ts`)
  expect(ran.context?.join('\n')).toMatch(/most likely is router\.ts in the same folder\. Optional/)
  await read($, `${CWD}/src/router.ts`)
  expect(await jev($, 'status')).toMatch(/Hints 2 \(followed 1\/1\)/)
})

test('active: hidden files and the file just read are never candidates', async ($, on) => {
  const w = engine(on, { siblings: ['index.ts', '.env', 'router.ts', 'util.ts'], answer: a => ({ choice: a.criteria[0]!, p: 0.3, confidence: 0.2 }) })
  await start($)
  await active($)
  await read($, `${CWD}/index.ts`)
  const ask = w.asks.find(a => a.question === 'which file' && a.criteria.includes('util.ts'))!
  expect(ask.criteria).toEqual(['router.ts', 'util.ts'])
})

test('active: a split next-file answer adds no note', async ($, on) => {
  engine(on, { siblings: ['a.ts', 'b.ts', 'c.ts'], answer: a => (a.question === 'which file' ? { choice: 'b.ts', p: 0.5, confidence: 0.4 } : { choice: 'Read', p: 0.3, confidence: 0.2 }) })
  await start($)
  await active($)
  const ran = await read($, `${CWD}/a.ts`)
  expect(ran.context ?? []).toEqual([])
})

test('never routed: writes, shell, a call not marked read-only, a subagent, outside the workspace', async ($, on) => {
  const sure = { choice: 'retry', p: 0.99, confidence: 0.99 }
  const w = engine(on, { reads: ['timeout', 'timeout'], readOnly: false, siblings: ['a.ts', 'b.ts'], answer: () => sure })
  await start($)
  await active($)
  await $.tool.call({ tool: 'Bash', command: 'false' } as any)
  await $.tool.call({ tool: 'Write', file_path: `${CWD}/a.ts`, content: 'x' } as any)
  await $.tool.call({ tool: 'Edit', file_path: `${CWD}/a.ts`, old_string: 'a', new_string: 'b' } as any)
  await read($, `${CWD}/a.ts`) // fails, but the engine did not mark it read-only
  expect(w.toolRuns).toEqual(['Bash', 'Write', 'Edit', 'Read'])
  expect(await jev($, 'status')).toMatch(/Hints 0 .* retries 0/)
})

test('never routed: a subagent read or a read outside the workspace', async ($, on) => {
  const w = engine(on, { reads: ['timeout'], siblings: ['a.ts', 'b.ts'], answer: () => ({ choice: 'retry', p: 0.99, confidence: 0.99 }) })
  await start($)
  await active($)
  await read($, `${CWD}/a.ts`, 'agent-7')
  await read($, '/etc/hosts')
  expect(w.toolRuns).toEqual(['Read', 'Read'])
  expect(w.asks.some(a => a.question === 'which file' && a.criteria.includes('a.ts'))).toBe(false)
})

test('audit: a read that only starts with the workspace path (`/ws/../etc/x`) is outside it: no sibling listing, no hint', async ($, on) => {
  const w = engine(on, { reads: [], siblings: ['a.ts', 'b.ts'], answer: () => ({ choice: 'a.ts', p: 0.99, confidence: 0.99 }) })
  await start($)
  await active($)
  const before = w.asks.length // calibration asks 'which file' too
  await read($, `${CWD}/../elsewhere/x.ts`)
  expect(w.asks.slice(before).some(a => a.question === 'which file')).toBe(false)
  await read($, `${CWD}/x.ts`) // control: a real workspace read still gets its hint
  expect(w.asks.slice(before).some(a => a.question === 'which file')).toBe(true)
})

test('/nexus-jev observe turns routing off at once', async ($, on) => {
  const w = engine(on, { reads: ['timeout'], answer: a => (a.question === 'retry or stop' ? { choice: 'retry', p: 0.95, confidence: 0.9 } : { choice: 'Read', p: 0.3, confidence: 0.2 }) })
  await start($)
  await active($)
  expect(await jev($, 'observe')).toMatch(/routing is observe from now on/)
  await read($, '/elsewhere/x.ts')
  expect(w.toolRuns).toEqual(['Read'])
})

test('/nexus-jev off sends nothing at all', async ($, on) => {
  const w = engine(on, {})
  await start($)
  await jev($, 'off')
  const before = w.asks.length
  await read($, `${CWD}/a.ts`)
  await w.clock.settle()
  expect(w.asks.length).toBe(before)
})

test('Jev unavailable during active routing: the lead decides, nothing re-runs', async ($, on) => {
  const w = engine(on, { reads: ['timeout'] })
  await start($)
  await active($)
  w.world.isDown = true
  await read($, '/elsewhere/x.ts')
  expect(w.toolRuns).toEqual(['Read'])
})

test('at most five retries a session', async ($, on) => {
  const w = engine(on, { reads: Array(12).fill('timeout'), answer: a => (a.question === 'retry or stop' ? { choice: 'retry', p: 0.95, confidence: 0.9 } : { choice: 'Read', p: 0.3, confidence: 0.2 }) })
  await start($)
  await active($)
  for (let i = 0; i < 7; i++) {
    await read($, `/elsewhere/x${i}.ts`)
    await w.clock.advance(31_000) // past any back-off
  }
  expect(w.toolRuns.length).toBe(7 + 5)
  expect(await jev($, 'status')).toMatch(/retries 5/)
})
