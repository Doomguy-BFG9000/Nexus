// Model modes, the advisor pairing rule and the escalation rules. Pure: no $.
//
// What this build of Claude Code (2.1.316) enforces, read from its model
// catalog: an advisor must rank at least as high as the request's model, and
// only sonnet, opus and fable can advise. A turn.step rewrite changes the
// request's model but not the advisor the engine attached for the session's
// own model, so a rewrite above the advisor is refused by the API (400) and
// retried without the advisor. The advisor itself changes only with /advisor,
// which saves the user's default for every session, so this mod never runs it:
// a different advisor takes a relaunch with a session-scoped --settings.
import type { Mode, ModeId } from '../types'

export const RANK: Record<string, number> = {
  'haiku-4-5': 1,
  'sonnet-4-6': 2,
  'opus-4-6': 3,
  'haiku-5-5': 4,
  'sonnet-5': 4,
  'opus-4-7': 5,
  'opus-4-8': 5,
  'sonnet-5-5': 6,
  'opus-5': 7,
  'opus-5-5': 7,
  'fable-5': 8,
  'mythos-5': 8,
  'fable-5-1': 9,
  'mythos-5-1': 9,
}

const ALIAS: Record<string, string> = {
  haiku: 'claude-haiku-5-5',
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
  fable: 'claude-fable-5-1',
}

const ADVISORS = ['sonnet', 'opus', 'fable']

export type Effort = NonNullable<Mode['effort']>

export type ModeSpec = {
  id: ModeId
  label: string
  main: string
  effort: Effort
  advisor: string
  level: number
  cost: string
}

export const MODES: Record<ModeId, ModeSpec> = {
  balanced: {
    id: 'balanced',
    label: 'Balanced',
    main: 'sonnet',
    effort: 'high',
    advisor: 'opus',
    level: 1,
    cost: 'the default: Sonnet 5.5 high, Opus 5.5 advisor',
  },
  deep: {
    id: 'deep',
    label: 'Deep Engineering',
    main: 'opus',
    effort: 'xhigh',
    advisor: 'fable',
    level: 2,
    cost: 'Opus 5.5 is about 2x a Sonnet turn (measured $0.20 vs $0.10 for a cold one-line turn); Fable advisor calls bill to usage credits',
  },
  max: {
    id: 'max',
    label: 'Maximum Reasoning',
    main: 'fable',
    effort: 'max',
    advisor: 'fable',
    level: 3,
    cost: 'Fable 5.1 at max effort is about 5x a Sonnet turn (measured $0.52 vs $0.10 for a cold one-line turn), every turn billed to usage credits',
  },
}

export const MODE_IDS: ModeId[] = ['balanced', 'deep', 'max']

/** `opus` -> `claude-opus-5-5`; `[1m]` and dated suffixes are kept off the rank key. */
export function modelId(model: string): string {
  const base = model.replace(/\[1m\]$/, '')
  return ALIAS[base] ?? base
}

export function rank(model: string | null | undefined): number | null {
  if (!model) return null
  const key = modelId(model).replace(/^claude-/, '').replace(/-\d{8}$/, '')
  return RANK[key] ?? null
}

export function family(model: string | null | undefined): string | null {
  return /(haiku|sonnet|opus|fable|mythos)/.exec(model ?? '')?.[1] ?? null
}

export type Pairing = { ok: true } | { ok: false; reason: string }

/** Whether `advisor` can advise a request made on `main`, by the engine's rule. */
export function pairing(main: string, advisor: string | null): Pairing {
  if (!advisor) return { ok: true }
  const fam = family(advisor)
  if (!fam || !ADVISORS.includes(fam)) return { ok: false, reason: `${advisor} cannot be an advisor` }
  const m = rank(main)
  const a = rank(advisor)
  if (m === null) return { ok: false, reason: `${main} has no advisor rank` }
  if (a === null) return { ok: false, reason: `${advisor} has no advisor rank` }
  if (m > a) return { ok: false, reason: `${family(main)} (rank ${m}) outranks the ${fam} advisor (rank ${a})` }
  return { ok: true }
}

export type Plan = {
  mode: ModeSpec
  /** Applied in this session through the turn.step rewrite; null when it can't be. */
  now: { main: string; effort: Effort } | null
  /** The advisor the session keeps until a relaunch. */
  advisor: string | null
  isComplete: boolean
  relaunch: string | null
  notes: string[]
}

/** What choosing `id` does in a session whose advisor is `sessionAdvisor`. */
export function plan(id: ModeId, sessionAdvisor: string | null, sessionId: string): Plan {
  const mode = MODES[id]
  const fits = pairing(mode.main, sessionAdvisor)
  const notes: string[] = []
  const now = fits.ok ? { main: mode.main, effort: mode.effort } : null
  const isAdvisorRight = family(sessionAdvisor) === mode.advisor
  if (!fits.ok) notes.push(`not applied in this session: ${fits.reason}`)
  else if (!isAdvisorRight) {
    notes.push(`advisor stays ${family(sessionAdvisor) ?? 'off'} in this session; ${mode.advisor} needs a relaunch`)
  }
  const isComplete = now !== null && isAdvisorRight
  return {
    mode,
    now,
    advisor: sessionAdvisor,
    isComplete,
    relaunch: isComplete ? null : relaunchCommand(sessionId, mode),
    notes,
  }
}

/** Session-scoped: --settings is held in memory for that process, never written. */
export function relaunchCommand(sessionId: string, mode: ModeSpec): string {
  const settings = JSON.stringify({ advisorModel: mode.advisor })
  return `claude --resume ${sessionId} --model ${mode.main} --effort ${mode.effort} --settings '${settings}'`
}

/** The mode a session runs as, by the families of its model and advisor. */
export function launchedMode(model: string | null, advisor: string | null): ModeId | null {
  const pair = `${family(model)}+${family(advisor)}`
  if (pair === 'sonnet+opus') return 'balanced'
  if (pair === 'opus+fable') return 'deep'
  if (pair === 'fable+fable') return 'max'
  return null
}

/** 1 balanced, 2 deep, 3 max: by the mode in force, else by the model's rank. */
export function currentLevel(m: Mode, model: string | null): number {
  if (m.selected) return MODES[m.selected].level
  const launched = launchedMode(m.sessionModel, m.sessionAdvisor)
  if (launched) return MODES[launched].level
  const r = rank(model) ?? 0
  return r >= 8 ? 3 : r >= 7 ? 2 : 1
}

// ---- escalation: deterministic rules first --------------------------------
const DEEP_WORDS = [
  'refactor', 'architecture', 'architect', 'redesign', 'migrate', 'migration', 'race condition',
  'concurrency', 'deadlock', 'debug', 'root cause', 'security', 'vulnerability', 'performance',
  'optimi[sz]e', 'distributed', 'memory leak', 'flaky', 'regression', 'across the codebase',
]
const MAX_WORDS = [
  'prove', 'formal', 'from scratch', 'entire codebase', 'whole system', 'novel algorithm',
  'ultrathink', 'hardest', 'research-grade',
]
const FILE = /\b[\w./-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|kt|swift|rb|c|cc|cpp|h|cs|sql|json|ya?ml|toml|md)\b/g

export type Assessment = {
  /** 0 trivial (never asked about), 1 balanced, 2 deep, 3 max. */
  level: number
  reasons: string[]
  /** The rules are unsure between 1 and a higher level: a classifier may settle it. */
  isAmbiguous: boolean
}

export function assess(text: string, recentErrors: number): Assessment {
  const t = text.trim()
  if (t.length < 25) return { level: 0, reasons: [], isAmbiguous: false }
  const lower = t.toLowerCase()
  const hit = (w: string) => new RegExp(`\\b${w}`).test(lower)
  const deep = DEEP_WORDS.filter(hit)
  const max = MAX_WORDS.filter(hit)
  const files = new Set(t.match(FILE) ?? [])
  const reasons: string[] = []
  if (deep.length) reasons.push(`mentions ${deep.slice(0, 3).map(w => w.replace(/\[sz\]/, 'z')).join(', ')}`)
  if (max.length) reasons.push(`asks for ${max.slice(0, 2).join(', ')}`)
  if (files.size >= 3) reasons.push(`names ${files.size} files`)
  if (t.length > 1500) reasons.push(`a ${Math.round(t.length / 100) / 10}k-character prompt`)
  if (recentErrors >= 3) reasons.push(`${recentErrors} recent tool errors`)
  const score = Math.min(deep.length, 2) + (files.size >= 3 ? 1 : 0) + (t.length > 1500 ? 1 : 0) + (recentErrors >= 3 ? 1 : 0)
  if (max.length && score >= 1) return { level: 3, reasons, isAmbiguous: false }
  if (score >= 2) return { level: 2, reasons, isAmbiguous: false }
  if (score === 1 || max.length) return { level: 1, reasons, isAmbiguous: true }
  return { level: 1, reasons, isAmbiguous: false }
}

export const CLASSIFY_LABELS = ['routine', 'complex', 'extreme'] as const
export const CLASSIFY_CAP = 20

export function modeForLevel(level: number): ModeId {
  return level >= 3 ? 'max' : level === 2 ? 'deep' : 'balanced'
}
