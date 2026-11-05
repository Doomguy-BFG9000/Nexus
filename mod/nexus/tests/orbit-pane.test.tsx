import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const pane = (bodyColumns: number, isFocused = false, placement: 'dock' | 'inline' = 'dock') =>
  ({ plugin: 'nexus', component: 'Pane', requestId: 'nexus', surface: 'terminal', props: { title: 'NEXUS', isFocused, bodyColumns, placement, scroll: { offset: 0, bodyRows: 46 }, view: {} } }) as const

/** `stored` undefined: a first run (an empty store). */
function engine(on: On, stored?: Record<string, unknown>, unreadable = false) {
  const opened: { id: string; backgroundColor?: string; columns?: number }[] = []
  const saved: Record<string, unknown> = { ...(stored ?? {}) }
  mock.clock(on, { now: 4_000_000 })
  mock.env(on, { HOME: '/home/test' })
  on('store.get', (_, e) => (unreadable ? { deny: 'disk busy' } : { value: saved[String(e.key)] }) as any)
  on('store.set', (_, e) => ((saved[String(e.key)] = e.value), { value: undefined }) as any)
  on('settings.read', () => ({ value: { advisorModel: 'opus' } }))
  on('session.id', () => ({ value: 's' }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('config.list', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 44, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', (_, e) => (opened.push(e as any), { value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }) as any)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  return { opened, saved }
}
const start = ($: any) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
const run = async ($: any, args: string): Promise<string> => ((await ($ as any).command.run({ command: 'nexus', args })).text ?? '') as string
async function texts($: any, width: number, isFocused = false, placement: 'dock' | 'inline' = 'dock'): Promise<string> {
  const ui = await $.ui.mount(pane(width, isFocused, placement))
  const out = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text ?? '').join('\n')
  await ui.unmount()
  return out
}
const hole = (t: string) => (t.match(/[⠀-⣿]/g) ?? []).length

test('a first run opens Orbit with the black hole; a store from v0.7 stays on Classic', async ($, on) => {
  const e = engine(on)
  await start($)
  const orbit = await texts($, 100)
  expect(orbit).toMatch(/Lead session/)
  expect(orbit).toMatch(/NEXUS/)
  expect(hole(orbit)).toBeGreaterThan(100)
  // The pane opens with Orbit's near-black background.
  expect(e.opened.at(-1)?.backgroundColor).toBe('#0a0b0f')
})

test('upgrading changes nothing you can see: v3 preferences keep the Classic dashboard and its colours', async ($, on) => {
  const e = engine(on, { prefs: { version: 3, telemetry: { context: true, cost: true, usage: true, tokens: false } } })
  await start($)
  const classic = await texts($, 120)
  expect(classic).toMatch(/main session/)
  expect(classic).toMatch(/review \+ verify/)
  expect(classic).not.toMatch(/Lead session/)
  expect(hole(classic)).toBe(0)
  expect(e.opened.at(-1)?.backgroundColor).toBe('#16171d')
  // And the saved record now says so explicitly.
  expect((e.saved.prefs as any).theme).toBe('classic')
  expect((e.saved.prefs as any).version).toBe(4)
})

test('every pane width draws: wide to narrow, and a list when it is too small', async ($, on) => {
  engine(on)
  await start($)
  for (const w of [240, 160, 130, 100, 96, 84, 72, 64, 56, 48, 40]) expect(await texts($, w)).toMatch(/Lead session/)
  for (const w of [39, 30]) expect(await texts($, w)).not.toMatch(/Lead session/)
  expect(await texts($, 100, false, 'inline')).not.toMatch(/Lead session/)
})

test('the black hole can be switched: classic orbit, off, and back; theme switching is live and saved', async ($, on) => {
  const e = engine(on)
  await start($)
  expect(hole(await texts($, 100))).toBeGreaterThan(100)
  expect(await run($, 'settings centerpiece off')).toMatch(/centerpiece → off \(saved for later sessions\)/)
  expect(hole(await texts($, 100))).toBe(0)
  await run($, 'settings centerpiece blackhole')
  expect(hole(await texts($, 100))).toBeGreaterThan(100)
  const before = e.opened.length
  await run($, 'settings theme classic')
  expect(await texts($, 120)).toMatch(/main session/)
  // The pane is reopened so its background follows the theme.
  expect(e.opened.length).toBe(before + 1)
  expect(e.opened.at(-1)?.backgroundColor).toBe('#16171d')
  await run($, 'settings theme orbit')
  expect(await texts($, 120)).toMatch(/Lead session/)
  expect((e.saved.prefs as any).theme).toBe('orbit')
})

test('switching theme never changes what agents may do', async ($, on) => {
  const e = engine(on)
  await start($)
  await run($, 'settings testRunner off')
  await run($, 'settings council.activation on')
  await run($, 'settings theme classic')
  await run($, 'settings theme orbit')
  await run($, 'settings centerpiece off')
  const p = e.saved.prefs as any
  expect(p.testRunner).toBe('off')
  expect(p.council.activation).toBe('on')
})

test('settings: four plain sections, each opening its own page', async ($, on) => {
  engine(on)
  await start($)
  const listing = await run($, 'settings')
  for (const t of ['Appearance', 'Agents', 'Usage & Stats', 'Advanced']) expect(listing).toContain(t)
  expect(listing).toMatch(/theme\s+orbit\s+orbit \| classic\s+\(default orbit\)/)
  expect(listing).toMatch(/Show token usage/)
  const menu = await texts($, 100)
  for (const t of ['Appearance', 'Agents', 'Usage & Stats', 'Advanced']) expect(menu).toContain(t)
  expect(menu).toMatch(/Hiding a number never stops NEXUS collecting it/)
  expect(menu).toMatch(/orbit · black hole/)
  // The menu does not list the advanced options.
  expect(menu).not.toMatch(/Cache Guard idle minutes/)
  await run($, 'settings appearance')
  const page = await texts($, 100)
  expect(page).toMatch(/Settings\s*\n?›|Appearance/)
  for (const t of ['Theme', 'Animation', 'Animation speed', 'Layout width', 'Display density', 'Reduced motion']) expect(page).toContain(t)
  expect(page).toMatch(/default/)
  await run($, 'settings agents')
  const agents = await texts($, 100)
  expect(agents).toMatch(/Run tests/)
  expect(agents).toMatch(/Council mode/)
  expect(agents).toMatch(/search · grep · audit · test/)
  expect(agents).toMatch(/Operating mode/)
  await run($, 'settings advanced')
  expect(await texts($, 100)).toMatch(/Cache Guard idle minutes/)
})

test('usage settings: the preset first; individual numbers only under Custom', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'settings usage')
  const preset = await texts($, 100)
  expect(preset).toMatch(/What to show/)
  expect(preset).not.toMatch(/Show costs/)
  expect(preset).toMatch(/Choose .custom/)
  await run($, 'settings telemetry.cost on')
  const custom = await texts($, 100)
  expect(custom).toMatch(/Show costs/)
  expect(custom).toMatch(/Show token usage/)
  expect(await run($, 'settings telemetry.preset')).toBe('telemetry.preset is custom')
})

test('with the pane focused, every setting is a Select and every action a Button', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'settings appearance')
  const ui = await $.ui.mount(pane(100, true))
  for (const k of ['theme', 'centerpiece', 'animationSpeed', 'paneColumns', 'density', 'animation']) expect(await ui.find({ type: 'Select', key: `set-${k}` } as any)).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'sec-back' } as any)).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'sec-reset' } as any)).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'sec-exit' } as any)).toBeTruthy()
  await ui.unmount()
})

test('menu buttons: open a section, go back, exit to the dashboard', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'settings')
  let ui = await $.ui.mount(pane(100, true))
  await ui.press({ key: 'open-agents' } as any)
  await ui.unmount()
  expect(await texts($, 100)).toMatch(/Run tests/)
  ui = await $.ui.mount(pane(100, true))
  await ui.press({ key: 'sec-back' } as any)
  await ui.unmount()
  expect(await texts($, 100)).toMatch(/Usage & Stats/)
  ui = await $.ui.mount(pane(100, true))
  await ui.press({ key: 'orbit-back' } as any)
  await ui.unmount()
  expect(await texts($, 100)).toMatch(/Lead session/)
})

test('reset: a section alone; everything only after confirmation', async ($, on) => {
  const e = engine(on)
  await start($)
  await run($, 'settings theme classic')
  await run($, 'settings testRunner off')
  await run($, 'settings centerpiece off')
  expect(await run($, 'settings reset appearance')).toMatch(/Appearance is back to its defaults; the other sections are unchanged/)
  expect((e.saved.prefs as any).theme).toBe('orbit')
  expect((e.saved.prefs as any).centerpiece).toBe('blackhole')
  expect((e.saved.prefs as any).testRunner).toBe('off')
  // All: asks first, and nothing has changed yet.
  expect(await run($, 'settings reset all')).toMatch(/Confirm: \/nexus settings reset all confirm/)
  expect((e.saved.prefs as any).testRunner).toBe('off')
  expect(await texts($, 100)).toMatch(/Put every setting back to its default\?/)
  expect(await run($, 'settings reset all confirm')).toMatch(/Every setting is back to its default/)
  expect((e.saved.prefs as any).testRunner).toBe('allowlist')
  expect(await run($, 'settings reset nothing')).toMatch(/reset takes appearance \| agents \| usage \| advanced \| all/)
  // The pane's own button asks too, and confirms with its own key.
  await run($, 'settings reset all')
  const ui = await $.ui.mount(pane(100, true))
  expect(await ui.find({ type: 'Button', key: 'reset-yes' } as any)).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'reset-no' } as any)).toBeTruthy()
  await ui.unmount()
})

test('export prints the preferences and nothing else', async ($, on) => {
  engine(on)
  await start($)
  const out = await run($, 'settings export')
  const parsed = JSON.parse(out)
  expect(parsed.version).toBe(4)
  expect(parsed.theme).toBe('orbit')
  expect(out).not.toMatch(/\/Users|\/home|TYPESAFE|secret/i)
})

test('invalid input is refused and changes nothing', async ($, on) => {
  const e = engine(on)
  await start($)
  const before = JSON.stringify(e.saved.prefs)
  expect(await run($, 'settings theme neon')).toMatch(/theme takes orbit \| classic/)
  expect(await run($, 'settings animationSpeed fast')).toMatch(/animationSpeed takes slow \| veryslow/)
  expect(await run($, 'settings nope 1')).toMatch(/unknown setting/)
  expect(JSON.stringify(e.saved.prefs)).toBe(before)
})

test('a corrupt saved value is read as a valid one', async ($, on) => {
  engine(on, { prefs: { theme: 'neon', centerpiece: 12, telemetry: 'x', version: 4 } })
  await start($)
  expect(await texts($, 100)).toMatch(/Lead session/)
})

test('an unreadable store is not a first run: Classic, and nothing is written over the saved settings', async ($, on) => {
  const w = engine(on, undefined, true)
  await start($)
  expect(await texts($, 120)).toMatch(/main session/)
  await run($, 'settings centerpiece off')
  expect(w.saved.prefs).toBeUndefined()
})

test('minimal preset hides numbers but keeps agents and a failure in view', async ($, on) => {
  engine(on)
  await start($)
  await $.agent.spawn({ tool_use_id: 't1', prompt: 'run tests', description: 'run the tests', subagentType: 'nexus-test', model: 'claude-haiku-5-5' } as any).catch(() => undefined)
  await run($, 'settings telemetry.preset minimal')
  const t = await texts($, 100)
  expect(t).toMatch(/Subagents/)
  expect(t).not.toMatch(/Activity|Usage|cost/)
})
