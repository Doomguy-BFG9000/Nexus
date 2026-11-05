// Dashboard preferences, kept in the plugin's own store ($.store 'prefs'),
// never in Claude Code's settings. Pure: defaults, validation, migration.
import type { Prefs, TelemetryFlags, TelemetryPreset } from '../types'

export type { Prefs, TelemetryFlags, TelemetryPreset }

/** Asking for this many columns opens the pane as wide as Claude Code allows (45% of the terminal). */
export const PANE_MAX = 999

/** What each preset shows. Visibility only: nothing here changes what NEXUS collects, routes or permits. */
export const PRESETS: Record<Exclude<TelemetryPreset, 'custom'>, TelemetryFlags> = {
  minimal: { context: false, cost: false, usage: false, tokens: false, times: false, routing: false, activity: false, warnings: true },
  standard: { context: true, cost: false, usage: true, tokens: false, times: true, routing: true, activity: true, warnings: true },
  full: { context: true, cost: true, usage: true, tokens: true, times: true, routing: true, activity: true, warnings: true },
}

const FLAGS = ['context', 'cost', 'usage', 'tokens', 'times', 'routing', 'activity', 'warnings'] as const satisfies readonly (keyof TelemetryFlags)[]

export const DEFAULT_PREFS: Prefs = {
  version: 4,
  theme: 'orbit',
  centerpiece: 'blackhole',
  animationSpeed: 'slow',
  density: 'comfortable',
  layout: 'auto',
  animation: 'auto',
  agentDetail: 'full',
  orbitStyle: 'wide',
  telemetry: { preset: 'standard', ...PRESETS.standard },
  logRows: 4,
  paneColumns: PANE_MAX,
  jev: 'bars',
  escalation: 'ask',
  testRunner: 'allowlist',
  cacheGuard: { enabled: false, idleMin: 50, maxHours: 8, maxBeats: 10, budgetUsd: 0.5, trustTtl: false },
  council: { activation: 'adaptive' },
}

const pick = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : fallback
const num = (value: unknown, lo: number, hi: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : fallback
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)

/**
 * Any stored value, of any earlier version or none, read as valid current preferences.
 *
 * Upgrading keeps the look people chose: a store written before v4 (no `theme`) stays on the
 * classic dashboard with the visibility flags it had, as the `custom` preset. Only a store with
 * nothing in it (a first run) gets the Orbit defaults.
 */
export function migrate(raw: unknown): Prefs {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, any>
  const d = DEFAULT_PREFS
  const t = (r.telemetry && typeof r.telemetry === 'object' ? r.telemetry : {}) as Record<string, unknown>
  const c = (r.cacheGuard && typeof r.cacheGuard === 'object' ? r.cacheGuard : {}) as Record<string, unknown>
  const k = (r.council && typeof r.council === 'object' ? r.council : {}) as Record<string, unknown>
  const isFirstRun = Object.keys(r).length === 0
  const isOlder = !isFirstRun && r.theme === undefined
  // What a pre-v4 store showed: the classic dashboard drew every part, and v3 had cost on by default.
  const legacy: TelemetryFlags = { context: true, cost: true, usage: true, tokens: false, times: true, routing: true, activity: true, warnings: true }
  const base: TelemetryFlags = isOlder ? legacy : PRESETS.standard
  const flags = {} as TelemetryFlags
  for (const f of FLAGS) flags[f] = bool(t[f], base[f])
  // A pre-v4 store keeps exactly its own choices (`custom`); a first run, or a bad value, is `standard`.
  const preset = pick<TelemetryPreset>(t.preset, ['minimal', 'standard', 'full', 'custom'], isOlder ? 'custom' : 'standard')
  return {
    version: 4,
    theme: pick(r.theme, ['classic', 'orbit'], isOlder ? 'classic' : d.theme),
    centerpiece: pick(r.centerpiece, ['blackhole', 'classic', 'off'], d.centerpiece),
    animationSpeed: pick(r.animationSpeed, ['slow', 'veryslow'], d.animationSpeed),
    density: pick(r.density, ['comfortable', 'compact'], d.density),
    layout: pick(r.layout, ['auto', 'full', 'compact', 'minimal'], d.layout),
    animation: pick(r.animation, ['auto', 'full', 'reduced', 'off'], d.animation),
    agentDetail: pick(r.agentDetail, ['brief', 'full'], d.agentDetail),
    // Named advisorOrbit before 0.5: carried over.
    orbitStyle: pick(r.orbitStyle ?? r.advisorOrbit, ['tight', 'wide'], d.orbitStyle),
    telemetry: { preset, ...flags },
    logRows: Math.round(num(r.logRows, 0, 6, d.logRows)),
    // From v2 on, a chosen width is kept; before it, the pane opens as wide as Claude Code allows.
    paneColumns: typeof r.version === 'number' && r.version >= 2 ? Math.round(num(r.paneColumns, 40, PANE_MAX, d.paneColumns)) : PANE_MAX,
    jev: pick(r.jev, ['bars', 'line', 'hidden'], d.jev),
    escalation: pick(r.escalation, ['ask', 'off'], d.escalation),
    // New in v4: only ever the safe default unless the person chose otherwise.
    testRunner: pick(r.testRunner, ['allowlist', 'off'], d.testRunner),
    cacheGuard: {
      enabled: bool(c.enabled, d.cacheGuard.enabled),
      idleMin: Math.round(num(c.idleMin, 5, 55, d.cacheGuard.idleMin)),
      maxHours: num(c.maxHours, 1, 24, d.cacheGuard.maxHours),
      maxBeats: Math.round(num(c.maxBeats, 1, 50, d.cacheGuard.maxBeats)),
      budgetUsd: num(c.budgetUsd, 0, 20, d.cacheGuard.budgetUsd),
      trustTtl: bool(c.trustTtl, d.cacheGuard.trustTtl),
    },
    // New in v3: earlier preferences get the default (adaptive); a stored choice is kept.
    council: { activation: pick(k.activation, ['off', 'adaptive', 'on'], d.council.activation) },
  }
}

/** What the dashboard shows now: the preset's set, or the individual choices under `custom`. */
export function visibility(prefs: Prefs): TelemetryFlags {
  const t = prefs.telemetry
  if (t.preset !== 'custom') return { ...PRESETS[t.preset] }
  const out = {} as TelemetryFlags
  for (const f of FLAGS) out[f] = t[f]
  return out
}

// ---- the settings, in four plain-language sections ------------------------------
export type SectionId = 'appearance' | 'agents' | 'usage' | 'advanced'

export const SECTIONS: { id: SectionId; title: string; blurb: string }[] = [
  { id: 'appearance', title: 'Appearance', blurb: 'How the dashboard looks and moves. Never changes what agents may do.' },
  { id: 'agents', title: 'Agents', blurb: 'What the agents are allowed to do. These change behaviour, not just the view.' },
  { id: 'usage', title: 'Usage & Stats', blurb: 'What the dashboard shows. Hiding a number never stops NEXUS collecting it.' },
  { id: 'advanced', title: 'Advanced', blurb: 'Optional features and diagnostics. The defaults are fine for most people.' },
]

export type Setting = {
  key: string
  section: SectionId
  /** The plain-language name shown in the settings view. */
  label: string
  options?: string[]
  range?: [number, number]
  /** One plain sentence, shown under the setting. */
  help: string
  /** What the choice does, in the settings view: the dashboard shows it, or agents are allowed it. */
  kind: 'display' | 'behavior'
}

/** One setting by its dotted name: what `/nexus settings <key> <value>` accepts. */
export const SETTINGS: Setting[] = [
  { key: 'theme', section: 'appearance', label: 'Theme', options: ['orbit', 'classic'], help: 'Orbit is the new look; Classic is the original dashboard.', kind: 'display' },
  { key: 'centerpiece', section: 'appearance', label: 'Animation', options: ['blackhole', 'classic', 'off'], help: 'Orbit only: the lead graphic. blackhole, the original orbit, or none.', kind: 'display' },
  { key: 'animationSpeed', section: 'appearance', label: 'Animation speed', options: ['slow', 'veryslow'], help: 'How slowly the black hole drifts.', kind: 'display' },
  { key: 'paneColumns', section: 'appearance', label: 'Layout width', range: [40, PANE_MAX], help: `Columns the pane asks for; ${PANE_MAX} means as wide as allowed (/nexus width max).`, kind: 'display' },
  { key: 'density', section: 'appearance', label: 'Display density', options: ['comfortable', 'compact'], help: 'Orbit only: comfortable adds breathing room; compact fits more.', kind: 'display' },
  { key: 'animation', section: 'appearance', label: 'Reduced motion', options: ['auto', 'full', 'reduced', 'off'], help: 'auto follows Claude Code; reduced and off draw no movement.', kind: 'display' },
  { key: 'layout', section: 'appearance', label: 'Layout', options: ['auto', 'full', 'compact', 'minimal'], help: 'auto picks by pane width.', kind: 'display' },

  { key: 'council.activation', section: 'agents', label: 'Council mode', options: ['adaptive', 'on', 'off'], help: 'Opus reviewers at a checkpoint: the advisor picks one, all three, or just the single advisor.', kind: 'behavior' },
  { key: 'testRunner', section: 'agents', label: 'Run tests', options: ['allowlist', 'off'], help: 'The Test agent may run known test commands only (allowlist), or nothing (off). On top of Claude Code’s own permissions.', kind: 'behavior' },
  { key: 'escalation', section: 'agents', label: 'Suggest a stronger mode', options: ['ask', 'off'], help: 'ask offers a stronger model mode before a harder task; it never switches by itself.', kind: 'behavior' },
  { key: 'agentDetail', section: 'agents', label: 'Agent detail', options: ['brief', 'full'], help: 'How much the agent inspection view shows.', kind: 'display' },

  { key: 'telemetry.preset', section: 'usage', label: 'What to show', options: ['minimal', 'standard', 'full', 'custom'], help: 'minimal: status and alerts. standard: plus context, times, routing, usage. full: plus tokens and cost.', kind: 'display' },
  { key: 'telemetry.tokens', section: 'usage', label: 'Show token usage', options: ['on', 'off'], help: 'Tokens per model and agent, as Claude Code reports them.', kind: 'display' },
  { key: 'telemetry.cost', section: 'usage', label: 'Show costs', options: ['on', 'off'], help: 'The session estimate at API prices. Not necessarily what a subscription is charged.', kind: 'display' },
  { key: 'telemetry.context', section: 'usage', label: 'Show context', options: ['on', 'off'], help: 'How much of the context window is used.', kind: 'display' },
  { key: 'telemetry.times', section: 'usage', label: 'Show execution times', options: ['on', 'off'], help: 'How long agents and the lead have been running.', kind: 'display' },
  { key: 'telemetry.routing', section: 'usage', label: 'Show routing info', options: ['on', 'off'], help: 'Jev decisions and Council status.', kind: 'display' },
  { key: 'telemetry.usage', section: 'usage', label: 'Show plan usage', options: ['on', 'off'], help: 'Your plan’s 5-hour and weekly windows.', kind: 'display' },
  { key: 'telemetry.activity', section: 'usage', label: 'Show activity log', options: ['on', 'off'], help: 'The live activity tape.', kind: 'display' },
  { key: 'telemetry.warnings', section: 'usage', label: 'Show usage warnings', options: ['on', 'off'], help: 'Amber warnings at 70%. Red alerts and failures always show.', kind: 'display' },
  { key: 'logRows', section: 'usage', label: 'Activity rows', range: [0, 6], help: 'How many activity rows to show.', kind: 'display' },

  { key: 'jev', section: 'advanced', label: 'Jev panel', options: ['bars', 'line', 'hidden'], help: 'How the Jev router is drawn. Whether Jev routes anything is set in the plugin options.', kind: 'display' },
  { key: 'orbitStyle', section: 'advanced', label: 'Classic orbit style', options: ['tight', 'wide'], help: 'Classic theme only.', kind: 'display' },
  { key: 'cacheGuard.enabled', section: 'advanced', label: 'Cache Guard', options: ['on', 'off'], help: 'Keeps the prompt cache warm while idle. Costs tokens; off by default.', kind: 'behavior' },
  { key: 'cacheGuard.idleMin', section: 'advanced', label: 'Cache Guard idle minutes', range: [5, 55], help: 'Idle minutes before a refresh.', kind: 'behavior' },
  { key: 'cacheGuard.maxHours', section: 'advanced', label: 'Cache Guard hours', range: [1, 24], help: 'Hours before it stops by itself.', kind: 'behavior' },
  { key: 'cacheGuard.maxBeats', section: 'advanced', label: 'Cache Guard refreshes', range: [1, 50], help: 'Refreshes per session.', kind: 'behavior' },
  { key: 'cacheGuard.budgetUsd', section: 'advanced', label: 'Cache Guard budget', range: [0, 20], help: 'API-priced estimate per session, USD.', kind: 'behavior' },
  { key: 'cacheGuard.trustTtl', section: 'advanced', label: 'Cache Guard: trust 1h cache', options: ['on', 'off'], help: 'Arm without proof that your cache lasts an hour.', kind: 'behavior' },
]

export type SetResult = { ok: true; prefs: Prefs } | { ok: false; why: string }

/** Applies `/nexus settings <key> <value>`; never accepts a value outside the setting's own. */
export function setPref(prefs: Prefs, key: string, value: string): SetResult {
  const spec = SETTINGS.find(s => s.key === key)
  if (!spec) return { ok: false, why: `unknown setting "${key}"` }
  let v: unknown = value
  if (spec.options) {
    if (!spec.options.includes(value)) return { ok: false, why: `${key} takes ${spec.options.join(' | ')}` }
    if (spec.options[0] === 'on') v = value === 'on'
  } else if (spec.range) {
    const n = key === 'paneColumns' && value === 'max' ? PANE_MAX : Number(value)
    if (!Number.isFinite(n) || n < spec.range[0] || n > spec.range[1]) return { ok: false, why: `${key} takes ${spec.range[0]} to ${spec.range[1]}` }
    v = n
  }
  const [head, tail] = key.split('.')
  const next = JSON.parse(JSON.stringify(prefs)) as Record<string, any>
  if (head === 'telemetry' && tail && tail !== 'preset') {
    // Choosing one number by hand leaves the preset: start from what is shown now, change that one.
    next.telemetry = { ...next.telemetry, ...visibility(prefs), preset: 'custom', [tail]: v }
  } else if (head === 'telemetry' && tail === 'preset' && value === 'custom') {
    // Going to custom keeps what is shown now, so nothing jumps.
    next.telemetry = { ...next.telemetry, ...visibility(prefs), preset: 'custom' }
  } else if (tail) next[head!] = { ...next[head!], [tail]: v }
  else next[head!] = v
  return { ok: true, prefs: migrate(next) }
}

export function prefValue(prefs: Prefs, key: string): string {
  const [head, tail] = key.split('.')
  // What is shown is the preset's set, not the stale flags kept for `custom`.
  const v = head === 'telemetry' && tail && tail !== 'preset' ? visibility(prefs)[tail as keyof TelemetryFlags] : tail ? (prefs as any)[head!][tail] : (prefs as any)[head!]
  if (key === 'paneColumns' && v >= PANE_MAX) return 'max'
  return typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v)
}

/** The default of one setting, as `prefValue` would print it. */
export function defaultValue(key: string): string {
  return prefValue(DEFAULT_PREFS, key)
}

/** One section back to its defaults; the others are untouched. Never changes another section's behaviour. */
export function resetSection(prefs: Prefs, section: SectionId): Prefs {
  let next = prefs
  for (const spec of SETTINGS.filter(s => s.section === section)) {
    if (spec.key === 'telemetry.preset') {
      next = migrate({ ...next, telemetry: { ...DEFAULT_PREFS.telemetry } })
      continue
    }
    if (spec.key.startsWith('telemetry.')) continue
    const out = setPref(next, spec.key, defaultValue(spec.key))
    if (out.ok) next = out.prefs
  }
  return next
}

/** Every setting back to its default (the caller confirms first). */
export function resetAll(): Prefs {
  return migrate(JSON.parse(JSON.stringify(DEFAULT_PREFS)))
}

/** A copy for export: the preferences as stored, nothing else (no keys, paths or session data). */
export function exportPrefs(prefs: Prefs): string {
  return JSON.stringify(prefs, null, 2)
}

/** Which layout to draw, given the preference and the room the pane has. */
export function resolveLayout(prefs: Prefs, width: number, placement: 'dock' | 'inline'): 'full' | 'compact' | 'list' {
  if (placement === 'inline' || width < 40) return 'list'
  if (prefs.layout === 'compact') return 'compact'
  return width >= 84 && prefs.layout !== 'minimal' ? 'full' : 'compact'
}
