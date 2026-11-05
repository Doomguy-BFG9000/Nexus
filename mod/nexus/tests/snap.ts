// A dashboard snapshot to draw from. Figures are fixtures for layout tests, not telemetry.
import { NEW_COUNCIL } from '../hooks/council'
import { DEFAULT_PREFS, setPref } from '../hooks/prefs'
import type { Prefs } from '../hooks/prefs'
import type { Snapshot } from '../hooks/views'

export const NOW = new Date('2026-11-04T18:41:33').getTime()

export function agent(id: string, type: string, n: number, desc: string, status: 'running' | 'done' | 'failed' | 'cancelled', steps: number, max: number | null, dur: number): Snapshot['agents'][number] {
  return {
    id, type, label: `${type.replace('nexus-', '')}#${n}`, isNexus: true, description: desc, prompt: desc, model: 'claude-haiku-5-5', status, steps, maxTurns: max, tools: steps, lastTool: 'Grep',
    isWorktree: false, startedAt: NOW - dur, endedAt: status === 'running' ? null : NOW, files: [], recent: [], summary: null, reason: status === 'failed' ? 'timed out' : null,
    tokens: { input: 12000 + steps * 900, output: 800 + steps * 40, cacheRead: 0, cacheWrite: 0 }, reportedTokens: null, toolUseId: null,
  }
}

export function snap(over: Partial<Snapshot> = {}, prefs: Prefs = DEFAULT_PREFS): Snapshot {
  const council = JSON.parse(JSON.stringify(NEW_COUNCIL)) as Snapshot['council']
  for (const r of ['security', 'architecture', 'performance'] as const) Object.assign(council.reviewers[r], { status: 'done', startedAt: NOW - 90_000, endedAt: NOW - 20_000, findings: r === 'security' ? 2 : 0 })
  council.reviews = 3
  return {
    lead: { model: 'claude-sonnet-5-5', requested: null, effort: 'high', steps: 48, outputTokens: 0, turnOutputTokens: 0, contextTokens: 425_000, turnStartedAt: NOW - 72_000, isWaiting: false },
    advisor: { calls: 3, lastAt: NOW - 140_000, lastMs: 9000, contextAtCall: 300_000, history: [] },
    agents: [
      agent('a1', 'nexus-audit', 2, 'Independent review of the diff', 'done', 10, 30, 607_000),
      agent('a2', 'nexus-grep', 1, 'Trace calculations through the call graph', 'done', 19, 25, 228_000),
      agent('a3', 'nexus-audit', 1, 'Audit current status and run type-check', 'running', 28, 30, 274_000),
      agent('a4', 'nexus-test', 1, 'Run the unit tests for the pricing module', 'running', 6, 20, 41_000),
    ],
    jev: {
      status: 'on', reason: null, decisions: 169, toolChecked: 140, toolAgreed: 116, calls: 169, spentUsd: 0.01, routing: 'observe', calibration: null, hints: 0, hintsChecked: 0, hintsFollowed: 0, retries: 0, recovered: 0, fallbacks: 0, lastRoute: 'which file · split',
      last: [
        { at: NOW, question: 'which file', choice: 'a', p: 0.79, confidence: 0.76, isSharp: false },
        { at: NOW, question: 'which tool', choice: 'b', p: 0.88, confidence: 0.8, isSharp: true },
        { at: NOW, question: 'retry or stop', choice: 'c', p: 0.67, confidence: 0.6, isSharp: false },
      ],
    },
    log: [
      { at: NOW - 10_000, who: 'jev', kind: 'jev', text: 'route → which file (p=0.79) · split', detail: '' },
      { at: NOW - 5_000, who: 'audit', kind: 'start', text: 'audit#1 advanced · 28/30 turns', detail: '' },
      { at: NOW - 2_000, who: 'lead', kind: 'info', text: 'tests running · 3/4 (effort high)', detail: '' },
      { at: NOW, who: 'council', kind: 'done', text: 'performance review · done', detail: '' },
    ],
    mode: { selected: null, main: null, effort: 'high', sessionAdvisor: 'opus', sessionModel: 'claude-sonnet-5-5', relaunch: null, declinedLevel: 0, classified: 0, recentErrors: 0 },
    fx: [], reduceMotion: false, tick: 0, view: { kind: 'diagram', ref: null }, prefs,
    usage: { readAt: NOW - 30_000, tokens: 425_000, window: 1_000_000, percent: 42.5, costUsd: 12.99, limits: [{ kind: 'five_hour', percentUsed: 4, resetsAt: new Date('2026-11-04T18:50').toISOString() }, { kind: 'seven_day', percentUsed: 26, resetsAt: new Date('2026-11-04T23:00').toISOString() }], plan: null, compactions: 0 },
    models: { 'claude-sonnet-5-5': { input: 380_000, output: 21_000, cacheRead: 900_000, cacheWrite: 40_000, requests: 48, leadRequests: 48, agentRequests: 0 } },
    guard: { status: 'OFF' } as Snapshot['guard'], council, now: NOW, ...over,
  }
}

export function withPrefs(...changes: [string, string][]): Prefs {
  let p = DEFAULT_PREFS
  for (const [k, v] of changes) {
    const r = setPref(p, k, v)
    if (!r.ok) throw new Error(r.why)
    p = r.prefs
  }
  return p
}

/** Nothing reported: every figure the engine has not seen is null. */
export function unreported(prefs: Prefs = DEFAULT_PREFS): Snapshot {
  return snap(
    {
      agents: [], log: [], jev: { ...snap().jev, last: [], decisions: 0, toolChecked: 0, toolAgreed: 0, lastRoute: null },
      usage: { readAt: null, tokens: null, window: null, percent: null, costUsd: null, limits: [], plan: null, compactions: 0 },
      models: {}, advisor: { calls: 0, lastAt: null, lastMs: null, contextAtCall: null, history: [] },
      lead: { ...snap().lead, turnStartedAt: null, effort: null, model: null, contextTokens: null },
      council: JSON.parse(JSON.stringify(NEW_COUNCIL)),
    },
    prefs,
  )
}
