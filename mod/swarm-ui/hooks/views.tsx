import type { Advisor, Fx, Jev, JevDecision, Lead, LogRow, Mode, SwarmAgent } from '../types'
import { C, SPIN, bar, clock, compact, elapsed, modelLabel, pad, role } from './format'
import { JEV } from './jev'
import { MODES, family, launchedMode } from './modes'

// The elements come from the surface's table ($.ui.resolve(e)); views take
// them as an argument so they stay plain functions of the state.
type El = { Box: any; Text: any }

export type Snapshot = {
  lead: Lead
  advisor: Advisor
  agents: SwarmAgent[]
  jev: Jev
  log: LogRow[]
  mode: Mode
  fx: Fx[]
  reduceMotion: boolean
  tick: number
  now: number
}

const ADVISOR_W = 26
const QUESTIONS = ['which file', 'which tool', 'retry or stop']
/** A log row stays highlighted this long after it is written. */
export const FRESH_MS = 2000
const WHO_COLOR: Record<LogRow['who'], string> = {
  jev: C.green,
  advisor: C.purple,
  lead: C.orange,
  search: C.blue,
  grep: C.blue,
  audit: C.blue,
  haiku: C.blue,
  mode: C.amber,
}
const ICON: Record<LogRow['kind'], string> = {
  start: '▸',
  done: '✓',
  error: '✗',
  advisor: '◆',
  mode: '⇄',
  jev: '◇',
  info: '·',
}
const ICON_COLOR: Record<LogRow['kind'], string> = {
  start: C.blue,
  done: C.green,
  error: C.red,
  advisor: C.purple,
  mode: C.amber,
  jev: C.green,
  info: C.dim,
}

// ---- effects: every one is started by a real event and ends on its own ----
/** How far through its effect `kind` (for `ref`) is, 0..1; null when none runs. */
export function phase(s: Snapshot, kind: Fx['kind'], ref?: string): number | null {
  for (let i = s.fx.length - 1; i >= 0; i--) {
    const f = s.fx[i]!
    if (f.kind !== kind || (ref !== undefined && f.ref !== ref)) continue
    const p = (s.now - f.at) / f.ms
    if (p >= 0 && p < 1) return p
  }
  return null
}

/** Something on screen changes with time: the timer runs only while this holds. */
export function isAnimating(s: Snapshot): boolean {
  return (
    isWorking(s) ||
    s.agents.some(a => a.status === 'running') ||
    s.fx.some(f => s.now - f.at < f.ms) ||
    s.log.some(r => s.now - r.at < FRESH_MS)
  )
}

function isWorking(s: Snapshot): boolean {
  return s.lead.turnStartedAt !== null && !s.lead.isWaiting
}

/** Two quick beats a second, while the lead works. */
function isBeat(s: Snapshot): boolean {
  if (s.reduceMotion || !isWorking(s)) return false
  const t = s.now % 1000
  return t < 140 || (t >= 260 && t < 400)
}

/** Alternate every 200 ms while `p` runs; held steady under reduced motion. */
function isLit(s: Snapshot, p: number | null): boolean {
  if (p === null) return false
  return s.reduceMotion || Math.floor((s.now % 400) / 200) === 0
}

function spin(s: Snapshot): string {
  return s.reduceMotion ? '●' : SPIN[Math.floor(s.now / 125) % SPIN.length]!
}

function haikuModel(s: Snapshot): string {
  const one = s.agents.find(a => a.model)
  return one ? modelLabel(one.model) : 'haiku'
}

/** The advisor the session runs with, as settings and --settings say. */
function advisorLabel(s: Snapshot): string {
  return s.mode.sessionAdvisor ? modelLabel(s.mode.sessionAdvisor) : 'off'
}

function modeName(s: Snapshot): string {
  const id = s.mode.selected ?? launchedMode(s.mode.sessionModel, s.mode.sessionAdvisor)
  return id ? MODES[id].label : 'custom'
}

/** A dotted track; `dots` are positions 0..1 drawn bright in `color`. */
function Track({ el, width, dots, color }: { el: El; width: number; dots: number[]; color: string }) {
  const { Text } = el
  const w = Math.max(0, width)
  const at = new Set(dots.map(d => Math.max(0, Math.min(w - 1, Math.round(d * (w - 1))))))
  const parts: any[] = []
  let run = ''
  for (let i = 0; i < w; i++) {
    if (at.has(i)) {
      if (run) parts.push(<Text color={C.dim}>{run}</Text>)
      run = ''
      parts.push(<Text color={color} bold>●</Text>)
    } else run += '·'
  }
  if (run) parts.push(<Text color={C.dim}>{run}</Text>)
  return <Text>{parts}</Text>
}

function Header({ el, s, width }: { el: El; s: Snapshot; width: number }) {
  const { Box, Text } = el
  const lead = modelLabel(s.lead.model).toUpperCase()
  const haiku = haikuModel(s).toUpperCase()
  return (
    <Box flexDirection="column" width={width}>
      <Box justifyContent="center">
        <Text bold color={C.fg}>CLAUDE CODE SWARM</Text>
        <Text color={C.dim}> · </Text>
        <Text bold color={C.orange}>{lead}</Text>
        <Text bold color={C.fg}> BUILDS</Text>
        <Text color={C.dim}> · </Text>
        <Text bold color={C.blue}>{haiku}</Text>
        <Text bold color={C.fg}> SWARMS</Text>
      </Box>
      <Text color={C.dim}>{'═'.repeat(width)}</Text>
      <Box justifyContent="space-around">
        <Text><Text color={C.orange}>■</Text><Text color={C.fg}> {modelLabel(s.lead.model)} · lead</Text></Text>
        <Text><Text color={C.blue}>■</Text><Text color={C.fg}> {haikuModel(s)} · swarm</Text></Text>
        <Text><Text color={C.green}>■</Text><Text color={C.fg}> jev · forks</Text></Text>
        <Text><Text color={C.purple}>■</Text><Text color={C.fg}> {advisorLabel(s)} · advisor</Text></Text>
        <Text><Text color={C.amber}>◈</Text><Text color={C.fg}> {modeName(s)}</Text></Text>
      </Box>
    </Box>
  )
}

function AdvisorColumn({ el, s }: { el: El; s: Snapshot }) {
  const { Box, Text } = el
  const a = s.advisor
  const p = phase(s, 'advisor')
  const line = (t: string) => <Text color={C.dim}>┆ <Text color={C.fg}>{t}</Text></Text>
  return (
    <Box
      flexDirection="column"
      width={ADVISOR_W}
      borderStyle={p === null ? 'single' : 'double'}
      borderColor={isLit(s, p) ? C.purpleHi : C.purple}
      paddingX={1}
    >
      <Box justifyContent="center"><Text bold color={p === null ? C.purple : C.purpleHi}>{advisorLabel(s).toUpperCase()}</Text></Box>
      <Box justifyContent="center"><Text color={C.purple}>advisor · {p === null ? 'on call' : 'advising'}</Text></Box>
      <Text color={C.purple}>◇ <Text color={C.fg}>before a plan</Text></Text>
      {line('reads the whole')}
      {line('session, every')}
      {line('tool call and')}
      {line('every result')}
      <Text color={C.dim}>┆</Text>
      {line('last advice:')}
      <Text color={C.dim}>┆   <Text color={C.fg}>{a.lastAt === null ? 'N/A' : `${elapsed(s.now - a.lastAt)} ago`}</Text></Text>
      <Text color={C.dim}>┆</Text>
      <Text color={C.dim}>┆ <Text color={C.fg}>{pad('calls', 15)}</Text><Text color={C.purple}>{a.calls}</Text></Text>
      {line('context read')}
      <Text color={C.dim}>┆   <Text color={C.purple}>{compact(a.contextAtCall)}</Text></Text>
      <Text color={C.dim}>┆</Text>
      {line('silent on every')}
      {line('routine turn')}
      <Text color={C.dim}>┆</Text>
      {p !== null ? (
        <Text backgroundColor={C.purpleBg} color={C.purpleHi} bold>
          {pad(`◆ advice in ${a.lastMs === null ? '' : elapsed(a.lastMs)}`, ADVISOR_W - 4)}
        </Text>
      ) : (
        <Text color={C.dim}>┆</Text>
      )}
      <Text color={C.dim}>┆</Text>
      {line('never writes')}
      {line('code itself.')}
      {line(`${family(s.lead.model) ?? 'the lead'} applies`)}
      {line('the advice.')}
      <Text color={C.dim}>┆</Text>
      <Text color={C.purple}>◇ <Text color={C.fg}>before done</Text></Text>
    </Box>
  )
}

/** The lead's link to the advisor: a pulse out to it and back when it is consulted. */
function AdvisorLink({ el, s, width }: { el: El; s: Snapshot; width: number }) {
  const { Box, Text } = el
  const p = phase(s, 'advisor')
  const track = Math.max(4, width - 22)
  let dots: number[] = []
  if (p !== null) {
    // Out to the advisor (right to left) in the first half, back in the second.
    const x = p < 0.5 ? 1 - p * 2 : (p - 0.5) * 2
    dots = s.reduceMotion ? [0, 1] : [x]
  }
  return (
    <Box width={width}>
      <Text color={p === null ? C.dim : C.purple}>◂ advisor </Text>
      <Track el={el} width={track} dots={dots} color={C.purpleHi} />
      <Text color={p === null ? C.dim : C.orange}> lead ▸</Text>
    </Box>
  )
}

function LeadBox({ el, s }: { el: El; s: Snapshot }) {
  const { Box, Text } = el
  const effort = s.lead.effort ?? 'N/A'
  const level = ['low', 'medium', 'high', 'xhigh', 'max'].indexOf(effort) + 1
  const beat = isBeat(s)
  const asked = s.lead.requested
  const isFallback = asked !== null && s.lead.model !== null && family(asked) !== family(s.lead.model)
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={beat ? C.orangeHi : C.orange} paddingX={1}>
      <Text color={C.orange} bold>{modelLabel(s.lead.model)} · main session</Text>
      <Box justifyContent="center"><Text color={C.fg}>edits + runs tests</Text></Box>
      <Text>
        <Text color={C.fg}>effort </Text>
        <Text color={C.orange}>{'▮'.repeat(Math.max(0, level))}</Text>
        <Text color={C.dim}>{'▯'.repeat(Math.max(0, 5 - level))}</Text>
        <Text color={C.orange}> {effort}</Text>
      </Text>
      {isFallback && <Text color={C.amber}>asked {modelLabel(asked)} · answered by {modelLabel(s.lead.model)}</Text>}
      {s.mode.relaunch && <Text color={C.amber}>advisor change waits for a relaunch</Text>}
      <Box justifyContent="center">
        {s.lead.turnStartedAt === null ? (
          <Text color={C.dim}>idle · ctx {compact(s.lead.contextTokens)} · {s.lead.steps} steps</Text>
        ) : s.lead.isWaiting ? (
          <Text color={C.amber}>◌ waiting for you<Text color={C.dim}> · ctx {compact(s.lead.contextTokens)}</Text></Text>
        ) : (
          <Text color={beat ? C.orangeHi : C.orange}>
            {beat ? '●' : s.reduceMotion ? '●' : '○'} working {elapsed(s.now - s.lead.turnStartedAt)}
            <Text color={C.dim}> · ctx {compact(s.lead.contextTokens)}</Text>
          </Text>
        )}
      </Box>
    </Box>
  )
}

function JevRow({ el, s, q, d, width }: { el: El; s: Snapshot; q: string; d: JevDecision | undefined; width: number }) {
  const { Text } = el
  if (!d) {
    return <Text><Text color={C.fg}>{pad(q, 14)}</Text><Text color={C.dim}>{'░'.repeat(width)}  N/A</Text></Text>
  }
  // A new answer fills its bar from empty to its probability.
  const p = phase(s, 'jev', q)
  const grown = p === null || s.reduceMotion ? 1 : Math.min(1, p * 1.6)
  const [full, rest] = bar(d.p * grown, width)
  const tone = d.isSharp ? C.green : C.orange
  return (
    <Text>
      <Text color={C.fg}>{pad(q, 14)}</Text>
      <Text color={tone} bold={p !== null}>{full}</Text>
      <Text color={C.dim}>{rest}</Text>
      <Text color={tone}>  {d.p.toFixed(2)} {d.isSharp ? 'sharp' : 'split'}</Text>
      <Text color={C.dim}> {pad(d.choice, 8)}{d.confidence === null ? '' : ` c${d.confidence.toFixed(2)}`}</Text>
    </Text>
  )
}

function JevBox({ el, s, width }: { el: El; s: Snapshot; width: number }) {
  const { Box, Text } = el
  const j = s.jev
  const barW = Math.max(4, Math.min(12, width - 46))
  const isOff = j.status === 'off'
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={isOff ? C.dim : C.green} paddingX={1} width={width}>
      <Box justifyContent="space-between">
        <Text><Text bold color={isOff ? C.dim : C.green}>JEV</Text><Text color={isOff ? C.dim : C.green}> · fork layer</Text></Text>
        <Text>
          <Text color={C.dim}>decisions </Text>
          <Text bold color={C.fg}>{isOff ? 'off' : j.decisions.toLocaleString('en-US')}</Text>
        </Text>
      </Box>
      {QUESTIONS.map(q => (
        <JevRow el={el} s={s} q={q} d={j.last.find(d => d.question === q)} width={barW} />
      ))}
      {j.status === 'on' ? (
        <Text color={C.dim}>
          sharp ≥ {JEV.threshold} · tool agreed {j.toolAgreed}/{j.toolChecked} · ${j.spentUsd.toFixed(4)} · observe-only
        </Text>
      ) : (
        <Text color={C.dim}>jev {j.status} · {j.reason ?? 'N/A'}</Text>
      )}
    </Box>
  )
}

function AgentBox({ el, a, s, width, slot }: { el: El; a: SwarmAgent | undefined; s: Snapshot; width: number; slot: string }) {
  const { Box, Text } = el
  if (!a) {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor={C.blue} borderDimColor paddingX={1} width={width}>
        <Box justifyContent="center"><Text bold color={C.dim}>{slot}</Text></Box>
        <Box justifyContent="center"><Text color={C.dim}>idle</Text></Box>
        <Text> </Text>
        <Text> </Text>
      </Box>
    )
  }
  const inner = width - 4
  const barW = Math.max(3, inner - 8)
  const isRunning = a.status === 'running'
  const ratio = a.maxTurns ? a.steps / a.maxTurns : null
  const [full, rest] = ratio === null ? ['', ''] : bar(ratio, barW)
  const born = phase(s, 'spawn', a.id)
  const ended = phase(s, 'done', a.id)
  const border = ended !== null ? (isLit(s, ended) ? C.greenHi : C.green) : born !== null && isLit(s, born) ? C.blueHi : C.blue
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={border} paddingX={1} width={width}>
      <Box justifyContent="center"><Text bold color={C.fg}>{role(a.type)}</Text></Box>
      <Box justifyContent="center"><Text color={C.blue}>{modelLabel(a.model)}</Text></Box>
      {ratio === null ? (
        <Box justifyContent="center"><Text color={C.dim}>{a.steps} turns · {a.tools} tools</Text></Box>
      ) : (
        <Text>
          <Text color={C.blue}>{full}</Text>
          <Text color={C.dim}>{rest}</Text>
          <Text color={C.fg}> {a.steps}/{a.maxTurns}</Text>
        </Text>
      )}
      <Box justifyContent="center">
        <Text color={C.fg}>{pad(a.isWorktree ? 'runs in a worktree' : a.description || (a.lastTool ?? ''), inner).trimEnd()}</Text>
      </Box>
      <Box justifyContent="center">
        {isRunning ? (
          <Text color={C.blue}>{spin(s)} running {elapsed(s.now - a.startedAt)}</Text>
        ) : (
          <Text color={ended !== null ? C.greenHi : C.green} bold={ended !== null}>✓ done {elapsed((a.endedAt ?? s.now) - a.startedAt)}</Text>
        )}
      </Box>
    </Box>
  )
}

/** The three boxes shown: running agents first, then the most recent. */
export function pickAgents(list: SwarmAgent[]): SwarmAgent[] {
  const running = list.filter(a => a.status === 'running')
  const done = list.filter(a => a.status !== 'running').reverse()
  return [...running, ...done].slice(0, 3)
}

/** Where box `i` of three sits along a track, 0..1. */
const SLOT_X = [0, 0.5, 1]

function Diagram({ el, s, width }: { el: El; s: Snapshot; width: number }) {
  const { Box, Text } = el
  const shown = pickAgents(s.agents)
  const slots = ['search', 'grep', 'audit']
  const boxW = Math.floor((width - 2) / 3)
  const branch = boxW * 3 + 2
  const third = Math.floor(branch / 6)
  const trackW = branch - third * 2 - 1
  const running = s.agents.filter(a => a.status === 'running').length

  // Out: particles fly from the middle to each box just spawned. Back: a pulse
  // from each box just finished to the middle. Otherwise one dot circulates
  // while subagents run.
  const out: number[] = []
  const back: number[] = []
  shown.forEach((a, i) => {
    const to = SLOT_X[i]!
    const born = phase(s, 'spawn', a.id)
    if (born !== null) {
      for (const lag of s.reduceMotion ? [1] : [0, 0.12, 0.24]) {
        const t = Math.max(0, Math.min(1, born * 1.4 - lag))
        out.push(0.5 + (to - 0.5) * t)
      }
    }
    const ended = phase(s, 'done', a.id)
    if (ended !== null) back.push(s.reduceMotion ? 0.5 : to + (0.5 - to) * Math.min(1, ended * 1.4))
  })
  if (out.length === 0 && running > 0 && !s.reduceMotion) out.push((Math.floor(s.now / 125) % trackW) / Math.max(1, trackW - 1))

  return (
    <Box flexDirection="column" width={width}>
      <AdvisorLink el={el} s={s} width={width} />
      <Box justifyContent="center" width={width}>
        <Box width={Math.min(width, 46)} flexDirection="column"><LeadBox el={el} s={s} /></Box>
      </Box>
      <Box justifyContent="center"><Text color={C.orange}>┆</Text></Box>
      <Box justifyContent="center"><JevBox el={el} s={s} width={Math.min(width, 66)} /></Box>
      <Box justifyContent="center"><Text color={C.blue}>●</Text></Box>
      <Box justifyContent="center">
        <Text color={C.fg}>delegate to subagents · </Text>
        <Text bold color={C.blue}>{haikuModel(s)}</Text>
        {running > 0 ? <Text color={C.dim}> · {running} running</Text> : <Text> </Text>}
      </Box>
      <Box>
        <Text color={C.dim}>{' '.repeat(Math.max(0, third - 1))}╭</Text>
        <Track el={el} width={trackW} dots={out} color={C.blueHi} />
        <Text color={C.dim}>╮</Text>
      </Box>
      <Box gap={1}>
        {[0, 1, 2].map(i => (
          <AgentBox el={el} a={shown[i]} s={s} width={boxW} slot={slots[i] ?? 'agent'} />
        ))}
      </Box>
      <Box>
        <Text color={C.dim}>{' '.repeat(Math.max(0, third - 1))}╰</Text>
        <Track el={el} width={trackW} dots={back} color={C.greenHi} />
        <Text color={C.dim}>╯</Text>
      </Box>
      <Box justifyContent="center">
        <Box flexDirection="column" borderStyle="single" borderColor={back.length ? C.greenHi : C.orange} paddingX={2}>
          <Text color={C.orange} bold>back to {modelLabel(s.lead.model)} · lead</Text>
          <Box justifyContent="center"><Text color={C.fg}>review + verify</Text></Box>
        </Box>
      </Box>
    </Box>
  )
}

/** The full reference layout: advisor column left, the flow right. */
export function PaneFull({ el, s, width }: { el: El; s: Snapshot; width: number }) {
  const { Box } = el
  const right = width - ADVISOR_W - 2
  return (
    <Box flexDirection="column" width={width}>
      <Header el={el} s={s} width={width} />
      <Box gap={2} marginTop={1}>
        <AdvisorColumn el={el} s={s} />
        <Diagram el={el} s={s} width={right} />
      </Box>
    </Box>
  )
}

/** Narrower docks: the same boxes stacked, advisor as a one-line strip. */
export function PaneCompact({ el, s, width }: { el: El; s: Snapshot; width: number }) {
  const { Box, Text } = el
  const a = s.advisor
  const p = phase(s, 'advisor')
  return (
    <Box flexDirection="column" width={width}>
      <Header el={el} s={s} width={width} />
      <Box borderStyle={p === null ? 'single' : 'double'} borderColor={isLit(s, p) ? C.purpleHi : C.purple} paddingX={1} marginTop={1}>
        <Text>
          <Text bold color={C.purple}>{advisorLabel(s)} advisor</Text>
          <Text color={C.fg}> · calls {a.calls} · </Text>
          {p === null ? (
            <Text color={C.fg}>last {a.lastAt === null ? 'N/A' : `${elapsed(s.now - a.lastAt)} ago`}</Text>
          ) : (
            <Text backgroundColor={C.purpleBg} color={C.purpleHi} bold>◆ advice in</Text>
          )}
        </Text>
      </Box>
      <LeadBox el={el} s={s} />
      <JevBox el={el} s={s} width={width} />
      {pickAgents(s.agents).map(agent => (
        <AgentBox el={el} a={agent} s={s} width={width} slot="agent" />
      ))}
      {s.agents.length === 0 && <Text color={C.dim}>no subagents yet</Text>}
    </Box>
  )
}

/** One line per agent, for an inline pane or a very narrow dock. */
export function PaneList({ el, s }: { el: El; s: Snapshot }) {
  const { Box, Text } = el
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={C.orange}>■ {modelLabel(s.lead.model)}</Text>
        <Text color={C.dim}> · ctx {compact(s.lead.contextTokens)} </Text>
        <Text color={C.purple}>■ advisor {s.advisor.calls}</Text>
        <Text color={C.dim}> </Text>
        <Text color={C.green}>■ jev {s.jev.status === 'on' ? s.jev.decisions : s.jev.status}</Text>
        <Text color={C.amber}> ◈ {modeName(s)}</Text>
      </Text>
      {pickAgents(s.agents).map(a => (
        <Text>
          <Text color={C.blue}>{a.status === 'running' ? spin(s) : '✓'} {pad(role(a.type), 8)}</Text>
          <Text color={C.fg}> {a.steps}{a.maxTurns ? `/${a.maxTurns}` : ''} turns · {a.tools} tools</Text>
        </Text>
      ))}
    </Box>
  )
}

export function StatusRow({ el, s }: { el: El; s: Snapshot }) {
  const { Text } = el
  const running = s.agents.filter(a => a.status === 'running').length
  const advising = phase(s, 'advisor') !== null
  return (
    <Text>
      <Text color={C.fg}>haiku </Text>
      <Text color={C.blue}>[{running > 0 ? 'swarming' : 'idle'}]</Text>
      <Text color={C.fg}>   subagents </Text>
      <Text color={C.blue}>[{running}/{s.agents.length}]</Text>
      <Text color={C.fg}>   {advisorLabel(s).split(' ')[0]} </Text>
      <Text color={advising ? C.purpleHi : C.purple} bold={advising}>[{advising ? 'advising' : `on call · ${s.advisor.calls}`}]</Text>
      <Text color={C.fg}>   jev </Text>
      <Text color={s.jev.status === 'off' ? C.dim : C.green}>[ {s.jev.status === 'on' ? `${s.jev.decisions.toLocaleString('en-US')} decisions` : s.jev.status} ]</Text>
      <Text color={C.fg}>   mode </Text>
      <Text color={C.amber}>[{modeName(s)}]</Text>
    </Text>
  )
}

export function Band({ el, s, width, rows }: { el: El; s: Snapshot; width: number; rows: number }) {
  const { Box, Text } = el
  // slice(-0) would be the whole log: no room means no log rows.
  const shown = rows > 0 ? s.log.slice(-rows) : []
  return (
    <Box flexDirection="column" width={width}>
      {shown.length > 0 && (
        <Box flexDirection="column" borderStyle="single" borderColor={C.dim} paddingX={1}>
          <Text color={C.dim}>session log</Text>
          {shown.map(r => {
            const isFresh = s.now - r.at < FRESH_MS
            return (
              <Text backgroundColor={isFresh ? C.freshBg : undefined}>
                <Text color={C.dim}>{clock(r.at)} </Text>
                <Text color={ICON_COLOR[r.kind]} bold>{ICON[r.kind]} </Text>
                <Text bold color={WHO_COLOR[r.who]}>{pad(r.who, 8)}</Text>
                <Text color={C.fg} bold={isFresh}>{pad(r.text, Math.max(10, Math.floor((width - 26) * 0.55)))}</Text>
                <Text color={C.dim}>{r.detail}</Text>
              </Text>
            )
          })}
        </Box>
      )}
      <StatusRow el={el} s={s} />
    </Box>
  )
}

export function SpinnerLine({ el, s, word, suffix, isAgent }: { el: El; s: Snapshot; word: string; suffix: string; isAgent: boolean }) {
  const { Text } = el
  const tone = isAgent ? C.blue : isBeat(s) ? C.orangeHi : C.orange
  const started = s.lead.turnStartedAt
  return (
    <Text>
      <Text color={tone}>{spin(s)} </Text>
      <Text color={tone} bold>{word}{suffix}</Text>
      <Text color={C.dim}>
        {' '}({isAgent ? 'haiku · swarm' : `${modelLabel(s.lead.model)} · lead`}
        {started === null ? '' : ` · ${elapsed(s.now - started)}`}
        {isAgent || s.lead.turnOutputTokens === 0 ? '' : ` · ↓ ${compact(s.lead.turnOutputTokens)} tokens`} · esc to interrupt)
      </Text>
    </Text>
  )
}
