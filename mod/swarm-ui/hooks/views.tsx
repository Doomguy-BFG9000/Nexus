import type { Advisor, Jev, JevDecision, Lead, LogRow, SwarmAgent } from '../types'
import { C, SPIN, bar, clock, compact, elapsed, modelLabel, pad, role } from './format'
import { JEV } from './jev'

// The elements come from the surface's table ($.ui.resolve(e)); views take
// them as an argument so they stay plain functions of the state.
type El = { Box: any; Text: any }

export type Snapshot = {
  lead: Lead
  advisor: Advisor
  agents: SwarmAgent[]
  jev: Jev
  log: LogRow[]
  tick: number
  now: number
  advisorModel: string | null
}

const ADVISOR_W = 26
const QUESTIONS = ['which file', 'which tool', 'retry or stop']
const WHO_COLOR: Record<LogRow['who'], string> = {
  jev: C.green,
  opus: C.purple,
  sonnet: C.orange,
  search: C.blue,
  grep: C.blue,
  audit: C.blue,
  haiku: C.blue,
}

function haikuModel(s: Snapshot): string {
  const one = s.agents.find(a => a.model)
  return one ? modelLabel(one.model) : 'haiku'
}

function isBusy(s: Snapshot): boolean {
  return s.lead.turnStartedAt !== null || s.agents.some(a => a.status === 'running')
}

/** A dotted run with one bright dot travelling along it while work runs. */
function Flow({ el, width, s, color }: { el: El; width: number; s: Snapshot; color: string }) {
  const { Text } = el
  if (!isBusy(s) || width < 3) return <Text color={C.dim}>{'·'.repeat(Math.max(0, width))}</Text>
  const at = s.tick % width
  return (
    <Text>
      <Text color={C.dim}>{'·'.repeat(at)}</Text>
      <Text color={color} bold>●</Text>
      <Text color={C.dim}>{'·'.repeat(width - at - 1)}</Text>
    </Text>
  )
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
        <Text><Text color={C.purple}>■</Text><Text color={C.fg}> {modelLabel(s.advisorModel)} · advisor</Text></Text>
      </Box>
    </Box>
  )
}

function AdvisorColumn({ el, s }: { el: El; s: Snapshot }) {
  const { Box, Text } = el
  const a = s.advisor
  const isRecent = a.lastAt !== null && s.now - a.lastAt < 60_000
  const line = (t: string) => <Text color={C.dim}>┆ <Text color={C.fg}>{t}</Text></Text>
  return (
    <Box flexDirection="column" width={ADVISOR_W} borderStyle="single" borderColor={C.purple} paddingX={1}>
      <Box justifyContent="center"><Text bold color={C.purple}>{modelLabel(s.advisorModel).toUpperCase()}</Text></Box>
      <Box justifyContent="center"><Text color={C.purple}>advisor · on call</Text></Box>
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
      {isRecent ? (
        <Text backgroundColor="#2a2b38" color={C.purple} bold>{pad(`◆ consulted ${a.lastMs === null ? '' : elapsed(a.lastMs)}`, ADVISOR_W - 4)}</Text>
      ) : (
        <Text color={C.dim}>┆</Text>
      )}
      <Text color={C.dim}>┆</Text>
      {line('never writes')}
      {line('code itself.')}
      {line('Sonnet applies')}
      {line('the advice.')}
      <Text color={C.dim}>┆</Text>
      <Text color={C.purple}>◇ <Text color={C.fg}>before done</Text></Text>
    </Box>
  )
}

function LeadBox({ el, s }: { el: El; s: Snapshot }) {
  const { Box, Text } = el
  const effort = s.lead.effort ?? 'N/A'
  const level = ['low', 'medium', 'high', 'xhigh', 'max'].indexOf(effort) + 1
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={C.orange} paddingX={1}>
      <Text color={C.orange} bold>{modelLabel(s.lead.model)} · main session</Text>
      <Box justifyContent="center"><Text color={C.fg}>edits + runs tests</Text></Box>
      <Text>
        <Text color={C.fg}>effort </Text>
        <Text color={C.orange}>{'▮'.repeat(Math.max(0, level))}</Text>
        <Text color={C.dim}>{'▯'.repeat(Math.max(0, 5 - level))}</Text>
        <Text color={C.orange}> {effort}</Text>
      </Text>
      <Box justifyContent="center">
        {s.lead.turnStartedAt === null ? (
          <Text color={C.dim}>idle · ctx {compact(s.lead.contextTokens)} · {s.lead.steps} steps</Text>
        ) : (
          <Text color={C.orange}>
            {SPIN[s.tick % SPIN.length]} working {elapsed(s.now - s.lead.turnStartedAt)}
            <Text color={C.dim}> · ctx {compact(s.lead.contextTokens)}</Text>
          </Text>
        )}
      </Box>
    </Box>
  )
}

function JevRow({ el, q, d, width }: { el: El; q: string; d: JevDecision | undefined; width: number }) {
  const { Text } = el
  if (!d) {
    return <Text><Text color={C.fg}>{pad(q, 14)}</Text><Text color={C.dim}>{'░'.repeat(width)}  N/A</Text></Text>
  }
  const [full, rest] = bar(d.p, width)
  const tone = d.isSharp ? C.green : C.orange
  return (
    <Text>
      <Text color={C.fg}>{pad(q, 14)}</Text>
      <Text color={tone}>{full}</Text>
      <Text color={C.dim}>{rest}</Text>
      <Text color={tone}>  {d.p.toFixed(2)} {d.isSharp ? 'sharp' : 'split'}</Text>
    </Text>
  )
}

function JevBox({ el, s, width }: { el: El; s: Snapshot; width: number }) {
  const { Box, Text } = el
  const j = s.jev
  const barW = Math.max(4, Math.min(14, width - 32))
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={C.green} paddingX={1} width={width}>
      <Box justifyContent="space-between">
        <Text><Text bold color={C.green}>JEV</Text><Text color={C.green}> · fork layer</Text></Text>
        <Text>
          <Text color={C.dim}>decisions </Text>
          <Text bold color={C.fg}>{j.status === 'off' ? 'off' : j.decisions.toLocaleString('en-US')}</Text>
        </Text>
      </Box>
      {QUESTIONS.map(q => (
        <JevRow el={el} q={q} d={j.last.find(d => d.question === q)} width={barW} />
      ))}
      {j.status === 'on' ? (
        <Text color={C.dim}>sharp ≥ {JEV.threshold} · <Text color={C.orange}>split → {modelLabel(s.lead.model)}</Text> · observe-only</Text>
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
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={C.blue} paddingX={1} width={width}>
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
          <Text color={C.blue}>{SPIN[s.tick % SPIN.length]} running {elapsed(s.now - a.startedAt)}</Text>
        ) : (
          <Text color={C.green}>✓ done {elapsed((a.endedAt ?? s.now) - a.startedAt)}</Text>
        )}
      </Box>
    </Box>
  )
}

/** The three boxes shown: running agents first, then the most recent. */
function pickAgents(list: SwarmAgent[]): SwarmAgent[] {
  const running = list.filter(a => a.status === 'running')
  const done = list.filter(a => a.status !== 'running').reverse()
  return [...running, ...done].slice(0, 3)
}

function Diagram({ el, s, width }: { el: El; s: Snapshot; width: number }) {
  const { Box, Text } = el
  const shown = pickAgents(s.agents)
  const slots = ['search', 'grep', 'audit']
  const boxW = Math.floor((width - 2) / 3)
  const branch = boxW * 3 + 2
  const third = Math.floor(branch / 6)
  const running = s.agents.filter(a => a.status === 'running').length
  return (
    <Box flexDirection="column" width={width}>
      <Box justifyContent="center" width={width}>
        <Box width={Math.min(width, 44)} flexDirection="column"><LeadBox el={el} s={s} /></Box>
      </Box>
      <Box justifyContent="center"><Text color={C.orange}>┆</Text></Box>
      <Box justifyContent="center"><JevBox el={el} s={s} width={Math.min(width, 62)} /></Box>
      <Box justifyContent="center"><Text color={C.blue}>●</Text></Box>
      <Box justifyContent="center">
        <Text color={C.fg}>delegate to subagents · </Text>
        <Text bold color={C.blue}>{haikuModel(s)}</Text>
        {running > 0 ? <Text color={C.dim}> · {running} running</Text> : <Text> </Text>}
      </Box>
      <Box>
        <Text color={C.dim}>{' '.repeat(third - 1)}╭</Text>
        <Flow el={el} width={branch - third * 2 - 1} s={s} color={C.blue} />
        <Text color={C.dim}>╮</Text>
      </Box>
      <Box gap={1}>
        {[0, 1, 2].map(i => (
          <AgentBox el={el} a={shown[i]} s={s} width={boxW} slot={slots[i] ?? 'agent'} />
        ))}
      </Box>
      <Box>
        <Text color={C.dim}>{' '.repeat(third - 1)}╰</Text>
        <Flow el={el} width={branch - third * 2 - 1} s={s} color={C.fg} />
        <Text color={C.dim}>╯</Text>
      </Box>
      <Box justifyContent="center">
        <Box flexDirection="column" borderStyle="single" borderColor={C.orange} paddingX={2}>
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
  return (
    <Box flexDirection="column" width={width}>
      <Header el={el} s={s} width={width} />
      <Box borderStyle="single" borderColor={C.purple} paddingX={1} marginTop={1}>
        <Text>
          <Text bold color={C.purple}>{modelLabel(s.advisorModel)} advisor</Text>
          <Text color={C.fg}> · calls {a.calls} · last {a.lastAt === null ? 'N/A' : `${elapsed(s.now - a.lastAt)} ago`}</Text>
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
      </Text>
      {pickAgents(s.agents).map(a => (
        <Text>
          <Text color={C.blue}>{a.status === 'running' ? SPIN[s.tick % SPIN.length] : '✓'} {pad(role(a.type), 8)}</Text>
          <Text color={C.fg}> {a.steps}{a.maxTurns ? `/${a.maxTurns}` : ''} turns · {a.tools} tools</Text>
        </Text>
      ))}
    </Box>
  )
}

export function StatusRow({ el, s }: { el: El; s: Snapshot }) {
  const { Text } = el
  const running = s.agents.filter(a => a.status === 'running').length
  const advising = s.advisor.lastAt !== null && s.now - s.advisor.lastAt < 60_000
  return (
    <Text>
      <Text color={C.fg}>haiku </Text>
      <Text color={C.blue}>[{running > 0 ? 'swarming' : 'idle'}]</Text>
      <Text color={C.fg}>   subagents </Text>
      <Text color={C.blue}>[{running}/{s.agents.length}]</Text>
      <Text color={C.fg}>   {modelLabel(s.advisorModel).split(' ')[0]} </Text>
      <Text color={C.purple}>[{advising ? 'advising' : `on call · ${s.advisor.calls}`}]</Text>
      <Text color={C.fg}>   jev </Text>
      <Text color={C.green}>[ {s.jev.status === 'on' ? `${s.jev.decisions.toLocaleString('en-US')} decisions` : s.jev.status} ]</Text>
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
          {shown.map(r => (
            <Text>
              <Text color={C.dim}>{clock(r.at)}  </Text>
              <Text bold color={WHO_COLOR[r.who]}>{pad(r.who, 8)}</Text>
              <Text color={C.fg}>{pad(r.text, Math.max(10, Math.floor((width - 24) * 0.55)))}</Text>
              <Text color={C.dim}>{r.detail}</Text>
            </Text>
          ))}
        </Box>
      )}
      <StatusRow el={el} s={s} />
    </Box>
  )
}

export function SpinnerLine({ el, s, word, suffix, isAgent }: { el: El; s: Snapshot; word: string; suffix: string; isAgent: boolean }) {
  const { Text } = el
  const tone = isAgent ? C.blue : C.orange
  const started = s.lead.turnStartedAt
  return (
    <Text>
      <Text color={tone}>{SPIN[s.tick % SPIN.length]} </Text>
      <Text color={tone} bold>{word}{suffix}</Text>
      <Text color={C.dim}>
        {' '}({isAgent ? 'haiku · swarm' : `${modelLabel(s.lead.model)} · lead`}
        {started === null ? '' : ` · ${elapsed(s.now - started)}`}
        {isAgent || s.lead.turnOutputTokens === 0 ? '' : ` · ↓ ${compact(s.lead.turnOutputTokens)} tokens`} · esc to interrupt)
      </Text>
    </Text>
  )
}
