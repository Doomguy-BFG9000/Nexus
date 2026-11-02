// Agent inspection as text: /swarm agents and /swarm inspect. Pure.
import type { SwarmAgent, Tokens } from '../types'
import { clock, compact, elapsed, modelLabel, pad } from './format'

const MARK: Record<SwarmAgent['status'], string> = { running: '●', done: '✓', failed: '✗', cancelled: '◌' }

export function stateLabel(a: SwarmAgent, now: number): string {
  const took = elapsed((a.endedAt ?? now) - a.startedAt)
  return `${MARK[a.status]} ${a.status} ${took}`
}

export function turnsLabel(a: SwarmAgent): string {
  return a.maxTurns ? `${a.steps}/${a.maxTurns} turns` : `${a.steps} turns`
}

export function tokensLabel(t: Tokens): string {
  return `in ${compact(t.input)} · out ${compact(t.output)} · cache read ${compact(t.cacheRead)} · cache write ${compact(t.cacheWrite)}`
}

export function agentList(list: SwarmAgent[]): string {
  if (list.length === 0) return 'No agents this session yet.'
  const rows = list.map(
    (a, i) =>
      `${pad(String(i + 1), 3)}${pad(a.label, Math.max(12, ...list.map(x => x.label.length + 2)))}${pad(modelLabel(a.model), 11)}${pad(`${MARK[a.status]} ${a.status}`, 12)}${a.isSwarm ? '' : '[fallback] '}${a.description}`,
  )
  return [...rows, '', '/swarm inspect <number|label> for one agent.'].join('\n')
}

export function agentDetail(a: SwarmAgent, now: number): string {
  const lines = [
    `${a.label} · ${modelLabel(a.model)} · ${stateLabel(a, now)}${a.isSwarm ? '' : ' · fallback agent (not a configured swarm agent)'}`,
    `type      ${a.type}${a.isWorktree ? ' (runs in a worktree)' : ''}`,
    `task      ${a.description || 'N/A'}`,
    `prompt    ${a.prompt || 'N/A'}`,
    `turns     ${turnsLabel(a)} · tools ${a.tools}${a.lastTool ? ` · last ${a.lastTool}` : ''}`,
    `tokens    ${tokensLabel(a.tokens)} (summed from its own requests)`,
    `reported  ${a.reportedTokens === null ? 'N/A' : `${compact(a.reportedTokens)} total tokens (Agent tool result)`}`,
    'cost      API est. N/A per agent (Claude Code prices the session as a whole: /swarm usage)',
    `files     ${a.files.length ? a.files.slice(-8).join(', ') : 'none'}`,
    'recent',
    ...(a.recent.length ? a.recent.map(r => `  ${clock(r.at)}  ${r.text}`) : ['  none']),
  ]
  if (a.reason) lines.push(`ended     ${a.reason}`)
  lines.push('result', ...(a.summary ? a.summary.split('\n').slice(0, 8).map(l => `  ${l}`) : ['  N/A']))
  return lines.join('\n')
}
