// Cache Guard: keeps the main conversation's prompt cache warm while the
// session sits idle. Inspired by Cachebeat (github.com/ARahim3/cachebeat,
// MIT, Abdur Rahim); written independently, no code reused. Ideas taken from
// it: an idle threshold under the TTL, an hours cap, standing down once the
// cache is already cold, and checking a beat's own usage. Swarm's own: beats
// are $.model.fork calls (no turn, no transcript entry, no hooks of this
// plugin, tools denied), plus budgets, TTL evidence and the UI states. Pure.

export type GuardStatus = 'OFF' | 'ARMED' | 'REFRESHING' | 'WARM' | 'EXPIRED' | 'PAUSED' | 'ERROR'

export type GuardTokens = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type Guard = {
  status: GuardStatus
  /** Why it is in that state, in a few words. */
  reason: string | null
  /** When it was first armed this session: the hours cap counts from here. */
  armedAt: number | null
  /** The end of the lead's last real turn: idle time counts from here. */
  activityAt: number | null
  nextAt: number | null
  beats: number
  lastBeatAt: number | null
  tokens: GuardTokens
  /** Claude Code's own cost ledger, before and after each beat. */
  usd: number
  /** What the last beat cost: the next one is expected to cost about the same. */
  lastBeatUsd: number | null
  /** The share of the last beat's input the cache served. */
  lastBeatRead: number | null
  /** The share of the first real request after a beat the cache served. */
  afterBeatRead: number | null
  isAwaitingProof: boolean
  /** What this session has shown of its cache lifetime. */
  ttl: '1h' | '5m' | 'unverified'
  ttlSource: string | null
  errors: string[]
}

export const NEW_GUARD: Guard = {
  status: 'OFF',
  reason: 'off by default',
  armedAt: null,
  activityAt: null,
  nextAt: null,
  beats: 0,
  lastBeatAt: null,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  usd: 0,
  lastBeatUsd: null,
  lastBeatRead: null,
  afterBeatRead: null,
  isAwaitingProof: false,
  ttl: 'unverified',
  ttlSource: null,
  errors: [],
}

/** The one-hour cache Anthropic offers; idle past (TTL - margin) means it is likely cold already. */
export const TTL_MS = 60 * 60_000
export const COLD_MARGIN_MS = 60_000
/**
 * A beat is warm when the cache served at least as much as it had to write.
 * Measured live (Haiku 5.5, 2026-11-02): a session's first fork reads the main
 * thread's cached prefix and writes the rest of its own once (30k read, 22k
 * written); later forks read it all (52k read, 0 written), still at 7 minutes
 * idle. A cold cache writes more than it reads (Cachebeat's own test).
 */
export const WARM_SHARE = 0.5
/** The prompt a beat sends; the fork already denies every tool. */
export const BEAT_PROMPT = 'Reply with exactly "." and nothing else.'

export type GuardConfig = { enabled: boolean; idleMin: number; maxHours: number; maxBeats: number; budgetUsd: number; trustTtl: boolean }

export type Facts = { now: number; isBusy: boolean }

export type Decision =
  | { act: 'beat' }
  | { act: 'wait'; until: number; status: GuardStatus; reason: string }
  | { act: 'stop'; status: GuardStatus; reason: string }

/** What to do now. Never a beat while the lead works, agents run or a dialog waits. */
export function decide(g: Guard, c: GuardConfig, f: Facts): Decision {
  if (!c.enabled) return { act: 'stop', status: 'OFF', reason: 'off' }
  if (g.ttl === '5m') return { act: 'stop', status: 'PAUSED', reason: 'this session caches for 5 minutes: a beat cannot help' }
  if (g.ttl === 'unverified' && !c.trustTtl) return { act: 'stop', status: 'PAUSED', reason: '1-hour cache not confirmed yet' }
  if (g.activityAt === null) return { act: 'stop', status: 'ARMED', reason: 'waiting for a first turn' }
  if (g.armedAt !== null && f.now - g.armedAt >= c.maxHours * 3_600_000) return { act: 'stop', status: 'PAUSED', reason: `${c.maxHours}h cap reached` }
  if (g.beats >= c.maxBeats) return { act: 'stop', status: 'PAUSED', reason: `${c.maxBeats} beats used` }
  // Stop before a beat that, costing what the last one did, would pass the budget.
  if (g.usd + (g.lastBeatUsd ?? 0) > c.budgetUsd) return { act: 'stop', status: 'PAUSED', reason: `$${c.budgetUsd.toFixed(2)} budget reached` }
  if (f.isBusy) return { act: 'wait', until: f.now + 60_000, status: 'ARMED', reason: 'session busy' }
  const since = Math.max(g.activityAt, g.lastBeatAt ?? 0)
  // Past the TTL the cache is most likely gone: a beat would only pay to rebuild it.
  if (f.now - since >= TTL_MS - COLD_MARGIN_MS) return { act: 'stop', status: 'EXPIRED', reason: 'idle past the cache lifetime' }
  const due = since + c.idleMin * 60_000
  if (f.now >= due) return { act: 'beat' }
  return { act: 'wait', until: due, status: g.status === 'WARM' ? 'WARM' : 'ARMED', reason: 'idle timer' }
}

export function readShare(t: GuardTokens | { input_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }): number | null {
  const [input, read, write] = 'input' in t ? [t.input, t.cacheRead, t.cacheWrite] : [t.input_tokens, t.cache_read_input_tokens, t.cache_creation_input_tokens]
  const total = input + read + write
  return total > 0 ? read / total : null
}

/** What a usage block's cache-write split says about the TTL in use, if anything. */
export function ttlEvidence(usage: unknown): '1h' | '5m' | null {
  const split = (usage as { cache_creation?: { ephemeral_1h_input_tokens?: unknown; ephemeral_5m_input_tokens?: unknown } } | null)?.cache_creation
  if (!split) return null
  const h1 = typeof split.ephemeral_1h_input_tokens === 'number' ? split.ephemeral_1h_input_tokens : 0
  const m5 = typeof split.ephemeral_5m_input_tokens === 'number' ? split.ephemeral_5m_input_tokens : 0
  if (h1 > 0) return '1h'
  if (m5 > 0) return '5m'
  return null
}
