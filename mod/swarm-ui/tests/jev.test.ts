import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const KEY = 'apikey_test_0123456789abcdef'

type Reply = { status: number; body?: unknown } | 'hang' | 'throw'

function engine(on: On, w: { keychain: boolean; env?: string; reply: Reply }) {
  const clock = mock.clock(on, { now: 5_000_000 })
  const sent: { url: string; auth: string | undefined; body: string }[] = []
  const logged: string[] = []
  mock.env(on, { HOME: '/home/test', ...(w.env ? { TYPESAFE_API_KEY: w.env } : {}) })
  on('settings.read', () => ({ value: { advisorModel: 'opus' } }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('config.list', () => ({ value: [] }))
  on('process.run', (_, e) =>
    w.keychain && e.argv[0] === '/usr/bin/security'
      ? { value: { exitCode: 0, stdout: `${KEY}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      : { value: { exitCode: 44, stdout: '', stderr: 'The specified item could not be found.', isStdoutTruncated: false, isStderrTruncated: false } },
  )
  on('fs.read', () => {
    throw new Error('none')
  })
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.log', (_, e) => {
    logged.push(JSON.stringify(e))
    return { value: undefined } as any
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: { ok: true } }))
  on('http.fetch', async (_, e) => {
    sent.push({ url: e.url, auth: e.init?.headers?.Authorization, body: String(e.init?.body ?? '') })
    if (w.reply === 'hang') {
      await clock.sleep(60_000)
      return { value: { status: 200, ok: true, headers: {}, text: '{}' } }
    }
    if (w.reply === 'throw') throw new Error('ECONNREFUSED')
    const { status, body } = w.reply
    return { value: { status, ok: status < 300, headers: {}, text: typeof body === 'string' ? body : JSON.stringify(body ?? {}) } }
  })
  return { clock, sent, logged }
}

const ANSWER = {
  model: 'jev-1.14.0',
  answers: {
    'which tool': { type: 'choice', choice: 'Read', confidence: 0.81, probabilities: { Read: 0.91, Edit: 0.09 } },
  },
  usage: { input_tokens: 341, output_tokens: 41 },
}

async function start($: any) {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
}

async function status($: any): Promise<string> {
  return (await ($ as any).command.run({ command: 'swarm-mode', args: 'status' })).text
}

async function paneText($: any): Promise<string> {
  const ui = await $.ui.mount({
    plugin: 'swarm-ui',
    component: 'Pane',
    requestId: 'swarm',
    surface: 'terminal',
    props: { title: 'swarm', isFocused: false, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 46 }, view: {} },
  } as const)
  const all = (await ui.findAll({ type: 'Text' })).map((n: any) => n.text ?? '').join('\n')
  await ui.unmount()
  return all
}

test('no key anywhere: Jev stays off and nothing is sent', async ($, on) => {
  const w = engine(on, { keychain: false, reply: { status: 200, body: ANSWER } })
  await start($)
  await $.tool.call({ tool: 'Read', file_path: '/r/a.ts' })
  await w.clock.settle()
  expect(w.sent.length).toBe(0)
  expect(await status($)).toMatch(/Jev: off \(no key/)
})

test('a key from the Keychain: a real answer is drawn with p, confidence and sharp', async ($, on) => {
  const w = engine(on, { keychain: true, reply: { status: 200, body: ANSWER } })
  await start($)
  await $.tool.call({ tool: 'Read', file_path: '/r/a.ts' })
  await w.clock.settle()
  expect(w.sent.length).toBe(1)
  expect(w.sent[0]!.auth).toBe(`Bearer ${KEY}`)
  // Only tool names and basenames leave the machine.
  expect(w.sent[0]!.body).not.toMatch(/\/r\//)
  const pane = await paneText($)
  expect(pane).toMatch(/0\.91 sharp/)
  expect(pane).toMatch(/c0\.81/)
  expect(pane).toMatch(/agreed 1\/1/)
  expect(await status($)).toMatch(/Jev: on · 1 calls · \$0\.0000 · routing observe/)
})

test('the environment variable wins over the Keychain', async ($, on) => {
  const w = engine(on, { keychain: true, env: 'env_key_1', reply: { status: 200, body: ANSWER } })
  await start($)
  await $.tool.call({ tool: 'Edit', file_path: '/r/a.ts', old_string: 'a', new_string: 'b' })
  await w.clock.settle()
  expect(w.sent[0]!.auth).toBe('Bearer env_key_1')
  expect(await paneText($)).toMatch(/agreed 0\/1/)
})

test('a split answer is drawn as split, never promoted', async ($, on) => {
  const split = { ...ANSWER, answers: { 'which tool': { choice: 'Bash', confidence: 0.24, probabilities: { Bash: 0.49, Read: 0.22 } } } }
  const w = engine(on, { keychain: true, reply: { status: 200, body: split } })
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await w.clock.settle()
  expect(await paneText($)).toMatch(/0\.49 split/)
})

for (const [name, reply, reason] of [
  ['auth failure', { status: 401 }, 'auth'],
  ['rate limit', { status: 429 }, 'rate-limited'],
  ['server error', { status: 503 }, 'http 503'],
  ['malformed JSON', { status: 200, body: 'not json{' }, 'bad json'],
  ['network error', 'throw', 'network'],
] as const) {
  test(`${name}: Jev falls back to down (${reason}) and backs off`, async ($, on) => {
    const w = engine(on, { keychain: true, reply })
    await start($)
    await $.tool.call({ tool: 'Read', file_path: '/r/a.ts' })
    await w.clock.settle()
    expect(await status($)).toMatch(new RegExp(`Jev: down \\(${reason}\\)`))
    await $.tool.call({ tool: 'Read', file_path: '/r/b.ts' })
    await w.clock.settle()
    expect(w.sent.length).toBe(1) // backing off: no second request
    // The tool calls themselves ran normally.
    expect(w.logged.join('\n')).not.toContain(KEY)
  })
}

test('a request that hangs times out after 2 s without holding the tool call', async ($, on) => {
  const w = engine(on, { keychain: true, reply: 'hang' })
  await start($)
  const ran = await $.tool.call({ tool: 'Read', file_path: '/r/a.ts' })
  expect(ran).toBeTruthy()
  await w.clock.advance(2100)
  expect(await status($)).toMatch(/Jev: down \(timeout\)/)
})

test('the per-minute rate limit holds at 30 requests', async ($, on) => {
  const w = engine(on, { keychain: true, reply: { status: 200, body: ANSWER } })
  await start($)
  for (let i = 0; i < 35; i++) {
    await $.tool.call({ tool: 'Bash', command: `echo ${i}` })
    await w.clock.settle()
  }
  expect(w.sent.length).toBe(30)
  expect(await status($)).toMatch(/rate limit/)
})

test('the key never appears in the pane, the status, the log band or a transcript line', async ($, on) => {
  const w = engine(on, { keychain: true, reply: { status: 401 } })
  await start($)
  await $.tool.call({ tool: 'Read', file_path: '/r/a.ts' })
  await w.clock.settle()
  const band = await $.ui.mount({
    plugin: 'swarm-ui',
    component: 'AbovePrompt',
    surface: 'terminal',
    props: { bodyColumns: 120, maxRows: 12, hasSurvey: false, view: {} },
  } as any)
  const bandText = (await band.findAll({ type: 'Text' })).map((n: any) => n.text ?? '').join('\n')
  await band.unmount()
  for (const out of [await paneText($), await status($), bandText, w.logged.join('\n')]) {
    expect(out).not.toContain(KEY)
    expect(out).not.toContain('apikey_')
  }
})

test('a new authenticated answer grows its bar from empty to its probability', async ($, on) => {
  const w = engine(on, { keychain: true, reply: { status: 200, body: ANSWER } })
  await start($)
  await $.tool.call({ tool: 'Read', file_path: '/r/a.ts' })
  await w.clock.settle()
  const filled = async () => ((await paneText($)).match(/which tool\s*\n?(█+)/)?.[1] ?? '').length
  await w.clock.advance(150)
  const early = await filled()
  await w.clock.advance(1000)
  const full = await filled()
  expect(early).toBeLessThan(full)
  expect(full).toBeGreaterThan(0)
})
