import { expect, test } from 'claude-code/testing'

import { DEFAULT_PREFS, PRESETS, SECTIONS, SETTINGS, defaultValue, exportPrefs, migrate, prefValue, resetAll, resetSection, setPref, visibility } from '../hooks/prefs'

const set = (p: ReturnType<typeof migrate>, k: string, v: string) => {
  const out = setPref(p, k, v)
  if (!out.ok) throw new Error(out.why)
  return out.prefs
}

test('upgrade: a store from before v4 stays on Classic with exactly the flags it had', () => {
  const v3 = { version: 3, layout: 'compact', telemetry: { context: true, cost: false, usage: true, tokens: true }, council: { activation: 'on' } }
  const m = migrate(v3)
  expect(m.version).toBe(4)
  expect(m.theme).toBe('classic')
  expect(m.telemetry).toMatchObject({ preset: 'custom', context: true, cost: false, usage: true, tokens: true })
  expect(visibility(m)).toMatchObject({ context: true, cost: false, usage: true, tokens: true })
  // Nothing about what agents may do moved.
  expect(m.council.activation).toBe('on')
  expect(m.layout).toBe('compact')
})

test('upgrade: a v3 store with no telemetry keeps v3\'s defaults (context, cost, usage on; tokens off)', () => {
  const m = migrate({ version: 3 })
  expect(m.theme).toBe('classic')
  expect(visibility(m)).toMatchObject({ context: true, cost: true, usage: true, tokens: false })
})

test('upgrade: v1 and v2 stores and a store with no version are all read as Classic', () => {
  for (const raw of [{ version: 1, layout: 'full' }, { version: 2, paneColumns: 120 }, { layout: 'full' }, { advisorOrbit: 'tight' }]) {
    expect(migrate(raw).theme).toBe('classic')
  }
  expect(migrate({ advisorOrbit: 'tight' }).orbitStyle).toBe('tight')
})

test('a first run (nothing stored) gets Orbit with the black hole and the Standard preset', () => {
  for (const raw of [undefined, null, {}, 'garbage', 42, []]) expect(migrate(raw)).toEqual(DEFAULT_PREFS)
  expect(DEFAULT_PREFS).toMatchObject({ theme: 'orbit', centerpiece: 'blackhole', animationSpeed: 'slow', telemetry: { preset: 'standard' } })
})

test('a saved v4 choice survives a round trip; migrating twice changes nothing', () => {
  const p = set(set(set(DEFAULT_PREFS, 'theme', 'classic'), 'centerpiece', 'off'), 'animationSpeed', 'veryslow')
  expect(migrate(JSON.parse(JSON.stringify(p)))).toEqual(p)
  expect(migrate(migrate({ version: 3 }))).toEqual(migrate({ version: 3 }))
})

test('invalid values fall back to defaults, never throw', () => {
  const m = migrate({ theme: 'neon', centerpiece: 7, animationSpeed: 'fast', density: null, testRunner: 'anything', telemetry: { preset: 'huge', cost: 'yes', times: 3 }, logRows: 'x' })
  expect(m).toMatchObject({ theme: 'orbit', centerpiece: 'blackhole', animationSpeed: 'slow', density: 'comfortable', testRunner: 'allowlist', logRows: 4 })
  expect(m.telemetry.preset).toBe('standard')
  expect(m.telemetry.cost).toBe(false)
  expect(() => migrate({ telemetry: 'x', cacheGuard: 5, council: [] })).not.toThrow()
})

test('the Test agent defaults to the allowlist, and an older store never gains more permission', () => {
  expect(migrate({ version: 3 }).testRunner).toBe('allowlist')
  expect(migrate({ testRunner: 'all' }).testRunner).toBe('allowlist')
  expect(migrate({ testRunner: 'off' }).testRunner).toBe('off')
})

test('presets show what they say, and Minimal never hides failures or alerts', () => {
  expect(visibility(set(DEFAULT_PREFS, 'telemetry.preset', 'minimal'))).toEqual(PRESETS.minimal)
  expect(PRESETS.minimal).toMatchObject({ context: false, cost: false, tokens: false, usage: false })
  expect(PRESETS.minimal.warnings).toBe(true)
  expect(PRESETS.standard).toMatchObject({ context: true, times: true, routing: true, usage: true, cost: false, tokens: false })
  expect(PRESETS.full).toMatchObject({ context: true, cost: true, tokens: true, times: true, routing: true, activity: true })
})

test('changing one number by hand turns the preset into Custom from what was shown, and changes nothing else', () => {
  const full = set(DEFAULT_PREFS, 'telemetry.preset', 'full')
  const c = set(full, 'telemetry.cost', 'off')
  expect(c.telemetry.preset).toBe('custom')
  expect(visibility(c)).toEqual({ ...PRESETS.full, cost: false })
  expect(prefValue(c, 'telemetry.cost')).toBe('off')
  expect(prefValue(c, 'telemetry.tokens')).toBe('on')
  // Choosing a preset again replaces the custom set.
  expect(visibility(set(c, 'telemetry.preset', 'standard'))).toEqual(PRESETS.standard)
  // Going to custom keeps what is shown, so nothing jumps.
  expect(visibility(set(full, 'telemetry.preset', 'custom'))).toEqual(PRESETS.full)
})

test('switching the theme or animation never touches what agents may do', () => {
  const base = set(set(set(DEFAULT_PREFS, 'testRunner', 'off'), 'council.activation', 'on'), 'cacheGuard.enabled', 'on')
  for (const [k, v] of [['theme', 'classic'], ['theme', 'orbit'], ['centerpiece', 'off'], ['animationSpeed', 'veryslow'], ['animation', 'reduced'], ['density', 'compact'], ['telemetry.preset', 'minimal']] as const) {
    const next = set(base, k, v)
    expect(next.testRunner).toBe('off')
    expect(next.council.activation).toBe('on')
    expect(next.cacheGuard.enabled).toBe(true)
    expect(next.escalation).toBe(base.escalation)
  }
})

test('every old /nexus settings key still works, and bad values are refused with the choices', () => {
  const old = ['layout', 'animation', 'agentDetail', 'orbitStyle', 'telemetry.context', 'telemetry.cost', 'telemetry.usage', 'telemetry.tokens', 'logRows', 'paneColumns', 'jev', 'escalation', 'cacheGuard.enabled', 'cacheGuard.idleMin', 'cacheGuard.maxHours', 'cacheGuard.maxBeats', 'cacheGuard.budgetUsd', 'cacheGuard.trustTtl', 'council.activation']
  for (const key of old) expect(SETTINGS.some(s => s.key === key)).toBe(true)
  const bad = setPref(DEFAULT_PREFS, 'theme', 'neon')
  expect(bad.ok).toBe(false)
  expect(!bad.ok && bad.why).toMatch(/orbit \| classic/)
  expect(setPref(DEFAULT_PREFS, 'logRows', '99').ok).toBe(false)
  expect(setPref(DEFAULT_PREFS, 'nope', '1').ok).toBe(false)
  expect(set(DEFAULT_PREFS, 'paneColumns', 'max').paneColumns).toBe(999)
})

test('settings are in four sections with plain labels and a stated default', () => {
  expect(SECTIONS.map(s => s.title)).toEqual(['Appearance', 'Agents', 'Usage & Stats', 'Advanced'])
  for (const spec of SETTINGS) {
    expect(SECTIONS.some(s => s.id === spec.section)).toBe(true)
    expect(spec.label.length).toBeGreaterThan(2)
    expect(spec.help.length).toBeGreaterThan(10)
    expect(defaultValue(spec.key)).not.toBe('undefined')
  }
  const label = (k: string) => SETTINGS.find(s => s.key === k)!.label
  expect(label('telemetry.tokens')).toBe('Show token usage')
  expect(label('telemetry.cost')).toBe('Show costs')
  expect(label('testRunner')).toBe('Run tests')
  expect(label('animationSpeed')).toBe('Animation speed')
  // Display settings and behaviour settings are told apart.
  expect(SETTINGS.find(s => s.key === 'testRunner')!.kind).toBe('behavior')
  expect(SETTINGS.find(s => s.key === 'theme')!.kind).toBe('display')
  expect(SETTINGS.filter(s => s.section === 'appearance').every(s => s.kind === 'display')).toBe(true)
  expect(SETTINGS.filter(s => s.section === 'usage').every(s => s.kind === 'display')).toBe(true)
})

test('reset: one section returns to defaults and leaves the others; a full reset needs the caller', () => {
  let p = migrate({ version: 3 })
  p = set(set(set(set(p, 'theme', 'classic'), 'centerpiece', 'off'), 'testRunner', 'off'), 'telemetry.cost', 'on')
  const a = resetSection(p, 'appearance')
  expect(a.theme).toBe('orbit')
  expect(a.centerpiece).toBe('blackhole')
  expect(a.testRunner).toBe('off') // Agents untouched
  expect(visibility(a).cost).toBe(true) // Usage & Stats untouched
  const u = resetSection(p, 'usage')
  expect(u.telemetry.preset).toBe('standard')
  expect(visibility(u)).toEqual(PRESETS.standard)
  expect(u.theme).toBe('classic')
  const g = resetSection(p, 'agents')
  expect(g.testRunner).toBe('allowlist')
  expect(resetAll()).toEqual(DEFAULT_PREFS)
})

test('export holds the preferences only', () => {
  const text = exportPrefs(DEFAULT_PREFS)
  expect(JSON.parse(text)).toEqual(DEFAULT_PREFS)
  expect(text).not.toMatch(/secret|\/Users|\/home|apikey/i)
})
