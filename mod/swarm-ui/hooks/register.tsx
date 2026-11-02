import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, Timer } from 'claude-code'

import type { Advisor, Fx, Jev, JevDecision, Lead, LogRow, Mode, ModeId, SwarmAgent, Usage, View } from '../types'
import { C, compact, elapsed, modelLabel, role } from './format'
import { Gate, askJev, fileQuestion, retryQuestion, toolQuestion } from './jev'
import type { JevAsk } from './jev'
import { CALIBRATION, ROUTABLE, ROUTE, accept, candidates, errorKind, hintText, judge, score } from './routing'
import { DUAL } from './orbit'
import { BEAT_PROMPT, NEW_GUARD, WARM_SHARE, decide, readShare, ttlEvidence } from './cacheguard'
import type { Guard } from './cacheguard'
import type { CaseResult } from './routing'
import {
  CLASSIFY_CAP,
  CLASSIFY_LABELS,
  MODES,
  MODE_IDS,
  assess,
  currentLevel,
  family,
  launchedMode,
  modeForLevel,
  pairing,
  plan,
} from './modes'
import { agentDetail, agentList } from './inspect'
import { DEFAULT_PREFS, SETTINGS, migrate, prefValue, resolveLayout, setPref } from './prefs'
import type { Prefs } from './prefs'
import { addUsage, freshness, limitLabel, orderLimits, resetLabel, stepKey, usd } from './telemetry'
import type { ModelRow } from './telemetry'
import { Band, PaneCompact, PaneFull, PaneList, SpinnerLine, isAnimating } from './views'
import type { Actions, Snapshot } from './views'

// Bump a shape tag whenever that value's fields change: values stored by an
// earlier version outlive a reload and are declined, not misread.
export const lead = atom(
  { plugin: 'swarm-ui', key: 'lead' } as const,
  {
    model: null,
    requested: null,
    effort: null,
    steps: 0,
    outputTokens: 0,
    turnOutputTokens: 0,
    contextTokens: null,
    turnStartedAt: null,
    isWaiting: false,
  } as Lead,
  { shape: 'lead-2' },
)

export const advisor = atom(
  { plugin: 'swarm-ui', key: 'advisor' } as const,
  { calls: 0, lastAt: null, lastMs: null, contextAtCall: null, history: [] } as Advisor,
  { shape: 'advisor-2' },
)

export const agents = atom(
  { plugin: 'swarm-ui', key: 'agents' } as const,
  [] as SwarmAgent[],
  { shape: 'agents-2' },
)

/** What the pane shows: the diagram, or one agent, settings, usage or Cache Guard in detail. */
/** Dashboard preferences: loaded from $.store at start, written back on each change. */
export const prefs = atom({ plugin: 'swarm-ui', key: 'prefs' } as const, DEFAULT_PREFS as Prefs, { shape: 'prefs-1' })

export const usage = atom(
  { plugin: 'swarm-ui', key: 'usage' } as const,
  { readAt: null, tokens: null, window: null, percent: null, costUsd: null, limits: [], plan: null, compactions: 0 } as Usage,
  { shape: 'usage-1' },
)

/** Tokens by the model that answered, each request counted once. */
export const models = atom({ plugin: 'swarm-ui', key: 'models' } as const, {} as Record<string, ModelRow>, { shape: 'models-1' })

/** Cache Guard: this session's state; its settings live in prefs. */
export const guard = atom({ plugin: 'swarm-ui', key: 'guard' } as const, NEW_GUARD as Guard, { shape: 'guard-1' })

export const view = atom({ plugin: 'swarm-ui', key: 'view' } as const, { kind: 'diagram', ref: null } as View, { shape: 'view-1' })

export const jev = atom(
  { plugin: 'swarm-ui', key: 'jev' } as const,
  {
    status: 'off',
    reason: 'no key',
    decisions: 0,
    last: [],
    toolChecked: 0,
    toolAgreed: 0,
    calls: 0,
    spentUsd: 0,
    routing: 'observe',
    calibration: null,
    hints: 0,
    hintsChecked: 0,
    hintsFollowed: 0,
    retries: 0,
    recovered: 0,
    fallbacks: 0,
    lastRoute: null,
  } as Jev,
  { shape: 'jev-3' },
)

export const log = atom(
  { plugin: 'swarm-ui', key: 'log' } as const,
  [] as LogRow[],
  { shape: 'log-2' },
)

export const mode = atom(
  { plugin: 'swarm-ui', key: 'mode' } as const,
  {
    selected: null,
    main: null,
    effort: null,
    sessionAdvisor: null,
    sessionModel: null,
    relaunch: null,
    declinedLevel: 0,
    classified: 0,
    recentErrors: 0,
  } as Mode,
  { shape: 'mode-1' },
)

export const fx = atom({ plugin: 'swarm-ui', key: 'fx' } as const, [] as Fx[], { shape: 'fx-1' })

export const reduceMotion = atom({ plugin: 'swarm-ui', key: 'reduceMotion' } as const, false)

export const tick = atom({ plugin: 'swarm-ui', key: 'tick' } as const, 0)

export const LOG_KEEP = 50

const PANE = 'swarm'
const PANE_OPEN = { id: PANE, title: 'swarm', columns: 92, backgroundColor: C.bg }
/** 10 frames a second while an effect plays; 1 under reduced motion (counters only). */
const FRAME_MS = 100
const STILL_MS = 1000
const KEYCHAIN_SERVICE = 'claude-swarm-typesafe'
const MS = { advisor: 4800, spawn: 1600, done: 1600, jev: 900, mode: 1600, route: 900, beat: 2000 }

// Module variables start over on a reload; everything drawn lives in $.state.
let opts: PluginOptions = {}
let timer: Timer | null = null
let timerMs = 0
let isReduced = false
/** animation: off — no timer at all; counters move only on events. */
let isMotionOff = false
let cwd = ''
let home = ''
let sessionId = ''
let jevKey: string | undefined
let hasWarnedPairing = false
/** Mirrors jev.routing ($.state) so the tool path can read it without a hop. */
let routing: Jev['routing'] = 'observe'
/** The file the last hint named, until the lead's next read. */
let pendingHint: string | null = null
const gate = new Gate()
/** Requests already counted (turn.step results), so a repeat is never added twice. */
const counted = new Set<string>()
/** A pane width the person set by hand (Claude Code keeps it; it beats any request). */
let keptWidth: number | null = null
/** Cache Guard's one timer: re-arming always cancels the last, so there is never a second. */
let guardTimer: Timer | null = null
let isBeating = false
const history: string[] = []
const files: string[] = []

async function addLog($: EngineInterface, row: Omit<LogRow, 'at'>) {
  const at = await $.clock.now()
  await update($, log, rows => [...rows, { ...row, at }].slice(-LOG_KEEP))
  animate($)
}

/** Starts an effect that a real event caused; it ends by itself after its time. */
async function addFx($: EngineInterface, kind: Fx['kind'], ref: string | null, ms: number = MS[kind]) {
  const at = await $.clock.now()
  await update($, fx, list => [...list.filter(f => at - f.at < f.ms), { kind, at, ms, ref }].slice(-24))
  animate($)
}

// One timer, only while something on screen changes with time; none when idle.
function animate($: EngineInterface) {
  if (isMotionOff) {
    timer?.cancel()
    timer = null
    return
  }
  const ms = isReduced ? STILL_MS : FRAME_MS
  if (timer && timerMs === ms) return
  timer?.cancel()
  timerMs = ms
  timer = $.clock.every(ms, () => {
    void frame($)
  })
}

async function frame($: EngineInterface) {
  const s = await snapshot($)
  await update($, tick, n => n + 1)
  if (!isAnimating(s)) {
    timer?.cancel()
    timer = null
  }
}

async function snapshot($: EngineInterface): Promise<Snapshot> {
  const [l, a, list, j, rows, m, f, r, t, v, pr, us, md, gd, now] = await Promise.all([
    read($, lead),
    read($, advisor),
    read($, agents),
    read($, jev),
    read($, log),
    read($, mode),
    read($, fx),
    read($, reduceMotion),
    read($, tick),
    read($, view),
    read($, prefs),
    read($, usage),
    read($, models),
    read($, guard),
    $.clock.now(),
  ])
  return { lead: l, advisor: a, agents: list, jev: j, log: rows, mode: m, fx: f, reduceMotion: r, tick: t, view: v, prefs: pr, usage: us, models: md, guard: gd, keptWidth, now }
}

/** Re-reads Claude Code's own usage figures: free (no breakdown asked), no request is made. */
async function refreshUsage($: EngineInterface) {
  try {
    const u = await $.session.usage()
    const at = await $.clock.now()
    await update($, usage, x => ({
      ...x,
      readAt: u.rateLimits.length || u.context.tokens !== undefined ? at : x.readAt,
      tokens: u.context.tokens ?? x.tokens,
      window: u.context.window || x.window,
      percent: u.context.percent ?? x.percent,
      costUsd: u.cost?.usd ?? x.costUsd,
      limits: u.rateLimits.length ? u.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt ?? null })) : x.limits,
    }))
  } catch {
    // figures stay as they were; freshness shows their age
  }
}

/** Counts one request's tokens under the model that answered, once. */
async function countStep($: EngineInterface, key: string, model: string | undefined, u: Parameters<typeof addUsage>[2] | null, isAgent: boolean) {
  if (!u || !model || counted.has(key)) return
  counted.add(key)
  if (counted.size > 5000) counted.clear()
  await update($, models, rows => addUsage(rows, model, u, isAgent))
}

/** /swarm usage: every figure with its source and age. */
async function usageText($: EngineInterface): Promise<string> {
  await refreshUsage($)
  const [u, md, j, now] = await Promise.all([read($, usage), read($, models), read($, jev), $.clock.now()])
  const fresh = freshness(u.readAt, now)
  const fable = u.limits.find(l => /fable/i.test(l.kind))
  const lines = [
    `Usage${u.plan ? ` · ${u.plan}` : ''} (plan figures as of ${fresh.label}${fresh.isStale ? ', STALE: they refresh with the next response' : ''})`,
    ...(u.limits.length
      ? orderLimits(u.limits).map(l => `  ${limitLabel(l.kind).padEnd(10)} ${String(l.percentUsed).padStart(5)}% used   ${resetLabel(l.resetsAt, now)}   [${l.kind}]`)
      : ['  no rate-limit windows reported (API key, cloud provider, or no response yet)']),
    `  fable 7d   ${fable ? 'shown above' : 'not reported by Claude Code for this account'}`,
    u.plan ? '' : '  plan: not identified (Claude Code does not tell a plugin your plan; nothing is guessed)',
    '',
    `Context (main thread)  ${u.tokens === null ? 'N/A' : `${u.tokens.toLocaleString('en-US')} / ${(u.window ?? 0).toLocaleString('en-US')} tokens · ${u.percent ?? 'N/A'}% used · ${((u.window ?? 0) - u.tokens).toLocaleString('en-US')} left`}`,
    `Compactions            ${u.compactions}`,
    `Session cost           ${usd(u.costUsd)} API est. (Claude Code's /cost ledger at API prices; a subscription is not charged this)`,
    `Jev spend              ${usd(j.spentUsd)} est. (TypeSafe, from reported input tokens)`,
    '',
    'Tokens by model (each request counted once; per-model $ is not priced by Claude Code):',
    ...(Object.keys(md).length
      ? Object.entries(md).map(
          ([m, r]) =>
            `  ${modelLabel(m).padEnd(11)} ${String(r.requests).padStart(4)} req (${r.leadRequests} lead, ${r.agentRequests} agents)  in ${r.input}  out ${r.output}  cache read ${r.cacheRead}  write ${r.cacheWrite}`,
        )
      : ['  none yet']),
    '  advisor: not included; Claude Code does not report advisor tokens to plugins (its cost is in the session total).',
  ]
  return lines.filter(l => l !== '').join('\n').replace(/\n\n\n/g, '\n\n')
}

// ---- Cache Guard -------------------------------------------------------------
function cancelGuard() {
  guardTimer?.cancel()
  guardTimer = null
}

/** Busy: the lead works or waits on a dialog, or any agent still runs. */
async function isSessionBusy($: EngineInterface): Promise<boolean> {
  const [l, list] = await Promise.all([read($, lead), read($, agents)])
  return l.turnStartedAt !== null || l.isWaiting || list.some(a => a.status === 'running')
}

/** Decides now and schedules the next look; the only place a beat starts. */
async function guardTick($: EngineInterface) {
  cancelGuard()
  if (isBeating) return
  const [g, p, now] = await Promise.all([read($, guard), read($, prefs), $.clock.now()])
  const d = decide(g, p.cacheGuard, { now, isBusy: await isSessionBusy($) })
  if (d.act === 'stop') {
    if (g.status !== d.status || g.reason !== d.reason) {
      await update($, guard, (x): Guard => ({ ...x, status: d.status, reason: d.reason, nextAt: null }))
      if (d.status !== 'OFF' && d.status !== 'ARMED') await addLog($, { who: 'lead', kind: 'info', text: `cache guard ${d.status.toLowerCase()}`, detail: d.reason })
    }
    return
  }
  if (d.act === 'wait') {
    // A warm guard keeps what its beat measured as the reason.
    await update($, guard, (x): Guard => ({ ...x, status: d.status, reason: d.status === 'WARM' && x.reason ? x.reason : d.reason, nextAt: d.until, armedAt: x.armedAt ?? now }))
    guardTimer = $.clock.after(Math.max(1000, d.until - now), () => void guardTick($))
    return
  }
  await beat($)
}

/** One beat: a fork of the main thread's last request, read from the cache. */
async function beat($: EngineInterface) {
  isBeating = true
  try {
    const before = await $.clock.now()
    await update($, guard, (x): Guard => ({ ...x, status: 'REFRESHING', reason: 'beat running' }))
    await addFx($, 'beat', null)
    const costBefore = (await read($, usage)).costUsd
    const r = await $.model.fork({ prompt: BEAT_PROMPT })
    await refreshUsage($)
    const costAfter = (await read($, usage)).costUsd
    const now = await $.clock.now()
    if (!r.isAnswered) {
      const why = r.reason === 'nothing-to-fork' ? 'no conversation to keep warm yet' : `beat failed: ${r.reason}${'status' in r && r.status ? ` ${r.status}` : ''}`
      await update($, guard, (x): Guard => ({
        ...x,
        status: r.reason === 'nothing-to-fork' ? 'PAUSED' : 'ERROR',
        reason: why,
        nextAt: null,
        errors: [...x.errors, why].slice(-5),
      }))
      await addLog($, { who: 'lead', kind: 'error', text: 'cache guard', detail: why })
      return
    }
    const u = r.usage
    const share = readShare(u)
    const isWarm = share !== null && share >= WARM_SHARE
    const idleMin = Math.round((before - Math.max((await read($, guard)).activityAt ?? before, (await read($, guard)).lastBeatAt ?? 0)) / 60_000)
    await update($, guard, (x): Guard => ({
      ...x,
      beats: x.beats + 1,
      lastBeatAt: now,
      tokens: {
        input: x.tokens.input + u.input_tokens,
        output: x.tokens.output + u.output_tokens,
        cacheRead: x.tokens.cacheRead + u.cache_read_input_tokens,
        cacheWrite: x.tokens.cacheWrite + u.cache_creation_input_tokens,
      },
      usd: x.usd + (costBefore !== null && costAfter !== null ? Math.max(0, costAfter - costBefore) : 0),
      lastBeatUsd: costBefore !== null && costAfter !== null ? Math.max(0, costAfter - costBefore) : x.lastBeatUsd,
      lastBeatRead: share,
      isAwaitingProof: isWarm,
      status: isWarm ? 'WARM' : 'EXPIRED',
      nextAt: isWarm ? x.nextAt : null,
      reason: isWarm ? `beat read ${Math.round((share ?? 0) * 100)}% from cache` : 'the cache had lapsed: the beat paid to rebuild it',
      // A beat still served from cache after this much idle proves the cache outlives it.
      ttl: isWarm && idleMin >= 6 ? '1h' : !isWarm && idleMin < 55 && idleMin >= 6 ? '5m' : x.ttl,
      ttlSource: isWarm && idleMin >= 6 ? `a beat read from cache after ${idleMin}m idle` : !isWarm && idleMin >= 6 ? `a beat after ${idleMin}m idle was uncached` : x.ttlSource,
    }))
    await addLog($, {
      who: 'lead',
      kind: isWarm ? 'done' : 'error',
      text: isWarm ? 'cache guard beat · warm' : 'cache guard beat · cache was cold',
      detail: `read ${compact(u.cache_read_input_tokens)} · write ${compact(u.cache_creation_input_tokens)}`,
    })
  } catch (err) {
    const why = `beat error: ${String(err).slice(0, 80)}`
    await update($, guard, (x): Guard => ({ ...x, status: 'ERROR', reason: why, errors: [...x.errors, why].slice(-5) }))
  } finally {
    isBeating = false
  }
  // A warm beat schedules the next; a cold one stops (decide sees EXPIRED's cause next time).
  const g = await read($, guard)
  if (g.status === 'WARM') await guardTick($)
}

/** The lead finished a real turn: idle time starts now. */
async function guardActivityEnded($: EngineInterface) {
  const now = await $.clock.now()
  await update($, guard, (g): Guard => ({ ...g, activityAt: now, ...(g.status === 'EXPIRED' ? { status: 'ARMED' as const, reason: 'rearmed after a new turn' } : {}) }))
  if ((await read($, prefs)).cacheGuard.enabled) await guardTick($)
}

/** The first real request after a beat: did it read from cache? Also TTL evidence from real idle gaps. */
async function guardSawRequest($: EngineInterface, u: { input_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }) {
  const [g, now] = await Promise.all([read($, guard), $.clock.now()])
  const share = readShare(u)
  const gap = g.activityAt === null ? 0 : now - g.activityAt
  await update($, guard, (x): Guard => ({
    ...x,
    ...(x.isAwaitingProof ? { afterBeatRead: share, isAwaitingProof: false } : {}),
    ...(x.ttl === 'unverified' && share !== null && share >= WARM_SHARE && gap >= 6 * 60_000
      ? { ttl: '1h' as const, ttlSource: `the cache held over ${Math.round(gap / 60_000)}m idle` }
      : {}),
  }))
}

async function guardText($: EngineInterface): Promise<string> {
  const [g, p, now] = await Promise.all([read($, guard), read($, prefs), $.clock.now()])
  const c = p.cacheGuard
  const pct = (v: number | null) => (v === null ? 'N/A' : `${Math.round(v * 100)}%`)
  return [
    `Cache Guard: ${g.status}${g.reason ? ` (${g.reason})` : ''}`,
    `  settings   ${c.enabled ? 'on' : 'off'} · beat after ${c.idleMin}m idle · stops after ${c.maxHours}h · ${c.maxBeats} beats · $${c.budgetUsd.toFixed(2)} API est. budget${c.trustTtl ? ' · trusting a 1h TTL' : ''}`,
    `  cache TTL  ${g.ttl}${g.ttlSource ? ` (${g.ttlSource})` : ''}`,
    `  next beat  ${g.nextAt === null ? 'none planned' : `in ${elapsed(g.nextAt - now)}`}`,
    `  last beat  ${g.lastBeatAt === null ? 'none' : `${elapsed(now - g.lastBeatAt)} ago, read ${pct(g.lastBeatRead)} from cache`}`,
    `  after beat ${pct(g.afterBeatRead)} of the next real request came from cache${g.isAwaitingProof ? ' (waiting for that request)' : ''}`,
    `  beats      ${g.beats} · tokens in ${g.tokens.input} · cache read ${g.tokens.cacheRead} · cache write ${g.tokens.cacheWrite} · out ${g.tokens.output}`,
    `  cost       ${usd(g.usd)} API est. (Claude Code's ledger before and after each beat)`,
    '  savings    N/A: a beat avoids a rebuild only if you come back; nothing here proves you will',
    ...(g.errors.length ? ['  errors', ...g.errors.map(e => `    ${e}`)] : []),
    '',
    'A warm beat does not guarantee the next request hits the cache; "after beat" shows what it actually did.',
    'Beats are Claude Code forks: no turn, no transcript entry, tools denied; this plugin\'s own hooks never see them.',
    'Inspired by Cachebeat by Abdur Rahim (@ARahim3): https://github.com/ARahim3/cachebeat (no endorsement implied).',
    'Change: /swarm cache on|off · /swarm settings cacheGuard.<key> <value>',
  ].join('\n')
}

/** Preferences from the plugin's store, migrated; the first run seeds them from the plugin options. */
async function loadPrefs($: EngineInterface) {
  let raw: unknown
  try {
    raw = await $.store.get('prefs')
  } catch {
    raw = undefined
  }
  const seeded = raw ?? { escalation: opts.escalation, animation: opts.motion === 'reduced' ? 'reduced' : opts.motion === 'full' ? 'full' : 'auto' }
  const p = migrate(seeded)
  await update($, prefs, () => p)
  if (JSON.stringify(raw) !== JSON.stringify(p)) await savePrefs($, p)
}

async function savePrefs($: EngineInterface, p: Prefs) {
  try {
    await $.store.set('prefs', p)
  } catch {
    // kept for this session; the next start reads the last saved value
  }
}

/** `/swarm settings [key value]`: show, or change one, for this and later sessions. */
async function settingsCommand($: EngineInterface, args: string): Promise<string> {
  const [key, value] = args.split(/\s+/).filter(Boolean)
  const current = await read($, prefs)
  if (!key) {
    await update($, view, () => ({ kind: 'settings' as const, ref: null }))
    const rows = SETTINGS.map(spec => `  ${spec.key.padEnd(20)} ${prefValue(current, spec.key).padEnd(9)} ${spec.options ? spec.options.join(' | ') : `${spec.range![0]}-${spec.range![1]}`}  · ${spec.help}`)
    return ['Swarm settings (kept in the plugin store; Claude Code settings are not touched):', ...rows, '', 'Change one: /swarm settings <key> <value>'].join('\n')
  }
  if (value === undefined) return `${key} is ${prefValue(current, key)}`
  const out = setPref(current, key, value)
  if (!out.ok) return out.why
  await applyPrefs($, current, out.prefs)
  return `${key} → ${prefValue(out.prefs, key)} (saved for later sessions).`
}

/** Saves and applies new preferences: pane open/closed, motion, Cache Guard. */
async function applyPrefs($: EngineInterface, was: Prefs, next: Prefs) {
  await update($, prefs, () => next)
  await savePrefs($, next)
  if (next.layout === 'minimal' && was.layout !== 'minimal') await $.ui.close({ id: PANE }).catch(() => undefined)
  if (next.layout !== 'minimal' && was.layout === 'minimal') void $.ui.open(paneOpen(next))
  if (next.paneColumns !== was.paneColumns && next.layout !== 'minimal') void $.ui.open(paneOpen(next))
  await syncMotion($)
  animate($)
  if (JSON.stringify(was.cacheGuard) !== JSON.stringify(next.cacheGuard)) {
    if (!next.cacheGuard.enabled) cancelGuard()
    await guardTick($)
  }
}

/** The pane's open request at the preferred width. */
function paneOpen(p: Prefs) {
  return { ...PANE_OPEN, columns: p.paneColumns }
}

/** `/swarm width <columns|wider|narrower>`: resizes without the ctrl+x keys. */
async function widthCommand($: EngineInterface, arg: string): Promise<string> {
  const p = await read($, prefs)
  const want = arg === 'wider' ? p.paneColumns + 10 : arg === 'narrower' ? p.paneColumns - 10 : Number(arg)
  if (!arg || !Number.isFinite(want)) return `The pane asks for ${p.paneColumns} columns. Usage: /swarm width <40-200> | wider | narrower`
  const columns = Math.round(Math.min(200, Math.max(40, want)))
  await applyPrefs($, p, { ...p, paneColumns: columns })
  const kept = await keptDockColumns($)
  keptWidth = kept
  if (kept !== null) {
    return [
      `Not resized. The pane is ${kept} columns because you resized it by hand once, and Claude Code always keeps a hand-set width over what a plugin asks for.`,
      'Resize it by dragging the pane\'s left edge, or click the pane and press ctrl+x then ← (wider) or → (narrower).',
      `To let /swarm width control it again: quit every Claude Code window, then remove "dockColumns" from "pluginPanes" in ~/.claude.json. (${columns} is saved for that.)`,
    ].join('\n')
  }
  return `Pane width → ${columns} columns (Claude Code caps a docked pane at 45% of the terminal; saved for later sessions).`
}

/** The dock width Claude Code keeps after the person resized it by hand; read only. */
async function keptDockColumns($: EngineInterface): Promise<number | null> {
  try {
    const raw = JSON.parse(await $.fs.read(`${home}/.claude.json`)) as { pluginPanes?: { dockColumns?: unknown } }
    const v = raw.pluginPanes?.dockColumns
    return typeof v === 'number' ? v : null
  } catch {
    return null
  }
}

/** Applies `change` to one agent by id. */
async function patchAgent($: EngineInterface, id: string, change: (a: SwarmAgent) => SwarmAgent) {
  await update($, agents, list => list.map(a => (a.id === id ? change(a) : a)))
}

/** Ends an agent's run once: a later report never reopens or relabels it. */
async function finishAgent($: EngineInterface, id: string, status: SwarmAgent['status'], reason: string | null) {
  const now = await $.clock.now()
  const agent = (await read($, agents)).find(a => a.id === id)
  if (!agent || agent.status !== 'running') return
  await patchAgent($, id, a => ({ ...a, status, reason, endedAt: now }))
  await addFx($, 'done', id)
  await addLog($, {
    who: who(agent.type),
    kind: status === 'done' ? 'done' : 'error',
    text: `${agent.label} ${status === 'done' ? `done in ${elapsed(now - agent.startedAt)}` : status}`,
    detail: status === 'done' ? `${agent.steps} turns · ${agent.tools} tools` : (reason ?? ''),
  })
}

/** What a tool call names: a file path when it has one, else a short form of its main argument. */
function toolTarget(e: Record<string, unknown>): { file: string | null; label: string } {
  const path = ['file_path', 'notebook_path', 'path'].map(k => e[k]).find(v => typeof v === 'string') as string | undefined
  if (path) {
    const rel = cwd && path === cwd ? '.' : cwd && path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path
    return { file: rel, label: rel.split('/').pop() ?? rel }
  }
  const arg = ['pattern', 'command', 'query', 'url'].map(k => e[k]).find(v => typeof v === 'string') as string | undefined
  return { file: null, label: arg ? (arg.length > 28 ? `${arg.slice(0, 27)}…` : arg) : '' }
}

/** The Agent tool's own totals, matched to the instance by its tool_use_id. */
async function recordAgentResult($: EngineInterface, toolUseId: string | undefined, result: unknown) {
  if (!toolUseId || !result || typeof result !== 'object') return
  const r = result as { totalTokens?: unknown; resolvedModel?: unknown; usage?: unknown }
  const ttl = ttlEvidence(r.usage)
  // Subagent 1h writes show the account caches for an hour; 5m-only proves nothing about the main thread.
  if (ttl === '1h') await update($, guard, (g): Guard => (g.ttl === 'unverified' ? { ...g, ttl: '1h', ttlSource: 'subagent cache writes were 1-hour' } : g))
  const total = typeof r.totalTokens === 'number' ? r.totalTokens : null
  const model = typeof r.resolvedModel === 'string' ? r.resolvedModel : null
  if (total === null && model === null) return
  await update($, agents, list =>
    list.map(a => (a.toolUseId === toolUseId ? { ...a, reportedTokens: total ?? a.reportedTokens, model: model ?? a.model } : a)),
  )
}

/** An instance by its number in /swarm agents (1-based) or its label. */
export function findAgent(list: SwarmAgent[], ref: string): SwarmAgent | undefined {
  const n = Number(ref)
  if (Number.isInteger(n) && n >= 1) return list[n - 1]
  return list.find(a => a.label === ref || a.id === ref)
}

/** maxTurns and isolation from the agent's definition file, when it has one. */
async function definition($: EngineInterface, type: string) {
  for (const dir of [`${cwd}/.claude/agents`, `${home}/.claude/agents`]) {
    try {
      const text = await $.fs.read(`${dir}/${type}.md`)
      const head = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? ''
      const turns = /^maxTurns:\s*(\d+)/m.exec(head)?.[1]
      return {
        maxTurns: turns ? Number(turns) : null,
        isWorktree: /^isolation:\s*worktree/m.test(head),
      }
    } catch {
      // not in this folder; try the next
    }
  }
  return { maxTurns: null, isWorktree: false }
}

/** A string setting: a key read answers the value itself, a test kit the settings object. */
async function setting($: EngineInterface, key: 'model' | 'advisorModel'): Promise<string | null> {
  try {
    const value = key === 'model' ? await $.settings.read({ key: 'model' }) : await $.settings.read({ key: 'advisorModel' })
    if (typeof value === 'string') return value || null
    const nested = (value as Record<string, unknown> | null)?.[key]
    return typeof nested === 'string' && nested ? nested : null
  } catch {
    return null
  }
}

/** The animation preference, then the plugin's `motion` option, else the native reduceMotion setting. */
async function prefersStill($: EngineInterface): Promise<boolean> {
  const anim = (await read($, prefs)).animation
  isMotionOff = anim === 'off'
  if (anim === 'reduced' || anim === 'off') return true
  if (anim === 'full') return false
  if (opts.motion === 'reduced') return true
  if (opts.motion === 'full') return false
  try {
    const row = (await $.config.list()).find(r => r.key === 'reduceMotion')
    return row?.value === true
  } catch {
    return false
  }
}

async function syncMotion($: EngineInterface) {
  isReduced = await prefersStill($)
  if ((await read($, reduceMotion)) !== isReduced) await update($, reduceMotion, () => isReduced)
}

// ---- Jev: observation only, never awaited by the tool path --------------
/** The key from the environment, else the login Keychain; held in memory only, never logged. */
async function loadJevKey($: EngineInterface): Promise<string | undefined> {
  const fromEnv = await $.env.get('TYPESAFE_API_KEY')
  if (fromEnv) return fromEnv
  try {
    const out = await $.process.run(['/usr/bin/security', 'find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], {
      timeoutMs: 5000,
    })
    const key = out.exitCode === 0 ? out.stdout.trim() : ''
    return key || undefined
  } catch {
    return undefined
  }
}

function observeJev($: EngineInterface, ask: JevAsk, actualTool: string | null) {
  if (routing === 'off') return
  // Unawaited: a module unloaded mid-request must not leave a rejection behind.
  void consult($, ask, actualTool).catch(() => null)
}

/** One Jev request through the gate; draws and logs its answers. null when none came. */
async function consult($: EngineInterface, ask: JevAsk, actualTool: string | null): Promise<JevDecision[] | null> {
  if (!jevKey || routing === 'off') return null
  const key = jevKey
  {
    const now = await $.clock.now()
    const blocked = gate.allow(now)
    if (blocked) {
      await markJev($, blocked)
      return null
    }
    const out = await askJev($, key, ask, now)
    if (!out.ok) {
      gate.fail(now)
      await markJev($, out.reason)
      return null
    }
    gate.record(now, out.inputTokens ?? 0)
    const pick = out.decisions.find(d => d.question === 'which tool')
    const isChecked = pick !== undefined && actualTool !== null && actualTool in toolQuestion().criteria
    await update($, jev, j => ({
      ...j,
      status: 'on' as const,
      reason: null,
      decisions: j.decisions + out.decisions.length,
      last: [...j.last.filter(d => !out.decisions.some(n => n.question === d.question)), ...out.decisions],
      toolChecked: j.toolChecked + (isChecked ? 1 : 0),
      toolAgreed: j.toolAgreed + (isChecked && pick?.choice === actualTool ? 1 : 0),
      calls: j.calls + 1,
      spentUsd: gate.spent,
    }))
    if (out.decisions.length) await addFx($, 'route', 'observed')
    for (const d of out.decisions) {
      await addFx($, 'jev', d.question)
      await addLog($, {
        who: 'jev',
        kind: 'jev',
        text: `${d.question}  → ${d.choice}`,
        detail: `p=${d.p.toFixed(2)}${d.confidence === null ? '' : ` c=${d.confidence.toFixed(2)}`}  ${d.isSharp ? 'sharp' : 'split'}`,
      })
    }
    return out.decisions
  }
}

// ---- active routing: read-only calls of the lead only (see routing.ts) -----
async function setRouting($: EngineInterface, next: Jev['routing']) {
  routing = next
  await update($, jev, j => ({ ...j, routing: next }))
}

/** The lead decided: Jev's answer missed the bar or never came. */
async function fallback($: EngineInterface, why: string) {
  await addFx($, 'route', 'fallback')
  await update($, jev, j => ({ ...j, fallbacks: j.fallbacks + 1, lastRoute: `fallback: ${why}` }))
  await addLog($, { who: 'jev', kind: 'info', text: 'fallback → lead decides', detail: why })
}

/** A failed read-only call: Jev may have it run once more. */
async function routeRetry($: EngineInterface, tool: string, failure: string, rerun: () => Promise<any>, failed: any) {
  const j = await read($, jev)
  if (j.retries >= ROUTE.maxRetries) {
    await fallback($, `retry cap ${ROUTE.maxRetries} reached`)
    return failed
  }
  const kind = errorKind(failure)
  const answers = await consult($, { history: [...history, `FAILED ${tool}: ${kind}`], questions: { 'retry or stop': retryQuestion() } }, null)
  const d = answers?.find(x => x.question === 'retry or stop')
  if (d && d.choice !== 'retry') {
    await update($, jev, x => ({ ...x, lastRoute: `no retry: ${d.choice} (${kind})` }))
    return failed
  }
  const verdict = accept(d)
  if (!verdict.act) {
    await fallback($, verdict.why)
    return failed
  }
  await addFx($, 'route', 'accepted')
  const again = await rerun()
  const isFixed = !('deny' in again && again.deny) && again.isError !== true
  await update($, jev, x => ({
    ...x,
    retries: x.retries + 1,
    recovered: x.recovered + (isFixed ? 1 : 0),
    lastRoute: `retried ${tool}: ${isFixed ? 'recovered' : 'still failing'}`,
  }))
  await addLog($, { who: 'jev', kind: isFixed ? 'done' : 'error', text: `routed: retried ${tool}`, detail: isFixed ? 'recovered' : 'still failing' })
  return again
}

/** After a read inside the workspace: Jev's pick among its sibling files, attached as an optional note. */
async function routeHint($: EngineInterface, path: string, base: string, ran: any) {
  const dir = path.slice(0, path.lastIndexOf('/'))
  if (!cwd || !dir || (dir !== cwd && !dir.startsWith(`${cwd}/`))) return ran
  let names: string[]
  try {
    names = candidates([...(await $.fs.list(dir))], base)
  } catch {
    return ran
  }
  const q = fileQuestion(names)
  if (!q) return ran
  const answers = await consult($, { history: [...history], questions: { 'which file': q } }, null)
  const d = answers?.find(x => x.question === 'which file')
  const verdict = accept(d)
  if (!verdict.act || !d) {
    await fallback($, verdict.act ? 'no answer' : verdict.why)
    return ran
  }
  pendingHint = d.choice
  await addFx($, 'route', 'accepted')
  await update($, jev, x => ({ ...x, hints: x.hints + 1, lastRoute: `hint: ${d.choice}` }))
  await addLog($, { who: 'jev', kind: 'jev', text: `routed: next file → ${d.choice}`, detail: 'hint attached · lead decides' })
  return { ...ran, context: [...(ran.context ?? []), hintText(d.choice, d)] }
}

/** Fixed cases with known answers; active routing engages only when they pass. */
async function calibrate($: EngineInterface): Promise<string> {
  if (!jevKey) return 'Jev has no key: active routing stays off.'
  const key = jevKey
  const was = routing
  await setRouting($, 'calibrating')
  const results: CaseResult[] = []
  for (const c of CALIBRATION) {
    const now = await $.clock.now()
    const blocked = gate.allow(now)
    if (blocked) {
      results.push({ id: c.id, choice: null, p: null, isRight: false, isUnsafe: false })
      continue
    }
    const instructions = c.question === 'retry or stop' ? retryQuestion().instructions : 'Which file is the coding agent most likely to need to work on next?'
    const out = await askJev($, key, { history: c.history, questions: { [c.question]: { type: 'choice', instructions, criteria: c.criteria } } }, now)
    if (!out.ok) {
      gate.fail(now)
      results.push({ id: c.id, choice: null, p: null, isRight: false, isUnsafe: false })
      continue
    }
    gate.record(now, out.inputTokens ?? 0)
    results.push(judge(c, out.decisions.find(d => d.question === c.question)))
  }
  const cal = score(results)
  const at = await $.clock.now()
  const next: Jev['routing'] = cal.passed ? 'active' : was === 'off' ? 'off' : 'observe'
  routing = next
  await update($, jev, j => ({
    ...j,
    routing: next,
    calls: j.calls + results.filter(r => r.choice !== null).length,
    spentUsd: gate.spent,
    calibration: { passed: cal.passed, right: cal.right, total: cal.total, unsafe: cal.unsafe, at },
  }))
  await addLog($, {
    who: 'jev',
    kind: cal.passed ? 'done' : 'error',
    text: `calibration ${cal.passed ? 'passed' : 'failed'} · ${cal.right}/${cal.total} right`,
    detail: `${cal.unsafe} unsafe · routing ${next}`,
  })
  const lines = results.map(
    r => `  ${r.isRight ? '✓' : r.isUnsafe ? '✗ UNSAFE' : '·'} ${r.id}: ${r.choice ?? 'no answer'}${r.p === null ? '' : ` (p ${r.p.toFixed(2)})`}`,
  )
  return [
    `Jev calibration ${cal.passed ? 'passed' : 'failed'}: ${cal.right}/${cal.total} right, ${cal.unsafe} unsafe.`,
    ...lines,
    `Routing is now ${next}${cal.passed ? '' : ' (active needs no unsafe answer and 2/3 right)'}.`,
  ].join('\n')
}

async function jevStatus($: EngineInterface): Promise<string> {
  const j = await read($, jev)
  const cal = j.calibration
  return [
    `Jev: ${j.status}${j.reason ? ` (${j.reason})` : ''} · routing ${j.routing}`,
    `Bar to act: p ≥ ${ROUTE.minP} and confidence ≥ ${ROUTE.minConfidence}; routes only the lead's read-only ${[...ROUTABLE].join('/')} calls.`,
    `Calibration: ${cal ? `${cal.passed ? 'passed' : 'failed'} ${cal.right}/${cal.total}, ${cal.unsafe} unsafe` : 'not run this session'}`,
    `Hints ${j.hints} (followed ${j.hintsFollowed}/${j.hintsChecked}) · retries ${j.retries} (recovered ${j.recovered}) · fallbacks ${j.fallbacks}`,
    `Observed: ${j.decisions} decisions · tool agreed ${j.toolAgreed}/${j.toolChecked} · ${j.calls} calls · $${j.spentUsd.toFixed(4)} of $0.50`,
    `Last: ${j.lastRoute ?? 'none'}`,
    'Usage: /swarm-jev [status|active|observe|off|calibrate]',
  ].join('\n')
}

/** The call a permission dialog held has run or been refused: the lead works again. */
async function settleWait($: EngineInterface) {
  await update($, lead, l => (l.isWaiting ? { ...l, isWaiting: false } : l))
}

async function markJev($: EngineInterface, reason: string) {
  const was = await read($, jev)
  if (was.status === 'down' && was.reason === reason) return
  await update($, jev, j => ({ ...j, status: 'down' as const, reason }))
  await addLog($, { who: 'jev', kind: 'error', text: 'unavailable', detail: reason })
}

// ---- modes: session-scoped; nothing here writes a setting -----------------
function describeRunning(m: Mode, l: Lead): string {
  const running = modelLabel(l.model ?? m.sessionModel)
  const effort = l.effort ?? m.effort ?? 'default'
  return `${running} · effort ${effort} · advisor ${m.sessionAdvisor ? modelLabel(m.sessionAdvisor) : 'off'}`
}

function modeLabel(m: Mode): string {
  const id = m.selected ?? launchedMode(m.sessionModel, m.sessionAdvisor)
  return id ? MODES[id].label : 'Custom'
}

/** Applies a mode to this session (null: back to the session as launched); returns the report. */
async function applyMode($: EngineInterface, id: ModeId | null, via: string): Promise<string> {
  const m = await read($, mode)
  if (id === null) {
    await update($, mode, x => ({ ...x, selected: null, main: null, effort: null, relaunch: null }))
    await addFx($, 'mode', null)
    await addLog($, { who: 'mode', kind: 'mode', text: 'back to the session as launched', detail: via })
    return [
      `Swarm mode: as launched (${modelLabel(m.sessionModel)} · advisor ${m.sessionAdvisor ? modelLabel(m.sessionAdvisor) : 'off'}).`,
      'The model rewrite is off from the next request. Nothing was written to your settings.',
    ].join('\n')
  }
  const p = plan(id, m.sessionAdvisor, sessionId)
  await update($, mode, x => ({
    ...x,
    selected: p.now ? id : x.selected,
    main: p.now ? p.now.main : x.main,
    effort: p.now ? p.now.effort : x.effort,
    relaunch: p.relaunch,
  }))
  await addFx($, 'mode', id)
  await addLog($, {
    who: 'mode',
    kind: 'mode',
    text: p.now ? `${p.mode.label}${p.isComplete ? '' : ' (advisor on relaunch)'}` : `${p.mode.label} needs a relaunch`,
    detail: via,
  })
  const lines = [`Swarm mode: ${p.mode.label}. Cost: ${p.mode.cost}.`]
  if (p.now) {
    lines.push(`Applied now, this session only: main ${p.now.main} · effort ${p.now.effort}, from the next request.`)
    lines.push('A new effort level starts with your next message; steps that only carry tool results keep the old one.')
    lines.push('Changing the main model re-sends the conversation without the prompt cache once.')
  }
  for (const note of p.notes) lines.push(`Note: ${note}.`)
  if (p.relaunch) {
    lines.push('To run the full mode, exit and relaunch this conversation with a session-scoped advisor:')
    lines.push(`  ${p.relaunch}`)
  }
  lines.push('Nothing was written to your settings; other sessions are unaffected.')
  return lines.join('\n')
}

const PICK = ['Balanced', 'Deep Engineering', 'Maximum Reasoning', 'As launched'] as const

/** The native dialog: pick a mode, then confirm any step up in cost. */
async function chooseMode($: EngineInterface): Promise<string> {
  const [m, l] = await Promise.all([read($, mode), read($, lead)])
  let pick: string
  try {
    pick = await $.ui.ask(`Swarm mode is ${modeLabel(m)}, running ${describeRunning(m, l)}. Which mode for the rest of this session?`, {
      options: [...PICK],
      header: 'Swarm mode',
    })
  } catch {
    return 'Swarm mode unchanged (dialog dismissed).'
  }
  if (pick === 'As launched') return applyMode($, null, 'chosen')
  const id = MODE_IDS[PICK.indexOf(pick as (typeof PICK)[number])]
  if (!id) return `Swarm mode unchanged: "${pick}" is not a mode.`
  if (MODES[id].level > currentLevel(m, l.model)) {
    const p = plan(id, m.sessionAdvisor, sessionId)
    const where = p.now ? (p.isComplete ? 'Applies now.' : 'The main model applies now; the advisor needs a relaunch.') : 'Needs a relaunch.'
    let ok: string
    try {
      ok = await $.ui.ask(`${MODES[id].label} costs more: ${MODES[id].cost}. ${where} Apply it?`, {
        options: ['Apply', 'Cancel'],
        header: 'Cost',
      })
    } catch {
      ok = 'Cancel'
    }
    if (ok !== 'Apply') return 'Swarm mode unchanged.'
  }
  return applyMode($, id, 'chosen')
}

async function statusText($: EngineInterface): Promise<string> {
  const [m, l, j] = await Promise.all([read($, mode), read($, lead), read($, jev)])
  const lines = [
    `Swarm mode: ${modeLabel(m)}`,
    `Running: ${describeRunning(m, l)}${l.requested ? ` (last request asked for ${l.requested})` : ''}`,
    `Session launched with: ${modelLabel(m.sessionModel)} · advisor ${m.sessionAdvisor ?? 'off'} (from settings or --settings)`,
    `Rewrite in force: ${m.main ? `main ${m.main} · effort ${m.effort}` : 'none'}`,
    `Escalation: ${(await read($, prefs)).escalation === 'off' ? 'off' : 'asks first'} · Haiku checks ${m.classified}/${CLASSIFY_CAP}`,
    `Jev: ${j.status}${j.reason ? ` (${j.reason})` : ''} · ${j.calls} calls · $${j.spentUsd.toFixed(4)} · routing ${j.routing}`,
  ]
  if (m.relaunch) lines.push(`Relaunch for the full mode: ${m.relaunch}`)
  lines.push('Usage: /swarm-mode [balanced|deep|max|default|status]')
  return lines.join('\n')
}

// ---- escalation: rules first, Haiku only when they are unsure -------------
async function escalate($: EngineInterface, text: string) {
  const [m, l] = await Promise.all([read($, mode), read($, lead)])
  const a = assess(text, m.recentErrors)
  if (a.level === 0) return
  let level = a.level
  const reasons = [...a.reasons]
  // Haiku can only raise the level; past the top there is nothing left to offer.
  const ceiling = Math.max(currentLevel(m, l.model), m.declinedLevel)
  if (a.isAmbiguous && ceiling < 3 && opts.classifier !== false && m.classified < CLASSIFY_CAP) {
    await update($, mode, x => ({ ...x, classified: x.classified + 1 }))
    try {
      const label = await $.model.classify(text.slice(0, 4000), CLASSIFY_LABELS, { model: 'haiku' })
      const rated = label === 'extreme' ? 3 : label === 'complex' ? 2 : 1
      if (rated > level) {
        level = rated
        reasons.push(`Haiku rated it ${label}`)
      }
    } catch {
      // the rules' answer stands
    }
  }
  if (level <= currentLevel(m, l.model) || level <= m.declinedLevel) return

  const rec = MODES[modeForLevel(level)]
  const p = plan(rec.id, m.sessionAdvisor, sessionId)
  const where = p.now ? (p.isComplete ? 'applies now' : 'switches the main model now; the advisor waits for a relaunch') : 'needs a relaunch'
  const keep = `Keep ${modeLabel(m)}`
  const go = `Switch to ${rec.label}`
  let pick: string
  try {
    pick = await $.ui.ask(
      `This looks like a ${rec.label} task (${reasons.join('; ')}). Switch from ${modeLabel(m)}? It ${where}; cost: ${rec.cost}.`,
      { options: [keep, go, 'Choose manually'], header: 'Swarm mode' },
    )
  } catch {
    pick = keep
  }
  if (pick === go) {
    $.ui.log(await applyMode($, rec.id, 'approved'))
  } else if (pick === 'Choose manually') {
    $.ui.log(await chooseMode($))
  } else {
    await update($, mode, x => ({ ...x, declinedLevel: Math.max(x.declinedLevel, level) }))
    await addLog($, { who: 'mode', kind: 'info', text: `kept ${modeLabel(m)}`, detail: `${rec.label} suggested` })
  }
}

export const register: Register = (on, options) => {
  opts = options

  // ---- session --------------------------------------------------------------
  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    home = (await $.env.get('HOME')) ?? ''
    sessionId = await $.session.id()
    jevKey = await loadJevKey($)
    const [sessionAdvisor, sessionModel] = await Promise.all([setting($, 'advisorModel'), $.session.model()])
    await update($, mode, m => ({ ...m, sessionAdvisor, sessionModel }))
    // Until the first response names the model, show the session's own.
    await update($, lead, l => ({ ...l, model: l.model ?? sessionModel }))
    const j = await read($, jev)
    gate.spent = j.spentUsd
    routing = j.routing === 'calibrating' ? 'observe' : j.routing
    if (opts.jevRouting === 'off') routing = 'off'
    if (routing !== j.routing) await update($, jev, x => ({ ...x, routing }))
    if (jevKey) {
      if (j.status === 'off') await update($, jev, x => ({ ...x, status: 'on' as const, reason: null }))
    } else {
      await update($, jev, x => ({ ...x, status: 'off' as const, reason: 'no key: TYPESAFE_API_KEY or Keychain claude-swarm-typesafe' }))
    }
    await loadPrefs($)
    keptWidth = await keptDockColumns($)
    await syncMotion($)
    // The plan only where Claude Code itself answers it: never guessed from a model.
    try {
      const id = await $.session.identity()
      const plan = !id.deny && id.organizationType ? id.organizationType : null
      await update($, usage, u => ({ ...u, plan }))
    } catch {
      // not available to this plugin: the strip reads "usage"
    }
    await refreshUsage($)
    // A reload loses the module's timer: pick the guard up again from its state.
    if ((await read($, prefs)).cacheGuard.enabled) await guardTick($)

    await $.command.register({
      name: 'swarm',
      description: 'Show the Sonnet / Haiku swarm / Opus advisor / Jev pane',
    })
    await $.command.register({
      name: 'swarm-mode',
      description: 'View or change the model mode for this session: balanced, deep, max, default, status',
    })
    await $.command.register({
      name: 'swarm-jev',
      description: 'Jev routing for this session: status, active (after calibration), observe, off, calibrate',
    })
    // Asked for in /config: calibrate in the background, act only once it passes.
    if (jevKey && opts.jevRouting === 'active' && routing !== 'active') void calibrate($)
    // Unasked, the engine seats it only on a wide terminal; /swarm opens it anywhere.
    {
      const p = await read($, prefs)
      if (p.layout !== 'minimal') void $.ui.open(paneOpen(p))
    }

    return next(e)
  })

  on('command.run', { command: 'swarm' }, async ($, e) => {
    const [sub = '', ...rest] = e.args.trim().split(/\s+/)
    const arg = rest.join(' ')
    const list = await read($, agents)
    if (sub === 'agents') return { text: agentList(list) }
    if (sub === 'inspect') {
      const agent = arg ? findAgent(list, arg) : list.find(a => a.status === 'running') ?? list.at(-1)
      if (!agent) return { text: list.length ? `No agent "${arg}".\n${agentList(list)}` : 'No agents this session yet.' }
      await update($, view, () => ({ kind: 'agent' as const, ref: agent.id }))
      return { text: agentDetail(agent, await $.clock.now()) }
    }
    if (sub === 'settings') return { text: await settingsCommand($, arg) }
    if (sub === 'width') return { text: await widthCommand($, arg) }
    if (sub === 'usage') return { text: await usageText($) }
    if (sub === 'cache') {
      if (arg === 'on' || arg === 'off') {
        const out = await settingsCommand($, `cacheGuard.enabled ${arg}`)
        return { text: `${out}\n${await guardText($)}` }
      }
      return { text: await guardText($) }
    }
    if (sub === 'layout') return { text: await settingsCommand($, `layout ${arg}`) }
    if (sub === 'back') {
      await update($, view, () => ({ kind: 'diagram' as const, ref: null }))
      return { text: 'Swarm pane: diagram.' }
    }
    const opened = await $.ui.open(paneOpen(await read($, prefs)))
    return { text: opened.isPlaced ? 'NEXUS pane opened. Click it (or ctrl+x tab) to focus, then 1-9 inspect an agent; /swarm width resizes it.' : `Swarm pane waits: ${opened.reason}` }
  })

  on('command.run', { command: 'swarm-mode' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === '') return { text: await chooseMode($) }
    if (arg === 'status') return { text: await statusText($) }
    if (arg === 'default' || arg === 'reset' || arg === 'launched') return { text: await applyMode($, null, '/swarm-mode') }
    const id = MODE_IDS.find(m => m === arg || MODES[m].label.toLowerCase().startsWith(arg))
    if (!id) return { text: `Unknown mode "${arg}".\n${await statusText($)}` }
    return { text: await applyMode($, id, '/swarm-mode') }
  })

  on('command.run', { command: 'swarm-jev' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === '' || arg === 'status') return { text: await jevStatus($) }
    if (arg === 'observe' || arg === 'off') {
      await setRouting($, arg)
      await addLog($, { who: 'jev', kind: 'mode', text: `routing ${arg}`, detail: '/swarm-jev' })
      return { text: `Jev routing is ${arg} from now on${arg === 'off' ? ': no requests are sent' : ': answers are drawn, nothing is changed'}.` }
    }
    if (arg === 'active' || arg === 'calibrate') {
      const j = await read($, jev)
      if (arg === 'active' && j.calibration?.passed) {
        await setRouting($, 'active')
        return { text: 'Jev routing is active (calibration passed earlier this session).' }
      }
      return { text: await calibrate($) }
    }
    return { text: `Unknown "${arg}".\n${await jevStatus($)}` }
  })

  // ---- prompts: offer a stronger mode, never switch without a yes ----------
  on('prompt.submit', async ($, e, next) => {
    const isTyped = !e.command && !e.isMeta && !e.turnId && e.origin.kind === 'composer'
    if (isTyped && (await read($, prefs)).escalation !== 'off') await escalate($, e.text)
    return next(e)
  }).catch(($, e, next) => next(e)) // a failed check never holds up the prompt

  // ---- turns: the lead's and every subagent's model requests -------------
  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      cancelGuard()
      const now = await $.clock.now()
      // /advisor in this session changes it; keep what the dashboard says true.
      const sessionAdvisor = await setting($, 'advisorModel')
      await update($, mode, m => (m.sessionAdvisor === sessionAdvisor ? m : { ...m, sessionAdvisor }))
      await update($, lead, l => ({ ...l, turnStartedAt: now, turnOutputTokens: 0, isWaiting: false }))
      await syncMotion($)
      animate($)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      await update($, lead, l => ({ ...l, turnStartedAt: null, isWaiting: false }))
      await refreshUsage($)
      await guardActivityEnded($)
    }
    else if (e.reason === 'aborted' || e.isAborted) await finishAgent($, e.agentId, 'cancelled', 'interrupted')
    else if (e.reason === 'error') await finishAgent($, e.agentId, 'failed', 'the run ended on an error')
    else if (e.reason === 'refusal') await finishAgent($, e.agentId, 'failed', 'the model refused')
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId) {
      const result = yield* next(e)
      const id = e.agentId
      const u = result.usage
      await countStep($, stepKey(id, e.turnId, e.index), u?.model, u, true)
      await patchAgent($, id, a => ({
        ...a,
        steps: a.steps + 1,
        model: u?.model ?? a.model,
        tokens: u
          ? {
              input: a.tokens.input + u.input_tokens,
              output: a.tokens.output + u.output_tokens,
              cacheRead: a.tokens.cacheRead + u.cache_read_input_tokens,
              cacheWrite: a.tokens.cacheWrite + u.cache_creation_input_tokens,
            }
          : a.tokens,
      }))
      return result
    }

    // The mode's rewrite, main loop only, and only where the session's advisor
    // can advise the new model: past it the API refuses the request.
    const m = await read($, mode)
    let req = e
    if (m.main) {
      const fits = pairing(m.main, m.sessionAdvisor)
      if (fits.ok) req = { ...e, model: m.main, ...(m.effort ? { effort: m.effort } : {}) }
      else if (!hasWarnedPairing) {
        hasWarnedPairing = true
        await addLog($, { who: 'mode', kind: 'error', text: 'mode not applied', detail: fits.reason })
      }
    }
    const result = yield* next(req)
    const usage_ = result.usage
    await countStep($, stepKey(undefined, e.turnId, e.index), usage_?.model, usage_, false)
    if (usage_) await guardSawRequest($, usage_)
    await refreshUsage($)

    const context = usage_
      ? usage_.input_tokens + usage_.cache_read_input_tokens + usage_.cache_creation_input_tokens + usage_.output_tokens
      : null
    await update($, lead, l => ({
      ...l,
      model: usage_?.model ?? l.model,
      requested: req.model,
      effort: typeof req.effort === 'string' ? req.effort : req.effort === undefined ? l.effort : String(req.effort),
      steps: l.steps + 1,
      outputTokens: l.outputTokens + (usage_?.output_tokens ?? 0),
      turnOutputTokens: l.turnOutputTokens + (usage_?.output_tokens ?? 0),
      // isWaiting is left alone: tools start while a step still streams, so a
      // dialog may already be up. It clears when its call settles.
      contextTokens: context ?? l.contextTokens,
    }))

    // The API runs the advisor inside the request and reports it only here, so
    // its pulse plays when the step ends, not while the advisor thinks.
    for (const use of result.serverToolUses ?? []) {
      if (use.name !== 'advisor') continue
      const ms = use.endedAt === undefined ? null : use.endedAt - use.startedAt
      // The API sums the advisor's own read into this step's usage, so the
      // lead's figure would double: take the context Claude Code reports.
      const before = (await read($, usage)).tokens
      await update($, advisor, a => ({
        calls: a.calls + 1,
        lastAt: use.startedAt,
        lastMs: ms,
        contextAtCall: before,
        history: [...a.history, { at: use.startedAt, ms, context: before }].slice(-5),
      }))
      await addFx($, 'advisor', use.id, 2 * DUAL[(await read($, prefs)).advisorOrbit].cycleMs)
      await addLog($, {
        who: 'advisor',
        kind: 'advisor',
        text: `${family(m.sessionAdvisor) ?? 'advisor'} consulted · read the full session`,
        detail: `${compact(before)} ctx${ms === null ? '' : ` · ${elapsed(ms)}`}`,
      })
    }
    return result
  })

  on('session.end', async ($, e, next) => {
    cancelGuard()
    await update($, guard, (g): Guard => (g.status === 'OFF' ? g : { ...g, status: 'OFF', reason: 'session ended', nextAt: null }))
    return next(e)
  }).catch(($, e, next) => next(e))

  // Counted, never changed: the compaction runs as the engine decides.
  on('session.compact', async ($, e, next) => {
    const out = await next(e)
    if (!e.agentId && !('skip' in out && out.skip)) await update($, usage, u => ({ ...u, compactions: u.compactions + 1 }))
    return out
  }).catch(($, e, next) => next(e))

  // ---- subagents ----------------------------------------------------------
  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (!spawned.agentId) return spawned

    const def = await definition($, e.subagentType)
    const sameType = (await read($, agents)).filter(a => a.type === e.subagentType).length
    const agent: SwarmAgent = {
      id: spawned.agentId,
      type: e.subagentType,
      label: `${role(e.subagentType)}#${sameType + 1}`,
      isSwarm: e.subagentType.startsWith('swarm-'),
      description: e.description,
      prompt: (e.prompt.split('\n').find(line => line.trim()) ?? '').trim().slice(0, 160),
      model: spawned.model,
      status: 'running',
      steps: 0,
      maxTurns: def.maxTurns,
      tools: 0,
      lastTool: null,
      isWorktree: def.isWorktree,
      startedAt: await $.clock.now(),
      endedAt: null,
      files: [],
      recent: [],
      summary: null,
      reason: null,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      reportedTokens: null,
      toolUseId: e.tool_use_id ?? null,
    }
    await update($, agents, list => [...list.filter(a => a.id !== agent.id), agent].slice(-40))
    await addFx($, 'spawn', agent.id)
    await addLog($, { who: who(agent.type), kind: 'start', text: `${agent.label} started`, detail: e.description })
    return spawned
  }).catch(($, e, next) => next(e)) // an observer never holds up the engine

  on('classic.SubagentStop', async ($, e, next) => {
    const last = typeof e.last_assistant_message === 'string' ? e.last_assistant_message.trim().slice(0, 600) : ''
    if (last) await patchAgent($, e.agent_id, a => ({ ...a, summary: last }))
    await finishAgent($, e.agent_id, 'done', null)
    return next(e)
  }).catch(($, e, next) => next(e)) // an observer never holds up the engine

  // The engine is putting a call to the person: the heartbeat stops until the
  // call runs or the turn moves on. Read only: the verdict goes up unchanged.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'ask') await update($, lead, l => (l.turnStartedAt === null ? l : { ...l, isWaiting: true }))
    return verdict
  }).catch(($, e, next) => next(e))

  // ---- tool calls: subagent activity, and what Jev observes of the lead ---
  on('tool.call', async ($, e, next) => {
    if (e.agentId) {
      const id = e.agentId
      const name = String(e.tool)
      const target = toolTarget(e)
      const at = await $.clock.now()
      await patchAgent($, id, a => ({
        ...a,
        tools: a.tools + 1,
        lastTool: name,
        files: target.file && !a.files.includes(target.file) ? [...a.files, target.file].slice(-12) : a.files,
        recent: [...a.recent, { at, text: `${name} ${target.label}`.trim() }].slice(-6),
      }))
      // Some agents hand their answer back through a tool call rather than a final message.
      if (name === 'SubagentHandback') {
        const text = ['result', 'message', 'summary', 'content', 'text'].map(k => (e as Record<string, unknown>)[k]).find(v => typeof v === 'string') as string | undefined
        if (text?.trim()) await patchAgent($, id, a => ({ ...a, summary: text.trim().slice(0, 600) }))
      }
      const done = await next(e)
      if ('isError' in done && done.isError === true) {
        await patchAgent($, id, a => ({ ...a, recent: [...a.recent, { at, text: `${name} failed` }].slice(-6) }))
      }
      await settleWait($)
      return done
    }

    const tool = String(e.tool)
    // This mod's own dialogs ($.ui.ask) arrive as AskUserQuestion calls: not the lead's choice.
    if (tool === 'AskUserQuestion') return next(e)
    const path = 'file_path' in e && typeof e.file_path === 'string' ? e.file_path : ''
    const base = path.split('/').pop() ?? ''
    if (base) {
      const at = files.indexOf(base)
      if (at >= 0) files.splice(at, 1)
      files.push(base)
      if (files.length > 8) files.shift()
    }
    // Did the lead's read follow the last hint?
    if (pendingHint && tool === 'Read' && base) {
      const isFollowed = base === pendingHint
      pendingHint = null
      await update($, jev, j => ({ ...j, hintsChecked: j.hintsChecked + 1, hintsFollowed: j.hintsFollowed + (isFollowed ? 1 : 0) }))
    }
    const isRoutable = routing === 'active' && ROUTABLE.has(tool)
    const questions: JevAsk['questions'] = { 'which tool': toolQuestion() }
    const fq = base && !isRoutable ? fileQuestion(files) : null
    if (fq) questions['which file'] = fq
    // Asked with the history before this call, so 'which tool' predicts this very call.
    observeJev($, { history: [...history], questions }, tool)
    history.push(`${tool} ${base}`.trim())
    if (history.length > 12) history.shift()

    // A permission dialog, when there is one, is shown inside this call.
    const ran = await next(e)
    await settleWait($)
    if (tool === 'Agent' && 'result' in ran) await recordAgentResult($, e.tool_use_id, ran.result)
    const isError = 'isError' in ran && ran.isError === true
    await update($, mode, m => ({ ...m, recentErrors: isError ? m.recentErrors + 1 : 0 }))
    // Active routing: only a call the engine itself marked read-only, never a denied one.
    if (isRoutable && !('deny' in ran && ran.deny) && ran.isReadOnly === true) {
      if (isError) return routeRetry($, tool, typeof ran.text === 'string' ? ran.text : '', () => next(e), ran)
      if (tool === 'Read' && path) return routeHint($, path, base, ran)
      return ran
    }
    if (isError) {
      observeJev($, { history: [...history, `FAILED ${tool}`], questions: { 'retry or stop': retryQuestion() } }, null)
    }
    return ran
  }).catch(($, e, next) => next(e)) // an observer never holds up the engine

  // ---- drawing (terminal only: other surfaces keep their own look) --------
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    // Select exists on the terminal's table; elsewhere settings read as text.
    const el = { Box, Text, Button, Select: 'Select' in els ? els.Select : undefined }
    const s = await snapshot($)
    const width = e.props.bodyColumns
    // Presses come from the person while the pane holds the focus.
    const act: Actions = {
      isFocused: e.props.isFocused,
      inspect: id => void update($, view, () => ({ kind: 'agent' as const, ref: id })),
      back: () => void update($, view, () => ({ kind: 'diagram' as const, ref: null })),
      set: (key, value) => void settingsCommand($, `${key} ${value}`),
    }
    const layout = e.surface === 'terminal' ? resolveLayout(s.prefs, width, e.props.placement) : 'list'
    if (layout === 'list') return <PaneList el={el} s={s} />
    if (layout === 'full') return <PaneFull el={el} s={s} width={width} act={act} />
    return <PaneCompact el={el} s={s} width={width} act={act} />
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey || e.props.view.agentId || e.props.maxRows < 2) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const s = await snapshot($)
    const rows = Math.max(0, Math.min(s.prefs.logRows, e.props.maxRows - 4))
    return <Band el={{ Box, Text }} s={s} width={e.props.bodyColumns} rows={rows} />
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const s = await snapshot($)
    const isAgent = s.agents.some(a => a.id === e.requestId)
    const word = e.props.message ?? e.props.word
    return <SpinnerLine el={{ Box, Text }} s={s} word={word} suffix={e.props.suffix} isAgent={isAgent} />
  })
}

function who(type: string): LogRow['who'] {
  const r = role(type)
  return r === 'search' || r === 'grep' || r === 'audit' ? r : 'haiku'
}
