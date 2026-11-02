import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, Timer } from 'claude-code'

import type { Advisor, Fx, Jev, Lead, LogRow, Mode, ModeId, SwarmAgent } from '../types'
import { C, compact, elapsed, modelLabel, role } from './format'
import { Gate, askJev, fileQuestion, retryQuestion, toolQuestion } from './jev'
import type { JevAsk } from './jev'
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
import { Band, PaneCompact, PaneFull, PaneList, SpinnerLine, isAnimating } from './views'
import type { Snapshot } from './views'

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
  { calls: 0, lastAt: null, lastMs: null, contextAtCall: null } as Advisor,
  { shape: 'advisor-1' },
)

export const agents = atom(
  { plugin: 'swarm-ui', key: 'agents' } as const,
  [] as SwarmAgent[],
  { shape: 'agents-1' },
)

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
  } as Jev,
  { shape: 'jev-2' },
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
// Below this many body columns the full reference layout cannot fit.
const FULL_MIN = 84
const COMPACT_MIN = 40
/** 10 frames a second while an effect plays; 1 under reduced motion (counters only). */
const FRAME_MS = 100
const STILL_MS = 1000
const KEYCHAIN_SERVICE = 'claude-swarm-typesafe'
const MS = { advisor: 2400, spawn: 1600, done: 1600, jev: 900, mode: 1600 }

// Module variables start over on a reload; everything drawn lives in $.state.
let opts: PluginOptions = {}
let timer: Timer | null = null
let timerMs = 0
let isReduced = false
let cwd = ''
let home = ''
let sessionId = ''
let jevKey: string | undefined
let hasWarnedPairing = false
const gate = new Gate()
const history: string[] = []
const files: string[] = []

async function addLog($: EngineInterface, row: Omit<LogRow, 'at'>) {
  const at = await $.clock.now()
  await update($, log, rows => [...rows, { ...row, at }].slice(-LOG_KEEP))
  animate($)
}

/** Starts an effect that a real event caused; it ends by itself after its time. */
async function addFx($: EngineInterface, kind: Fx['kind'], ref: string | null) {
  const at = await $.clock.now()
  await update($, fx, list => [...list.filter(f => at - f.at < f.ms), { kind, at, ms: MS[kind], ref }].slice(-24))
  animate($)
}

// One timer, only while something on screen changes with time; none when idle.
function animate($: EngineInterface) {
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
  const [l, a, list, j, rows, m, f, r, t, now] = await Promise.all([
    read($, lead),
    read($, advisor),
    read($, agents),
    read($, jev),
    read($, log),
    read($, mode),
    read($, fx),
    read($, reduceMotion),
    read($, tick),
    $.clock.now(),
  ])
  return { lead: l, advisor: a, agents: list, jev: j, log: rows, mode: m, fx: f, reduceMotion: r, tick: t, now }
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

/** The plugin's `motion` option, else the native reduceMotion setting. */
async function prefersStill($: EngineInterface): Promise<boolean> {
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
  if (!jevKey) return
  const key = jevKey
  void (async () => {
    const now = await $.clock.now()
    const blocked = gate.allow(now)
    if (blocked) {
      await markJev($, blocked)
      return
    }
    const out = await askJev($, key, ask, now)
    if (!out.ok) {
      gate.fail(now)
      await markJev($, out.reason)
      return
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
    for (const d of out.decisions) {
      await addFx($, 'jev', d.question)
      await addLog($, {
        who: 'jev',
        kind: 'jev',
        text: `${d.question}  → ${d.choice}`,
        detail: `p=${d.p.toFixed(2)}${d.confidence === null ? '' : ` c=${d.confidence.toFixed(2)}`}  ${d.isSharp ? 'sharp' : 'split'}`,
      })
    }
  })()
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
    `Escalation: ${opts.escalation === 'off' ? 'off' : 'asks first'} · Haiku checks ${m.classified}/${CLASSIFY_CAP}`,
    `Jev: ${j.status}${j.reason ? ` (${j.reason})` : ''} · ${j.calls} calls · $${j.spentUsd.toFixed(4)} · observe-only`,
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
    if (jevKey) {
      if (j.status === 'off') await update($, jev, x => ({ ...x, status: 'on' as const, reason: null }))
    } else {
      await update($, jev, x => ({ ...x, status: 'off' as const, reason: 'no key: TYPESAFE_API_KEY or Keychain claude-swarm-typesafe' }))
    }
    await syncMotion($)

    await $.command.register({
      name: 'swarm',
      description: 'Show the Sonnet / Haiku swarm / Opus advisor / Jev pane',
    })
    await $.command.register({
      name: 'swarm-mode',
      description: 'View or change the model mode for this session: balanced, deep, max, default, status',
    })
    // Unasked, the engine seats it only on a wide terminal; /swarm opens it anywhere.
    void $.ui.open(PANE_OPEN)

    return next(e)
  })

  on('command.run', { command: 'swarm' }, async $ => {
    const opened = await $.ui.open(PANE_OPEN)
    return { text: opened.isPlaced ? 'Swarm pane opened.' : `Swarm pane waits: ${opened.reason}` }
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

  // ---- prompts: offer a stronger mode, never switch without a yes ----------
  on('prompt.submit', async ($, e, next) => {
    const isTyped = !e.command && !e.isMeta && !e.turnId && e.origin.kind === 'composer'
    if (isTyped && opts.escalation !== 'off') await escalate($, e.text)
    return next(e)
  }).catch(($, e, next) => next(e)) // a failed check never holds up the prompt

  // ---- turns: the lead's and every subagent's model requests -------------
  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
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
    if (!e.agentId) await update($, lead, l => ({ ...l, turnStartedAt: null, isWaiting: false }))
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId) {
      const result = yield* next(e)
      const id = e.agentId
      const model = result.usage?.model
      await update($, agents, list => list.map(a => (a.id === id ? { ...a, steps: a.steps + 1, model: model ?? a.model } : a)))
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
    const usage = result.usage

    const context = usage
      ? usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens + usage.output_tokens
      : null
    await update($, lead, l => ({
      ...l,
      model: usage?.model ?? l.model,
      requested: req.model,
      effort: typeof req.effort === 'string' ? req.effort : req.effort === undefined ? l.effort : String(req.effort),
      steps: l.steps + 1,
      outputTokens: l.outputTokens + (usage?.output_tokens ?? 0),
      turnOutputTokens: l.turnOutputTokens + (usage?.output_tokens ?? 0),
      // isWaiting is left alone: tools start while a step still streams, so a
      // dialog may already be up. It clears when its call settles.
      contextTokens: context ?? l.contextTokens,
    }))

    // The API runs the advisor inside the request and reports it only here, so
    // its pulse plays when the step ends, not while the advisor thinks.
    for (const use of result.serverToolUses ?? []) {
      if (use.name !== 'advisor') continue
      const ms = use.endedAt === undefined ? null : use.endedAt - use.startedAt
      const before = (await read($, lead)).contextTokens
      await update($, advisor, a => ({ calls: a.calls + 1, lastAt: use.startedAt, lastMs: ms, contextAtCall: before }))
      await addFx($, 'advisor', use.id)
      await addLog($, {
        who: 'advisor',
        kind: 'advisor',
        text: `${family(m.sessionAdvisor) ?? 'advisor'} consulted · read the full session`,
        detail: `${compact(before)} ctx${ms === null ? '' : ` · ${elapsed(ms)}`}`,
      })
    }
    return result
  })

  // ---- subagents ----------------------------------------------------------
  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (!spawned.agentId) return spawned

    const def = await definition($, e.subagentType)
    const agent: SwarmAgent = {
      id: spawned.agentId,
      type: e.subagentType,
      description: e.description,
      model: spawned.model,
      status: 'running',
      steps: 0,
      maxTurns: def.maxTurns,
      tools: 0,
      lastTool: null,
      isWorktree: def.isWorktree,
      startedAt: await $.clock.now(),
      endedAt: null,
    }
    await update($, agents, list => [...list.filter(a => a.id !== agent.id), agent].slice(-24))
    await addFx($, 'spawn', agent.id)
    await addLog($, { who: who(agent.type), kind: 'start', text: 'started', detail: e.description })
    return spawned
  }).catch(($, e, next) => next(e)) // an observer never holds up the engine

  on('classic.SubagentStop', async ($, e, next) => {
    const now = await $.clock.now()
    const list = await read($, agents)
    const agent = list.find(a => a.id === e.agent_id)
    if (agent && agent.status === 'running') {
      await update($, agents, all => all.map(a => (a.id === e.agent_id ? { ...a, status: 'done' as const, endedAt: now } : a)))
      await addFx($, 'done', agent.id)
      await addLog($, {
        who: who(agent.type),
        kind: 'done',
        text: `done in ${elapsed(now - agent.startedAt)}`,
        detail: `${agent.steps} turns · ${agent.tools} tools`,
      })
    }
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
      await update($, agents, list => list.map(a => (a.id === id ? { ...a, tools: a.tools + 1, lastTool: String(e.tool) } : a)))
      const done = await next(e)
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
    const questions: JevAsk['questions'] = { 'which tool': toolQuestion() }
    const fq = base ? fileQuestion(files) : null
    if (fq) questions['which file'] = fq
    // Asked with the history before this call, so 'which tool' predicts this very call.
    observeJev($, { history: [...history], questions }, tool)
    history.push(`${tool} ${base}`.trim())
    if (history.length > 12) history.shift()

    // A permission dialog, when there is one, is shown inside this call.
    const ran = await next(e)
    await settleWait($)
    const isError = 'isError' in ran && ran.isError === true
    await update($, mode, m => ({ ...m, recentErrors: isError ? m.recentErrors + 1 : 0 }))
    if (isError) {
      observeJev($, { history: [...history, `FAILED ${tool}`], questions: { 'retry or stop': retryQuestion() } }, null)
    }
    return ran
  }).catch(($, e, next) => next(e)) // an observer never holds up the engine

  // ---- drawing (terminal only: other surfaces keep their own look) --------
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const el = { Box, Text }
    const s = await snapshot($)
    const width = e.props.bodyColumns
    if (e.surface !== 'terminal' || e.props.placement === 'inline' || width < COMPACT_MIN) {
      return <PaneList el={el} s={s} />
    }
    if (width >= FULL_MIN) return <PaneFull el={el} s={s} width={width} />
    return <PaneCompact el={el} s={s} width={width} />
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey || e.props.view.agentId || e.props.maxRows < 2) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const s = await snapshot($)
    const rows = Math.min(4, e.props.maxRows - 4)
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
