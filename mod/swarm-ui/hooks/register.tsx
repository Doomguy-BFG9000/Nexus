import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Advisor, Jev, Lead, LogRow, SwarmAgent } from '../types'
import { C, compact, elapsed, role } from './format'
import { Gate, askJev, fileQuestion, retryQuestion, toolQuestion } from './jev'
import type { JevAsk } from './jev'
import { Band, PaneCompact, PaneFull, PaneList, SpinnerLine } from './views'
import type { Snapshot } from './views'

// Bump a shape tag whenever that value's fields change: values stored by an
// earlier version outlive a reload and are declined, not misread.
export const lead = atom(
  { plugin: 'swarm-ui', key: 'lead' } as const,
  {
    model: null,
    effort: null,
    steps: 0,
    outputTokens: 0,
    turnOutputTokens: 0,
    contextTokens: null,
    turnStartedAt: null,
  } as Lead,
  { shape: 'lead-1' },
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
  { status: 'off', reason: 'TYPESAFE_API_KEY not set', decisions: 0, last: [] } as Jev,
  { shape: 'jev-1' },
)

export const log = atom(
  { plugin: 'swarm-ui', key: 'log' } as const,
  [] as LogRow[],
  { shape: 'log-1' },
)

export const tick = atom({ plugin: 'swarm-ui', key: 'tick' } as const, 0)

export const LOG_KEEP = 50

const PANE = 'swarm'
const PANE_OPEN = { id: PANE, title: 'swarm', columns: 92, backgroundColor: C.bg }
// Below this many body columns the full reference layout cannot fit.
const FULL_MIN = 84
const COMPACT_MIN = 40

// Module variables start over on a reload; everything drawn lives in $.state.
let timer: Timer | null = null
let cwd = ''
let home = ''
let advisorModel: string | null = null
let jevKey: string | undefined
const gate = new Gate()
const history: string[] = []
const files: string[] = []

async function addLog($: EngineInterface, row: Omit<LogRow, 'at'>) {
  const at = await $.clock.now()
  await update($, log, rows => [...rows, { ...row, at }].slice(-LOG_KEEP))
}

async function isBusy($: EngineInterface): Promise<boolean> {
  const [l, list] = await Promise.all([read($, lead), read($, agents)])
  return l.turnStartedAt !== null || list.some(a => a.status === 'running')
}

// One timer, only while something runs: it moves the dots and spinners.
function animate($: EngineInterface) {
  if (timer) return
  timer = $.clock.every(400, () => {
    void (async () => {
      if (!(await isBusy($))) {
        timer?.cancel()
        timer = null
        await update($, tick, n => n + 1)
        return
      }
      await update($, tick, n => n + 1)
    })()
  })
}

async function snapshot($: EngineInterface): Promise<Snapshot> {
  const [l, a, list, j, rows, t, now] = await Promise.all([
    read($, lead),
    read($, advisor),
    read($, agents),
    read($, jev),
    read($, log),
    read($, tick),
    $.clock.now(),
  ])
  return { lead: l, advisor: a, agents: list, jev: j, log: rows, tick: t, now, advisorModel }
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

// ---- Jev: observation only, never awaited by the tool path --------------
function observeJev($: EngineInterface, ask: JevAsk) {
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
    await update($, jev, j => ({
      status: 'on' as const,
      reason: null,
      decisions: j.decisions + out.decisions.length,
      last: [...j.last.filter(d => !out.decisions.some(n => n.question === d.question)), ...out.decisions],
    }))
    for (const d of out.decisions) {
      await addLog($, {
        who: 'jev',
        text: `${d.question}  → ${d.choice}`,
        detail: `p=${d.p.toFixed(2)}  ${d.isSharp ? 'sharp' : 'split'}`,
      })
    }
  })()
}

/** A string setting: a key read answers the value itself, a test kit the settings object. */
async function setting($: EngineInterface, key: 'model' | 'advisorModel'): Promise<string | null> {
  try {
    const value = key === 'model' ? await $.settings.read({ key: 'model' }) : await $.settings.read({ key: 'advisorModel' })
    if (typeof value === 'string') return value
    const nested = (value as Record<string, unknown> | null)?.[key]
    return typeof nested === 'string' ? nested : null
  } catch {
    return null
  }
}

async function markJev($: EngineInterface, reason: string) {
  const was = await read($, jev)
  if (was.status === 'down' && was.reason === reason) return
  await update($, jev, j => ({ ...j, status: 'down' as const, reason }))
  await addLog($, { who: 'jev', text: 'unavailable', detail: reason })
}

export const register: Register = on => {
  // ---- session --------------------------------------------------------------
  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    home = (await $.env.get('HOME')) ?? ''
    jevKey = (await $.env.get('TYPESAFE_API_KEY')) || undefined
    advisorModel = await setting($, 'advisorModel')
    // Until the first response names the model, show the configured one.
    const configured = await setting($, 'model')
    if (configured) await update($, lead, l => ({ ...l, model: l.model ?? configured }))
    if (jevKey) await update($, jev, j => ({ ...j, status: 'on' as const, reason: null }))

    await $.command.register({
      name: 'swarm',
      description: 'Show the Sonnet / Haiku swarm / Opus advisor / Jev pane',
    })
    // Unasked, the engine seats it only on a wide terminal; /swarm opens it anywhere.
    void $.ui.open(PANE_OPEN)

    return next(e)
  })

  on('command.run', { command: 'swarm' }, async $ => {
    const opened = await $.ui.open(PANE_OPEN)
    return { text: opened.isPlaced ? 'Swarm pane opened.' : `Swarm pane waits: ${opened.reason}` }
  })

  // ---- turns: the lead's and every subagent's model requests -------------
  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      const now = await $.clock.now()
      await update($, lead, l => ({ ...l, turnStartedAt: now, turnOutputTokens: 0 }))
      animate($)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) await update($, lead, l => ({ ...l, turnStartedAt: null }))
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const usage = result.usage
    if (e.agentId) {
      const id = e.agentId
      await update($, agents, list =>
        list.map(a => (a.id === id ? { ...a, steps: a.steps + 1, model: usage?.model ?? a.model } : a)),
      )
      return result
    }

    const context = usage
      ? usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens + usage.output_tokens
      : null
    await update($, lead, l => ({
      ...l,
      model: usage?.model ?? e.model ?? l.model,
      effort: typeof e.effort === 'string' ? e.effort : e.effort === undefined ? l.effort : String(e.effort),
      steps: l.steps + 1,
      outputTokens: l.outputTokens + (usage?.output_tokens ?? 0),
      turnOutputTokens: l.turnOutputTokens + (usage?.output_tokens ?? 0),
      contextTokens: context ?? l.contextTokens,
    }))

    for (const use of result.serverToolUses ?? []) {
      if (use.name !== 'advisor') continue
      const ms = use.endedAt === undefined ? null : use.endedAt - use.startedAt
      const before = (await read($, lead)).contextTokens
      await update($, advisor, a => ({
        calls: a.calls + 1,
        lastAt: use.startedAt,
        lastMs: ms,
        contextAtCall: before,
      }))
      await addLog($, {
        who: 'opus',
        text: 'advisor consulted · reading full session',
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
    await addLog($, { who: who(agent.type), text: 'started', detail: e.description })
    animate($)
    return spawned
  }).catch(($, e, next) => next(e)) // an observer never holds up the engine

  on('classic.SubagentStop', async ($, e, next) => {
    const now = await $.clock.now()
    const list = await read($, agents)
    const agent = list.find(a => a.id === e.agent_id)
    if (agent && agent.status === 'running') {
      await update($, agents, all =>
        all.map(a => (a.id === e.agent_id ? { ...a, status: 'done' as const, endedAt: now } : a)),
      )
      await addLog($, {
        who: who(agent.type),
        text: `done in ${elapsed(now - agent.startedAt)}`,
        detail: `${agent.steps} turns · ${agent.tools} tools`,
      })
    }
    return next(e)
  }).catch(($, e, next) => next(e)) // an observer never holds up the engine

  // ---- tool calls: subagent activity, and what Jev observes of the lead ---
  on('tool.call', async ($, e, next) => {
    if (e.agentId) {
      const id = e.agentId
      await update($, agents, list =>
        list.map(a => (a.id === id ? { ...a, tools: a.tools + 1, lastTool: String(e.tool) } : a)),
      )
      return next(e)
    }

    const tool = String(e.tool)
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
    observeJev($, { history: [...history], questions })
    history.push(`${tool} ${base}`.trim())
    if (history.length > 12) history.shift()

    const ran = await next(e)
    if ('isError' in ran && ran.isError) {
      observeJev($, { history: [...history, `FAILED ${tool}`], questions: { 'retry or stop': retryQuestion() } })
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
