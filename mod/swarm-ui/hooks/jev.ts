// Observation-only client for TypeSafe's Jev "System One" API, ported from
// the standalone adapter (src/swarm/jev in the stash). It never changes what
// Claude Code runs: answers are only drawn. Bounded by a per-minute rate, a
// per-session USD budget, a timeout and a back-off after any error. Only tool
// names and file basenames leave the machine, never prompts or contents.
import type { EngineInterface } from 'claude-code'

import type { JevDecision } from '../types'

export const JEV = {
  endpoint: 'https://api.typesafe.ai/v1/systemone',
  model: 'jev-latest',
  threshold: 0.85,
  timeoutMs: 2000,
  budgetUsd: 0.5,
  usdPerMtokIn: 0.042,
  maxPerMin: 30,
  backoffMs: 30_000,
}

const TOOLS: Record<string, string> = {
  Read: 'read a file to understand it',
  Edit: 'modify an existing file',
  Write: 'create or overwrite a file',
  Grep: 'search file contents for a pattern',
  Glob: 'find files by name pattern',
  Bash: 'run a shell command such as tests or a build',
  Agent: 'delegate to a subagent',
}
const RETRY: Record<string, string> = {
  retry: 'the failure looks transient; try the same action again',
  change: 'the same action will fail again; change approach',
  stop: 'stop and ask the user or advisor',
}

type Question = { type: 'choice'; instructions: string; criteria: Record<string, string> }

export type JevAsk = { history: string[]; questions: Record<string, Question> }

export type JevOutcome =
  | { ok: true; decisions: JevDecision[] }
  | { ok: false; reason: string }

export function toolQuestion(): Question {
  return {
    type: 'choice',
    instructions: "Given the coding agent's recent actions, which tool should it use next?",
    criteria: TOOLS,
  }
}

export function fileQuestion(files: string[]): Question | null {
  if (files.length < 2) return null
  return {
    type: 'choice',
    instructions: 'Which file is the coding agent most likely to need to work on next?',
    criteria: Object.fromEntries(files.map(f => [f, `file ${f}`])),
  }
}

export function retryQuestion(): Question {
  return {
    type: 'choice',
    instructions: 'A tool call just failed. What should the coding agent do?',
    criteria: RETRY,
  }
}

/** Rate, budget and back-off; lives in the module, so a reload starts it fresh. */
export class Gate {
  private calls: number[] = []
  private spent = 0
  private downUntil = 0

  allow(now: number): string | null {
    this.calls = this.calls.filter(t => now - t < 60_000)
    if (now < this.downUntil) return 'backing off'
    if (this.spent >= JEV.budgetUsd) return 'budget spent'
    if (this.calls.length >= JEV.maxPerMin) return 'rate limit'
    return null
  }

  record(now: number, inputTokens: number) {
    this.calls.push(now)
    this.spent += (inputTokens * JEV.usdPerMtokIn) / 1_000_000
  }

  fail(now: number) {
    this.downUntil = now + JEV.backoffMs
  }
}

export async function askJev($: EngineInterface, key: string, ask: JevAsk, now: number): Promise<
  JevOutcome & { inputTokens?: number }
> {
  const body = JSON.stringify({
    state: JSON.stringify({ recent_actions: ask.history.slice(-12) }),
    model: JEV.model,
    questions: ask.questions,
  })
  let res
  try {
    res = await Promise.race([
      $.http.fetch(JEV.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body,
      }),
      $.clock.sleep(JEV.timeoutMs).then(() => null),
    ])
  } catch {
    return { ok: false, reason: 'network' }
  }
  if (res === null) return { ok: false, reason: 'timeout' }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'auth' }
  if (res.status === 429) return { ok: false, reason: 'rate-limited' }
  if (!res.ok) return { ok: false, reason: `http ${res.status}` }

  let data: unknown
  try {
    data = JSON.parse(res.text)
  } catch {
    return { ok: false, reason: 'bad json' }
  }
  return { ok: true, ...parse(data, now) }
}

function parse(data: unknown, now: number): { decisions: JevDecision[]; inputTokens: number } {
  const out: JevDecision[] = []
  const d = (data ?? {}) as { answers?: Record<string, unknown>; usage?: { input_tokens?: number } }
  for (const [question, raw] of Object.entries(d.answers ?? {})) {
    const a = (raw ?? {}) as { choice?: unknown; probabilities?: Record<string, unknown> }
    if (typeof a.choice !== 'string') continue
    const p = a.probabilities?.[a.choice]
    // Never invent a probability the API did not return.
    if (typeof p !== 'number') continue
    out.push({ at: now, question, choice: a.choice, p, isSharp: p >= JEV.threshold })
  }
  return { decisions: out, inputTokens: Number(d.usage?.input_tokens ?? 0) }
}
