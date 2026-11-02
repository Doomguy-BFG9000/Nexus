// Dashboard preferences, kept in the plugin's own store ($.store 'prefs'),
// never in Claude Code's settings. Pure: defaults, validation, migration.
import type { Prefs } from '../types'

export type { Prefs }



/** Asking for this many columns opens the pane as wide as Claude Code allows (45% of the terminal). */
export const PANE_MAX = 999

export const DEFAULT_PREFS: Prefs = {
  version: 2,
  layout: 'auto',
  animation: 'auto',
  agentDetail: 'full',
  orbitStyle: 'wide',
  telemetry: { context: true, cost: true, usage: true, tokens: false },
  logRows: 4,
  paneColumns: PANE_MAX,
  jev: 'bars',
  escalation: 'ask',
  cacheGuard: { enabled: false, idleMin: 50, maxHours: 8, maxBeats: 10, budgetUsd: 0.5, trustTtl: false },
}

const pick = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : fallback
const num = (value: unknown, lo: number, hi: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : fallback
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)

/** Any stored value, of any earlier version or none, read as valid current preferences. */
export function migrate(raw: unknown): Prefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const d = DEFAULT_PREFS
  const t = (r.telemetry ?? {}) as Record<string, unknown>
  const c = (r.cacheGuard ?? {}) as Record<string, unknown>
  return {
    version: 2,
    layout: pick(r.layout, ['auto', 'full', 'compact', 'minimal'], d.layout),
    animation: pick(r.animation, ['auto', 'full', 'reduced', 'off'], d.animation),
    agentDetail: pick(r.agentDetail, ['brief', 'full'], d.agentDetail),
    // Named advisorOrbit before 0.5: carried over.
    orbitStyle: pick(r.orbitStyle ?? r.advisorOrbit, ['tight', 'wide'], d.orbitStyle),
    telemetry: {
      context: bool(t.context, d.telemetry.context),
      cost: bool(t.cost, d.telemetry.cost),
      usage: bool(t.usage, d.telemetry.usage),
      tokens: bool(t.tokens, d.telemetry.tokens),
    },
    logRows: Math.round(num(r.logRows, 0, 6, d.logRows)),
    // v2: the pane opens as wide as Claude Code allows unless a width was chosen since.
    paneColumns: r.version === 2 ? Math.round(num(r.paneColumns, 40, PANE_MAX, d.paneColumns)) : PANE_MAX,
    jev: pick(r.jev, ['bars', 'line', 'hidden'], d.jev),
    escalation: pick(r.escalation, ['ask', 'off'], d.escalation),
    cacheGuard: {
      enabled: bool(c.enabled, d.cacheGuard.enabled),
      idleMin: Math.round(num(c.idleMin, 5, 55, d.cacheGuard.idleMin)),
      maxHours: num(c.maxHours, 1, 24, d.cacheGuard.maxHours),
      maxBeats: Math.round(num(c.maxBeats, 1, 50, d.cacheGuard.maxBeats)),
      budgetUsd: num(c.budgetUsd, 0, 20, d.cacheGuard.budgetUsd),
      trustTtl: bool(c.trustTtl, d.cacheGuard.trustTtl),
    },
  }
}

/** One setting by its dotted name: what `/nexus settings <key> <value>` accepts. */
export const SETTINGS: { key: string; options?: string[]; range?: [number, number]; help: string }[] = [
  { key: 'layout', options: ['auto', 'full', 'compact', 'minimal'], help: 'dashboard layout' },
  { key: 'animation', options: ['auto', 'full', 'reduced', 'off'], help: 'motion (auto follows reduceMotion)' },
  { key: 'agentDetail', options: ['brief', 'full'], help: 'how much the agent view shows' },
  { key: 'orbitStyle', options: ['tight', 'wide'], help: 'orbit animation style' },
  { key: 'telemetry.context', options: ['on', 'off'], help: 'context used / window' },
  { key: 'telemetry.cost', options: ['on', 'off'], help: 'session API est.' },
  { key: 'telemetry.usage', options: ['on', 'off'], help: 'plan usage bars' },
  { key: 'telemetry.tokens', options: ['on', 'off'], help: 'per-model tokens in the strip' },
  { key: 'logRows', range: [0, 6], help: 'session log rows' },
  { key: 'paneColumns', range: [40, PANE_MAX], help: `pane width; ${PANE_MAX} = as wide as allowed (/nexus width max)` },
  { key: 'jev', options: ['bars', 'line', 'hidden'], help: 'Jev panel' },
  { key: 'escalation', options: ['ask', 'off'], help: 'stronger-mode suggestions' },
  { key: 'cacheGuard.enabled', options: ['on', 'off'], help: 'Cache Guard' },
  { key: 'cacheGuard.idleMin', range: [5, 55], help: 'idle minutes before a beat' },
  { key: 'cacheGuard.maxHours', range: [1, 24], help: 'hours before it stops' },
  { key: 'cacheGuard.maxBeats', range: [1, 50], help: 'beats per session' },
  { key: 'cacheGuard.budgetUsd', range: [0, 20], help: 'API est. budget per session' },
  { key: 'cacheGuard.trustTtl', options: ['on', 'off'], help: 'arm without 1h TTL evidence' },
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
  if (tail) next[head!] = { ...next[head!], [tail]: v }
  else next[head!] = v
  return { ok: true, prefs: migrate(next) }
}

export function prefValue(prefs: Prefs, key: string): string {
  const [head, tail] = key.split('.')
  const v = tail ? (prefs as any)[head!][tail] : (prefs as any)[head!]
  if (key === 'paneColumns' && v >= PANE_MAX) return 'max'
  return typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v)
}

/** Which layout to draw, given the preference and the room the pane has. */
export function resolveLayout(prefs: Prefs, width: number, placement: 'dock' | 'inline'): 'full' | 'compact' | 'list' {
  if (placement === 'inline' || width < 40) return 'list'
  if (prefs.layout === 'compact') return 'compact'
  return width >= 84 && prefs.layout !== 'minimal' ? 'full' : 'compact'
}
