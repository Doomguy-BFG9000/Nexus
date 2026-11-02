// Cost, context and plan-usage figures, as Claude Code reports them. Pure.
//
// Sources (Claude Code 2.1.316 mod API):
//   context          $.session.usage().context: the native status line's figures
//   session cost     $.session.usage().cost.usd: what /cost totals, priced at API
//                    rates. For a subscription that is an estimate, not a charge.
//   plan usage       $.session.usage().rateLimits: the windows the last API
//                    response reported (five_hour, seven_day, ...)
//   tokens by model  turn.step usage, one entry per request (turnId + index)
import type { Tokens } from '../types'

/** How full a window may get before its bar turns amber, then red. */
export const WARN_AT = 70
export const ALERT_AT = 90
/** Plan figures older than this are drawn as stale: they come only with responses. */
export const STALE_MS = 15 * 60_000

export type Limit = { kind: string; percentUsed: number; resetsAt: string | null }

const KNOWN: Record<string, string> = {
  five_hour: '5h',
  seven_day: '7d',
  seven_day_opus: '7d opus',
  seven_day_sonnet: '7d sonnet',
  seven_day_oauth_apps: '7d apps',
  seven_day_cowork: '7d cowork',
  spend_limit: 'spend',
}

/** A short row label; a window Claude Code names after Fable reads `7d fable`, nothing else does. */
export function limitLabel(kind: string): string {
  if (KNOWN[kind]) return KNOWN[kind]!
  if (/fable/i.test(kind)) return kind.startsWith('seven_day') ? '7d fable' : `fable ${kind.replace(/_?fable_?/i, ' ').trim()}`
  return kind.replace(/^seven_day_/, '7d ').replace(/^five_hour_/, '5h ').replace(/_/g, ' ')
}

/** Windows in a stable order: 5h, 7d, then the rest by name. */
export function orderLimits(limits: Limit[]): Limit[] {
  const rank = (k: string) => (k === 'five_hour' ? 0 : k === 'seven_day' ? 1 : /fable/i.test(k) ? 2 : 3)
  return [...limits].sort((a, b) => rank(a.kind) - rank(b.kind) || a.kind.localeCompare(b.kind))
}

export function tone(percent: number | null): 'normal' | 'warn' | 'alert' | 'none' {
  if (percent === null || !Number.isFinite(percent)) return 'none'
  if (percent >= ALERT_AT) return 'alert'
  if (percent >= WARN_AT) return 'warn'
  return 'normal'
}

/** The reset time in the local zone: `14:40` today, else `Thu 05:00`. */
export function resetLabel(iso: string | null, now: number): string {
  if (!iso) return 'reset N/A'
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return 'reset N/A'
  if (at.getTime() <= now) return 'reset passed'
  const hm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  const sameDay = new Date(now).toDateString() === at.toDateString()
  return `resets ${sameDay ? hm : `${at.toLocaleDateString('en-US', { weekday: 'short' })} ${hm}`}`
}

export type Freshness = { isStale: boolean; label: string }

/** How old the plan figures are: they arrive only with an API response. */
export function freshness(readAt: number | null, now: number): Freshness {
  if (readAt === null) return { isStale: true, label: 'no response yet' }
  const age = now - readAt
  const mins = Math.floor(age / 60_000)
  return { isStale: age > STALE_MS, label: mins < 1 ? 'just now' : `${mins}m ago` }
}

export type ModelRow = Tokens & { requests: number; leadRequests: number; agentRequests: number }

export function addUsage(
  rows: Record<string, ModelRow>,
  model: string,
  u: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number },
  isAgent: boolean,
): Record<string, ModelRow> {
  const r = rows[model] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0, leadRequests: 0, agentRequests: 0 }
  return {
    ...rows,
    [model]: {
      input: r.input + u.input_tokens,
      output: r.output + u.output_tokens,
      cacheRead: r.cacheRead + u.cache_read_input_tokens,
      cacheWrite: r.cacheWrite + u.cache_creation_input_tokens,
      requests: r.requests + 1,
      leadRequests: r.leadRequests + (isAgent ? 0 : 1),
      agentRequests: r.agentRequests + (isAgent ? 1 : 0),
    },
  }
}

/** The key one request is counted under; a repeated report of it is ignored. */
export function stepKey(agentId: string | undefined, turnId: string, index: number): string {
  return `${agentId ?? 'main'}:${turnId}:${index}`
}

export function usd(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'N/A'
  return value < 0.01 && value > 0 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`
}
