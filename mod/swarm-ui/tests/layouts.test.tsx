import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { DEFAULT_PREFS, migrate, resolveLayout, setPref } from '../hooks/prefs'

const pane = (bodyColumns: number, placement: 'dock' | 'inline' = 'dock') =>
  ({ plugin: 'swarm-ui', component: 'Pane', requestId: 'swarm', surface: 'terminal', props: { title: 'swarm', isFocused: false, bodyColumns, placement, scroll: { offset: 0, bodyRows: 46 }, view: {} } }) as const

function engine(on: On, stored?: Record<string, unknown>) {
  const opened: string[] = []
  const closed: string[] = []
  mock.clock(on, { now: 4_000_000 })
  mock.env(on, { HOME: '/home/test' })
  mock.store(on, stored ?? {})
  on('settings.read', () => ({ value: { advisorModel: 'opus' } }))
  on('session.id', () => ({ value: 's' }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('config.list', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 44, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    closed.push(e.id)
    return { value: undefined } as any
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  return { opened, closed }
}

const start = ($: any) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
const run = ($: any, args: string) => ($ as any).command.run({ command: 'swarm', args })

async function texts($: any, width: number, placement: 'dock' | 'inline' = 'dock'): Promise<string> {
  const ui = await $.ui.mount(pane(width, placement))
  const all = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text ?? '').join('\n')
  await ui.unmount()
  return all
}

test('preferences: anything stored is read as valid, clamped current preferences', async () => {
  expect(migrate(undefined)).toEqual(DEFAULT_PREFS)
  expect(migrate('garbage')).toEqual(DEFAULT_PREFS)
  const m = migrate({ layout: 'sideways', logRows: 99, cacheGuard: { idleMin: 500, enabled: 'yes' } })
  expect(m.layout).toBe('auto')
  expect(m.logRows).toBe(6)
  expect(m.cacheGuard.idleMin).toBe(55)
  expect(m.cacheGuard.enabled).toBe(false)
  expect(setPref(DEFAULT_PREFS, 'layout', 'huge')).toEqual({ ok: false, why: 'layout takes auto | full | compact | minimal' })
  expect(setPref(DEFAULT_PREFS, 'cacheGuard.idleMin', '70')).toEqual({ ok: false, why: 'cacheGuard.idleMin takes 5 to 55' })
  const ok = setPref(DEFAULT_PREFS, 'telemetry.tokens', 'on')
  expect(ok.ok && ok.prefs.telemetry.tokens).toBe(true)
})

test('auto layout by width; full falls back when the pane is narrow; inline is a list', async () => {
  expect(resolveLayout(DEFAULT_PREFS, 120, 'dock')).toBe('full')
  expect(resolveLayout(DEFAULT_PREFS, 70, 'dock')).toBe('compact')
  expect(resolveLayout({ ...DEFAULT_PREFS, layout: 'full' }, 60, 'dock')).toBe('compact')
  expect(resolveLayout({ ...DEFAULT_PREFS, layout: 'compact' }, 200, 'dock')).toBe('compact')
  expect(resolveLayout(DEFAULT_PREFS, 30, 'dock')).toBe('list')
  expect(resolveLayout(DEFAULT_PREFS, 200, 'inline')).toBe('list')
})

test('a stored compact layout is drawn compact on a wide pane', async ($, on) => {
  engine(on, { prefs: { version: 1, layout: 'compact' } })
  await start($)
  const all = await texts($, 120)
  expect(all).not.toMatch(/delegate to subagents/)
  expect(all).toMatch(/opus 5\.5 advisor/)
})

test('/swarm settings changes are saved and survive a new session', async ($, on) => {
  engine(on)
  await start($)
  expect((await run($, 'settings layout compact')).text).toMatch(/layout → compact \(saved for later sessions\)/)
  expect((await run($, 'settings logRows 9')).text).toMatch(/logRows takes 0 to 6/)
  await start($) // a later session reads the store again
  expect((await run($, 'settings layout')).text).toBe('layout is compact')
  const listing = (await run($, 'settings')).text
  expect(listing).toMatch(/Claude Code settings are not touched/)
  expect(listing).toMatch(/cacheGuard\.enabled +off/)
})

test('minimal closes the pane, and leaving minimal opens it again', async ($, on) => {
  const w = engine(on)
  await start($)
  await run($, 'layout minimal')
  expect(w.closed).toContain('swarm')
  const before = w.opened.length
  await run($, 'layout full')
  expect(w.opened.length).toBe(before + 1)
})

test('Jev display: bars, one line, or hidden', async ($, on) => {
  engine(on)
  await start($)
  expect(await texts($, 120)).toMatch(/fork layer/)
  await run($, 'settings jev line')
  const line = await texts($, 120)
  expect(line).not.toMatch(/fork layer/)
  expect(line).toMatch(/^jev $/m)
  await run($, 'settings jev hidden')
  expect(await texts($, 120)).not.toMatch(/fork layer|^jev $/m)
})

test('every width draws without error, wide to narrow', async ($, on) => {
  engine(on)
  await start($)
  for (const w of [240, 120, 90, 84, 83, 60, 40, 39, 20]) expect(await texts($, w)).toMatch(/sonnet 5\.5/)
})

test('the settings view lists values in the pane', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'settings')
  const all = await texts($, 120)
  expect(all).toMatch(/plugin store only/)
  expect(all).toMatch(/cacheGuard\.idleMin/)
})

test('NEXUS header: the wordmark and running models; the old banner is gone', async ($, on) => {
  engine(on)
  await start($)
  const all = await texts($, 120)
  expect(all).toMatch(/N E X U S/)
  expect(all).toMatch(/◉/) // the emblem's hub
  expect(all).not.toMatch(/CLAUDE CODE SWARM|BUILDS|SWARMS/)
})

test('NEXUS sits on top with its subtitle beneath; the model legend is vertical under the advisor', async ($, on) => {
  engine(on)
  await start($)
  const all = await texts($, 120)
  const at = (re: RegExp) => all.search(re)
  expect(at(/N E X U S/)).toBeLessThan(at(/multi-agent command center/))
  expect(at(/multi-agent command center/)).toBeLessThan(at(/OPUS 5\.5/))
  // Under the advisor panel, one model per line, ending with the mode and the resize keys.
  expect(at(/recent/)).toBeLessThan(at(/■ sonnet 5\.5\n/))
  expect(all).toMatch(/■ sonnet 5\.5\n[\s\S]{0,40}lead\n■ haiku/)
  expect(all).toMatch(/◈ Mode: Balanced/)
  expect(all).toMatch(/↔ \/swarm width 92$/m)
  // Context and session cost sit at the bottom left, above the models.
  expect(at(/recent/)).toBeLessThan(at(/^context$/m))
  expect(at(/^session$/m)).toBeLessThan(at(/■ sonnet 5\.5\n/))
  expect(at(/↔ \/swarm width/)).toBeLessThan(at(/◂ advisor/))
})

test('/swarm width resizes the pane without key chords, clamps, and is saved', async ($, on) => {
  const w = engine(on)
  await start($)
  const opens = w.opened.length
  expect((await run($, 'width 120')).text).toMatch(/Pane width → 120 columns/)
  expect(w.opened.length).toBe(opens + 1)
  expect((await run($, 'width wider')).text).toMatch(/→ 130 columns/)
  expect((await run($, 'width narrower')).text).toMatch(/→ 120 columns/)
  expect((await run($, 'width 9999')).text).toMatch(/→ 200 columns/)
  expect((await run($, 'width')).text).toMatch(/asks for 200 columns\. Usage/)
  await start($)
  expect((await run($, 'settings paneColumns')).text).toBe('paneColumns is 200')
})

test('/swarm width says so when a width set by hand in Claude Code is in charge', async ($, on) => {
  const opened: string[] = []
  mock.clock(on, { now: 4_000_000 })
  mock.env(on, { HOME: '/home/test' })
  mock.store(on, {})
  on('settings.read', () => ({ value: { advisorModel: 'opus' } }))
  on('session.id', () => ({ value: 's' }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('config.list', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 44, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.read', (_, e) => {
    if (e.path === '/home/test/.claude.json') return { value: JSON.stringify({ pluginPanes: { dockColumns: 101 } }) }
    throw new Error('none')
  })
  await start($)
  const out = (await run($, 'width 120')).text
  expect(out).toMatch(/asked for 120 columns \(saved\), but Claude Code is keeping a width set by hand: 101 columns/)
  expect(out).toMatch(/NEXUS never edits it/)
})
