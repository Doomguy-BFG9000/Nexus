import type { Advisor, Council, CouncilRole, Fx, Guard, Jev, JevDecision, Lead, LogRow, Mode, NexusAgent, Reviewer, Usage, View } from '../types'
import { ON_WARNING, ROLES, ROLE_LABEL, councilTokens } from './council'
import { C, SPIN, bar, clock, compact, elapsed, modelLabel, pad, role } from './format'
import { stateLabel, tokensLabel, turnsLabel } from './inspect'
import { JEV } from './jev'
import { MODES, family, launchedMode, modelId, pairing } from './modes'
import { MINI_W, coreOrbit, decisionMini, dualOrbit, miniOrbit, nexusLogo, refreshOrbit } from './orbit'
import type { AgentPhase, JevOutcome, Sprite, Tone } from './orbit'
import { SETTINGS, prefValue } from './prefs'
import type { Prefs } from './prefs'
import { freshness, limitLabel, orderLimits, resetLabel, tone, usd } from './telemetry'
import type { ModelRow } from './telemetry'

// The elements come from the surface's table ($.ui.resolve(e)); views take
// them as an argument so they stay plain functions of the state.
type El = { Box: any; Text: any; Button?: any }

/** What a focused pane can do: open one agent, or go back to the diagram. */
export type Actions = {
  inspect: (id: string) => void
  /** Opens the settings view (the header's gear, or s). */
  settings: () => void
  back: () => void
  /** Sets one preference by its dotted key, as `/nexus settings` does. */
  set: (key: string, value: string) => void
  isFocused: boolean
}

export type Snapshot = {
  lead: Lead
  advisor: Advisor
  agents: NexusAgent[]
  jev: Jev
  log: LogRow[]
  mode: Mode
  fx: Fx[]
  reduceMotion: boolean
  tick: number
  view: View
  prefs: Prefs
  usage: Usage
  models: Record<string, ModelRow>
  guard: Guard
  council: Council
  /** A width the person set by hand, which Claude Code keeps over any request. */
  keptWidth?: number | null
  now: number
}

// Odd, so both orbit variants (13 and 21 wide) centre exactly in the panel.
const ADVISOR_W = 27
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
  council: C.purple,
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
    ROLES.some(r => s.council.reviewers[r].status === 'running') ||
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
  return s.mode.sessionAdvisor ? modelLabel(modelId(s.mode.sessionAdvisor)) : 'off'
}

function modeName(s: Snapshot): string {
  const id = s.mode.selected ?? launchedMode(s.mode.sessionModel, s.mode.sessionAdvisor)
  return id ? MODES[id].label : 'custom'
}

type Palette = Record<'core' | 'sat' | 'trail' | 'faint', string> & Partial<Record<'r1' | 'r2' | 'r3' | 'r4', string>>
const PALETTE: Record<'lead' | 'agent' | 'advisor' | 'jev' | 'done' | 'failed', Palette> = {
  lead: { core: C.orange, sat: C.orangeHi, trail: '#b4785a', faint: '#6e5040' },
  agent: { core: C.blue, sat: C.blueHi, trail: '#6487c8', faint: '#465a82' },
  advisor: { core: C.purple, sat: C.purpleHi, trail: '#8c80d2', faint: '#5a5482' },
  jev: { core: C.green, sat: C.greenHi, trail: '#64aa7d', faint: '#466e55' },
  done: { core: C.green, sat: C.greenHi, trail: '#64aa7d', faint: '#466e55' },
  failed: { core: C.red, sat: C.red, trail: C.red, faint: C.dim },
}

/** Draws an orbit sprite: one Text row per sprite row, coloured by tone. */
function Orbit({ el, sprite, palette }: { el: El; sprite: Sprite; palette: Palette }) {
  const { Box, Text } = el
  return (
    <Box flexDirection="column">
      {sprite.map(row => (
        <Text>{row.map(run => (run.tone === 'blank' ? <Text>{run.text}</Text> : <Text color={palette[run.tone] ?? palette.sat}>{run.text}</Text>))}</Text>
      ))}
    </Box>
  )
}

/** Where an agent's orbit is in its life, from its real lifecycle. */
function agentPhase(s: Snapshot, a: NexusAgent | undefined): AgentPhase {
  if (!a) return { state: 'idle' }
  if (a.status === 'running') return { state: 'running', sinceStart: s.now - a.startedAt }
  if (a.status === 'done') return { state: 'done', sinceEnd: s.now - (a.endedAt ?? s.now) }
  return { state: a.status }
}

/** The latest Jev outcome and how long ago it came, while its arc plays. */
function lastRoute(s: Snapshot): { outcome: JevOutcome | null; ms: number | null } {
  const f = [...s.fx].reverse().find(x => x.kind === 'route')
  if (!f) return { outcome: null, ms: null }
  return { outcome: f.ref as JevOutcome, ms: s.now - f.at }
}

/** Cuts `text` to `n` cells, ending in … when it had to cut. */
export function fit(text: string, n: number): string {
  if (n <= 0) return ''
  return text.length <= n ? text : `${text.slice(0, Math.max(0, n - 1))}…`
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

const LOGO_PALETTE: Palette = { core: C.fg, sat: C.fg, trail: C.dim, faint: '#3a3b4a', r1: C.orange, r2: C.blue, r3: C.purple, r4: C.green }

/** The turn's start, or the earliest running agent's: the mark moves for the whole turn. */
function turnSince(s: Snapshot): number | null {
  const starts = [s.lead.turnStartedAt, ...s.agents.filter(a => a.status === 'running').map(a => a.startedAt)].filter((x): x is number => x !== null)
  return starts.length ? Math.min(...starts) : null
}

function Header({ el, s, width, act }: { el: El; s: Snapshot; width: number; act?: Actions }) {
  const { Box, Text, Button } = el
  const since = turnSince(s)
  const isMoving = since !== null && !s.reduceMotion && !s.lead.isWaiting
  return (
    <Box flexDirection="column" width={width} marginTop={1}>
      <Box width={width}>
        <Box width={7} />
        <Box flexGrow={1} justifyContent="center" alignItems="center" gap={2}>
          <Orbit el={el} palette={LOGO_PALETTE} sprite={nexusLogo(isMoving ? s.now - since : null)} />
          <Box flexDirection="column">
            <Text bold color={C.fg}>N E X U S</Text>
            <Text color={C.dim}>multi-agent command center</Text>
          </Box>
        </Box>
        <Box width={7} justifyContent="flex-end" paddingRight={1}>
          {Button && act ? (
            <Button key="gear" hotkey="s" label="⚙" plain dimColor onPress={() => act.settings()} />
          ) : (
            <Text color={C.dim}>⚙</Text>
          )}
        </Box>
      </Box>
      <Text color={C.dim}>{'─'.repeat(width)}</Text>
    </Box>
  )
}

/** The running models and the mode, one per line: the bottom of the left column. */
function ModelLegend({ el, s, width }: { el: El; s: Snapshot; width: number }) {
  const { Box, Text } = el
  const row = (color: string, model: string, part: string) => (
    <Box justifyContent="space-between">
      <Text><Text color={color}>■ </Text><Text color={C.fg}>{model}</Text></Text>
      <Text color={C.dim}>{part}</Text>
    </Box>
  )
  const u = s.usage
  const inner = width - 4
  const line = (label: string, value: string, color: string = C.fg) => (
    <Box justifyContent="space-between"><Text color={C.dim}>{label}</Text><Text color={color}>{fit(value, inner - label.length - 1)}</Text></Box>
  )
  const showContext = s.prefs.telemetry.context
  const showCost = s.prefs.telemetry.cost
  return (
    <Box flexDirection="column" width={width} borderStyle="single" borderColor="#3a3b4a" paddingX={1}>
      {showContext && line('context', u.tokens === null || !u.window ? 'N/A' : `${compact(u.tokens)} / ${compact(u.window)}`, TONE[tone(u.percent)])}
      {showContext && u.tokens !== null && !!u.window && line('left', `${compact(u.window - u.tokens)} · ${u.percent ?? 'N/A'}%`, C.dim)}
      {showCost && line('session', `${usd(u.costUsd)} API est.`)}
      {u.compactions > 0 && line('compactions', String(u.compactions), C.dim)}
      {(showContext || showCost) && <Text color="#3a3b4a">{'─'.repeat(Math.max(0, inner))}</Text>}
      {row(C.orange, modelLabel(s.lead.model), 'lead')}
      {row(C.blue, haikuModel(s), 'agents')}
      {row(C.purple, advisorLabel(s), 'advisor')}
      {s.prefs.jev !== 'hidden' && row(C.green, 'jev', 'router')}
      <Text color="#3a3b4a">{'─'.repeat(Math.max(0, width - 4))}</Text>
      <Text><Text color={C.amber}>◈ </Text><Text color={C.dim}>Mode: </Text><Text color={C.fg}>{modeName(s)}</Text></Text>
      <Text color={C.dim}>{fit(s.keptWidth ? '↔ drag edge to resize' : s.prefs.paneColumns >= 999 ? '↔ max width' : `↔ /nexus width ${s.prefs.paneColumns}`, inner)}</Text>
    </Box>
  )
}

function advisorFxAt(s: Snapshot): number {
  return [...s.fx].reverse().find(f => f.kind === 'advisor')?.at ?? s.now
}

function AdvisorColumn({ el, s }: { el: El; s: Snapshot }) {
  const { Box, Text } = el
  const a = s.advisor
  const p = phase(s, 'advisor')
  const isOff = !s.mode.sessionAdvisor
  const inner = ADVISOR_W - 4
  const stat = (label: string, value: string, color: string = C.purple) => (
    <Text><Text color={C.dim}>{pad(label, 10)}</Text><Text color={value === '—' ? C.dim : color}>{fit(value, inner - 10)}</Text></Text>
  )
  const rule = <Text color="#3a3b4a">{'─'.repeat(inner)}</Text>
  const pair = s.mode.sessionAdvisor && s.lead.model ? pairing(s.lead.model, s.mode.sessionAdvisor) : null
  const recent = a.history.slice().reverse().slice(0, 4)
  return (
    <Box
      flexDirection="column"
      width={ADVISOR_W}
      alignSelf="flex-start"
      borderStyle={p === null ? 'single' : 'double'}
      borderColor={isLit(s, p) ? C.purpleHi : C.purple}
      paddingX={1}
    >
      <Box justifyContent="space-between">
        <Text bold color={p === null ? C.purple : C.purpleHi}>{advisorLabel(s).toUpperCase()}</Text>
        <Text color={C.purple}>{isOff ? '○ off' : p === null ? '◇ on call' : '◆ reported'}</Text>
      </Box>
      {rule}
      {!isOff && (
        <Box justifyContent="center">
          <Orbit
            el={el}
            palette={PALETTE.advisor}
            sprite={dualOrbit(s.prefs.orbitStyle, p === null || s.reduceMotion ? null : s.now - advisorFxAt(s))}
          />
        </Box>
      )}
      <Box justifyContent="center">
        {isOff ? (
          <Text color={C.dim}>no advisor this session</Text>
        ) : a.lastAt === null ? (
          <Text color={C.dim}>Awaiting consultation.</Text>
        ) : p !== null ? (
          <Text backgroundColor={C.purpleBg} color={C.purpleHi} bold> reported just now </Text>
        ) : (
          <Text color={C.fg}>last {elapsed(s.now - a.lastAt)} ago</Text>
        )}
      </Box>
      {rule}
      {stat('calls', String(a.calls))}
      {stat('duration', a.lastMs === null ? '—' : elapsed(a.lastMs))}
      {stat('context', a.contextAtCall === null ? '—' : compact(a.contextAtCall))}
      {stat('cost', 'N/A', C.dim)}
      {rule}
      {pair && (
        <Text>
          <Text color={C.dim}>{pad('pair', 6)}</Text>
          <Text color={pair.ok ? C.green : C.amber}>{pair.ok ? '✓ ' : '✗ '}</Text>
          <Text color={C.fg}>{fit(`${family(s.lead.model)} → ${family(s.mode.sessionAdvisor)}`, inner - 8)}</Text>
        </Text>
      )}
      <Text color={C.dim}>recent</Text>
      {recent.length === 0 ? (
        <Text color="#3a3b4a">  no calls yet</Text>
      ) : (
        recent.map(call => (
          <Text color={C.dim}>
            {pad(`${elapsed(s.now - call.at)} ago`, 10)}
            <Text color={C.fg}>{pad(call.ms === null ? '' : elapsed(call.ms), 5)}</Text>
            {compact(call.context)}
          </Text>
        ))
      )}
    </Box>
  )
}


// ---- NEXUS Council: the advisor's column, split into three reviewers -------
const COUNCIL_SHORT: Record<CouncilRole, string> = { security: 'SEC', architecture: 'ARC', performance: 'PERF' }

/** A reviewer's status word and its colour: only what its own lifecycle said. */
function reviewerState(s: Snapshot, r: Reviewer): { text: string; color: string } {
  if (r.status === 'running') return { text: `${spin(s)} ${r.startedAt === null ? '' : elapsed(s.now - r.startedAt)}`.trim(), color: C.purpleHi }
  if (r.status === 'queued') return { text: '◌ authorized', color: C.purple }
  if (r.status === 'done') return { text: '✓ done', color: C.green }
  if (r.status === 'stale') return { text: '◌ stale', color: C.amber }
  if (r.status === 'incomplete') return { text: '◌ INCOMPLETE', color: C.amber }
  if (r.status === 'failed') return { text: '✗ failed', color: C.red }
  return { text: 'idle', color: C.dim }
}

/** The reviewer's line to the lead: out on launch, held while it works, back with its findings, red on a failure. */
function CouncilLink({ el, s, r, width }: { el: El; s: Snapshot; r: Reviewer; width: number }) {
  const { Text } = el
  const out = phase(s, 'council-out', r.role)
  const back = phase(s, 'council-back', r.role)
  const fail = phase(s, 'council-fail', r.role)
  const track = Math.max(4, width - 7)
  let dots: number[] = []
  let color: string = C.purpleHi
  if (out !== null) dots = s.reduceMotion ? [0] : [1 - out]
  else if (back !== null) {
    dots = s.reduceMotion ? [1] : [back]
    color = C.greenHi
  } else if (r.status === 'running') dots = s.reduceMotion ? [0.5] : [(Math.floor(s.now / 180) % track) / Math.max(1, track - 1)]
  if (fail !== null) {
    return (
      <Text>
        <Text color={C.red}>✗ </Text>
        <Text color={C.red}>{'·'.repeat(track)}</Text>
        <Text color={C.dim}> lead</Text>
      </Text>
    )
  }
  const isLive = dots.length > 0
  return (
    <Text>
      <Text color={isLive ? C.purple : C.dim}>◂ </Text>
      <Track el={el} width={track} dots={dots} color={color} />
      <Text color={isLive ? C.orange : C.dim}> lead</Text>
    </Text>
  )
}

function ReviewerBox({ el, s, r }: { el: El; s: Snapshot; r: Reviewer }) {
  const { Box, Text } = el
  const inner = ADVISOR_W - 4
  const st = reviewerState(s, r)
  const isActive = r.status === 'running' || phase(s, 'council-back', r.role) !== null || phase(s, 'council-out', r.role) !== null
  const t = r.tokens
  const used = t.input + t.cacheRead + t.cacheWrite + t.output
  const detail =
    r.status === 'running'
      ? r.activity ?? 'reviewing'
      : r.reason ?? (r.status === 'idle' ? (s.prefs.council.activation === 'adaptive' ? 'not selected' : 'awaiting checkpoint') : r.rationale ?? '')
  const numbers =
    r.status === 'idle'
      ? 'opus · read-only'
      : `tok ${used === 0 ? 'N/A' : compact(used)}${r.findings === null ? '' : ` · ${r.findings} found`}`  // no usage reported: N/A, never 0
  return (
    <Box flexDirection="column" width={ADVISOR_W} borderStyle={isActive ? 'double' : 'single'} borderColor={r.status === 'idle' ? '#3a3b4a' : isActive ? C.purpleHi : C.purple} paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color={r.status === 'idle' ? C.dim : C.purple}>{ROLE_LABEL[r.role]}</Text>
        <Text color={st.color}>{fit(st.text, inner - ROLE_LABEL[r.role].length - 1)}</Text>
      </Box>
      <Text color={r.status === 'idle' ? '#3a3b4a' : C.fg}>{fit(detail || ' ', inner)}</Text>
      <Text color={C.dim}>{fit(numbers, inner)}</Text>
      <CouncilLink el={el} s={s} r={r} width={inner} />
    </Box>
  )
}

/** Council on or adaptive: the advisor stays on top as the controller, the three reviewers beneath it. */
function CouncilColumn({ el, s }: { el: El; s: Snapshot }) {
  const { Box, Text } = el
  const a = s.advisor
  const p = phase(s, 'advisor')
  const isOff = !s.mode.sessionAdvisor
  const inner = ADVISOR_W - 4
  const c = s.council
  const activation = s.prefs.council.activation
  const cp = c.checkpoint
  const t = councilTokens(c)
  const total = t.input + t.cacheRead + t.cacheWrite + t.output
  return (
    <Box flexDirection="column" width={ADVISOR_W} alignSelf="flex-start">
      <Box flexDirection="column" width={ADVISOR_W} borderStyle={p === null ? 'single' : 'double'} borderColor={isLit(s, p) ? C.purpleHi : C.purple} paddingX={1}>
        <Box justifyContent="space-between">
          <Text bold color={p === null ? C.purple : C.purpleHi}>{advisorLabel(s).toUpperCase()}</Text>
          <Text color={C.purple}>{isOff ? '○ off' : p === null ? '◇ on call' : '◆ reported'}</Text>
        </Box>
        <Box justifyContent="center">
          {isOff ? (
            <Text color={C.dim}>no advisor this session</Text>
          ) : a.lastAt === null ? (
            <Text color={C.dim}>Awaiting consultation.</Text>
          ) : p !== null ? (
            <Text backgroundColor={C.purpleBg} color={C.purpleHi} bold> reported just now </Text>
          ) : (
            <Text color={C.fg}>last {elapsed(s.now - a.lastAt)} ago</Text>
          )}
        </Box>
        <Text color={C.dim}>{fit(`calls ${a.calls} · ${a.lastMs === null ? '—' : elapsed(a.lastMs)} · ctx ${a.contextAtCall === null ? '—' : compact(a.contextAtCall)}`, inner)}</Text>
        <Text color="#3a3b4a">{'─'.repeat(inner)}</Text>
        <Text>
          <Text color={C.dim}>council </Text>
          <Text bold color={activation === 'on' ? C.amber : C.purple}>{activation === 'on' ? 'ON · all three' : 'ADAPTIVE · ≤1'}</Text>
        </Text>
        {activation === 'on' && <Text color={C.amber}>{fit('⚠ Higher token usage', inner)}</Text>}
        <Text color={C.dim}>
          {fit(
            cp === null
              ? 'no checkpoint yet'
              : `#${cp.id} ${cp.status}${cp.selection === 'all' || cp.selection === 'none' ? '' : ` · ${cp.selection}`}${cp.isStale ? ' · stale' : ''}`,
            inner,
          )}
        </Text>
        <Text color={C.dim}>{fit(`tok ${total > 0 ? compact(total) : 'N/A'} · cost N/A`, inner)}</Text>
      </Box>
      {ROLES.map(r => (
        <ReviewerBox el={el} s={s} r={c.reviewers[r]} />
      ))}
    </Box>
  )
}

/** One line for compact and list layouts: each reviewer's state. */
function CouncilStrip({ el, s }: { el: El; s: Snapshot }) {
  const { Text } = el
  const activation = s.prefs.council.activation
  return (
    <Text>
      <Text color={C.dim}>council </Text>
      <Text color={activation === 'on' ? C.amber : C.purple}>{activation}</Text>
      {ROLES.map(role => {
        const r = s.council.reviewers[role]
        const st = reviewerState(s, r)
        return (
          <Text>
            <Text color={C.dim}> · </Text>
            <Text color={r.status === 'idle' ? C.dim : C.purple}>{COUNCIL_SHORT[role]} </Text>
            <Text color={st.color}>{r.status === 'idle' ? '○' : st.text}</Text>
          </Text>
        )
      })}
    </Text>
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
  // Council traffic rides the same line: each reviewer launched (out) or answering (back).
  if (s.prefs.council.activation !== 'off') {
    for (const r of ROLES) {
      const out = phase(s, 'council-out', r)
      const back = phase(s, 'council-back', r)
      if (out !== null) dots.push(s.reduceMotion ? 0 : 1 - out)
      if (back !== null) dots.push(s.reduceMotion ? 1 : back)
    }
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
    <Box flexDirection="column" borderStyle="single" borderColor={beat ? C.orangeHi : C.orange} paddingX={1} alignItems="center">
      <Box gap={2} alignItems="center">
        <Orbit el={el} palette={PALETTE.lead} sprite={coreOrbit(isWorking(s) && !s.reduceMotion ? s.now - (s.lead.turnStartedAt ?? s.now) : null)} />
        <Box flexDirection="column">
          <Text color={C.orange} bold>{modelLabel(s.lead.model)} · main session</Text>
          <Text color={C.fg}>edits + runs tests</Text>
          <Text>
            <Text color={C.fg}>effort </Text>
            <Text color={C.orange}>{'▮'.repeat(Math.max(0, level))}</Text>
            <Text color={C.dim}>{'▯'.repeat(Math.max(0, 5 - level))}</Text>
            <Text color={C.orange}> {effort}</Text>
          </Text>
        </Box>
      </Box>
      {isFallback && <Text color={C.amber}>asked {modelLabel(asked)} · answered by {modelLabel(s.lead.model)}</Text>}
      {s.mode.relaunch && <Text color={C.amber}>advisor change waits for a relaunch</Text>}
      {s.lead.turnStartedAt === null ? (
        <Text color={C.dim}>idle · {s.lead.steps} steps</Text>
      ) : s.lead.isWaiting ? (
        <Text color={C.amber}>◌ waiting for you</Text>
      ) : (
        <Text color={beat ? C.orangeHi : C.orange}>
          {beat ? '●' : s.reduceMotion ? '●' : '○'} working {elapsed(s.now - s.lead.turnStartedAt)}
        </Text>
      )}
    </Box>
  )
}

/** Fixed columns so every Jev row lines up: question, bar, p, verdict, choice, confidence. */
const JEV_COLS = { q: 14, p: 6, verdict: 7, choice: 9, conf: 5 }
const JEV_SPLIT = '#6fae86'

function JevRow({ el, s, q, d, width }: { el: El; s: Snapshot; q: string; d: JevDecision | undefined; width: number }) {
  const { Text } = el
  const tail = JEV_COLS.p + JEV_COLS.verdict + JEV_COLS.choice + JEV_COLS.conf
  if (!d) {
    return (
      <Text>
        <Text color={C.fg}>{pad(q, JEV_COLS.q)}</Text>
        <Text color={C.dim}>{'░'.repeat(width)} {pad('N/A', tail)}</Text>
      </Text>
    )
  }
  // A new answer fills its bar from empty to its probability. Sharp and split
  // are both green: sharp bright, split muted, and the word says which.
  const p = phase(s, 'jev', q)
  const grown = p === null || s.reduceMotion ? 1 : Math.min(1, p * 1.6)
  const [full, rest] = bar(d.p * grown, width)
  const tone = d.isSharp ? C.green : JEV_SPLIT
  return (
    <Text>
      <Text color={C.fg}>{pad(q, JEV_COLS.q)}</Text>
      <Text color={tone} bold={p !== null}>{full}</Text>
      <Text color={C.dim}>{rest}</Text>
      <Text color={tone}> {pad(d.p.toFixed(2), JEV_COLS.p)}</Text>
      <Text color={tone} bold={d.isSharp}>{pad(d.isSharp ? 'sharp' : 'split', JEV_COLS.verdict)}</Text>
      <Text color={C.fg}>{pad(fit(d.choice, JEV_COLS.choice - 1), JEV_COLS.choice)}</Text>
      <Text color={C.dim}>{pad(d.confidence === null ? '' : `c${d.confidence.toFixed(2)}`, JEV_COLS.conf)}</Text>
    </Text>
  )
}

function JevBox({ el, s, width }: { el: El; s: Snapshot; width: number }) {
  const { Box, Text } = el
  const j = s.jev
  const fixed = JEV_COLS.q + 1 + JEV_COLS.p + JEV_COLS.verdict + JEV_COLS.choice + JEV_COLS.conf
  const barW = Math.max(4, Math.min(12, width - 4 - fixed))
  const isOff = j.status === 'off'
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={isOff ? C.dim : C.green} paddingX={1} width={width} alignItems="center">
      <Box justifyContent="center" gap={1}>
        <Orbit el={el} palette={PALETTE.jev} sprite={(() => { const r = lastRoute(s); return decisionMini(isOff ? null : r.outcome, r.ms, s.reduceMotion) })()} />
        <Text>
          <Text bold color={isOff ? C.dim : C.green}>JEV</Text>
          <Text color={isOff ? C.dim : C.green}> · fork layer</Text>
          <Text color={C.dim}> · decisions </Text>
          <Text bold color={C.fg}>{isOff ? 'off' : j.decisions.toLocaleString('en-US')}</Text>
        </Text>
      </Box>
      {QUESTIONS.map(q => (
        <JevRow el={el} s={s} q={q} d={j.last.find(d => d.question === q)} width={barW} />
      ))}
      {j.status === 'on' ? (
        <Text color={C.dim}>
          sharp ≥ {JEV.threshold} · agreed {j.toolAgreed}/{j.toolChecked} · ${j.spentUsd.toFixed(4)} ·{' '}
          <Text color={j.routing === 'active' ? C.green : j.routing === 'calibrating' ? C.amber : C.dim} bold={j.routing === 'active'}>
            {j.routing === 'active' ? 'ROUTING ACTIVE' : j.routing === 'calibrating' ? 'calibrating…' : j.routing === 'off' ? 'routing off' : 'observe-only'}
          </Text>
        </Text>
      ) : (
        <Text color={C.dim}>jev {j.status} · {j.reason ?? 'N/A'}</Text>
      )}
      {j.routing === 'active' && (
        <Text color={C.dim}>
          hints <Text color={C.green}>{j.hints}</Text> (followed {j.hintsFollowed}/{j.hintsChecked}) · retries{' '}
          <Text color={C.green}>{j.retries}</Text> ({j.recovered} ok) · fallbacks <Text color={JEV_SPLIT}>{j.fallbacks}</Text>
        </Text>
      )}
    </Box>
  )
}

const TONE: Record<ReturnType<typeof tone>, string> = { normal: C.teal, warn: C.amber, alert: C.red, none: C.dim }

/** The one telemetry line: the main thread's context now, and the session's API-priced total. */
export function TelemetryLine({ el, s }: { el: El; s: Snapshot }) {
  const { Text } = el
  const u = s.usage
  const t = s.prefs.telemetry
  const parts: any[] = []
  if (t.context) {
    parts.push(
      u.tokens === null || !u.window ? (
        <Text color={C.dim}>context N/A</Text>
      ) : (
        <Text>
          <Text color={C.dim}>context </Text>
          <Text color={TONE[tone(u.percent)]}>{compact(u.tokens)} / {compact(u.window)}</Text>
          <Text color={C.dim}> · {compact(u.window - u.tokens)} left · {u.percent ?? 'N/A'}%</Text>
        </Text>
      ),
    )
  }
  if (t.cost) parts.push(<Text><Text color={C.dim}>session </Text><Text color={C.fg}>{usd(u.costUsd)}</Text><Text color={C.dim}> API est.</Text></Text>)
  if (t.tokens) {
    const lead = Object.entries(s.models).filter(([, r]) => r.leadRequests > 0)
    const total = lead.reduce((n, [, r]) => n + r.cacheRead, 0)
    parts.push(<Text color={C.dim}>cache read {compact(total)}</Text>)
  }
  if (u.compactions > 0) parts.push(<Text color={C.dim}>{u.compactions} compaction{u.compactions === 1 ? '' : 's'}</Text>)
  if (parts.length === 0) return null
  return <Text>{parts.flatMap((p, i) => (i === 0 ? [p] : [<Text color={C.dim}>   </Text>, p]))}</Text>
}

const GUARD_TONE: Record<string, string> = {
  OFF: C.dim, ARMED: C.teal, REFRESHING: C.teal, WARM: C.teal, EXPIRED: C.amber, PAUSED: C.dim, ERROR: C.red,
}

/** Cache Guard, under the back-to-lead box: its state and what its beats measured. */
export function CacheGuardBox({ el, s, width }: { el: El; s: Snapshot; width: number }) {
  const { Box, Text } = el
  const g = s.guard
  const on = s.prefs.cacheGuard.enabled
  const beatAt = [...s.fx].reverse().find(f => f.kind === 'beat')?.at ?? null
  const mark = refreshOrbit(on ? g.status : 'OFF', beatAt === null ? null : s.now - beatAt, s.reduceMotion)
  const pct = (v: number | null) => (v === null ? 'N/A' : `${Math.round(v * 100)}%`)
  if (!on) {
    return (
      <Box width={width} borderStyle="single" borderColor={C.dim} paddingX={1}>
        <Text color={C.dim}>{mark} cache guard · off · /nexus cache on</Text>
      </Box>
    )
  }
  const tone = GUARD_TONE[g.status] ?? C.dim
  const tokens = g.tokens.input + g.tokens.cacheRead + g.tokens.cacheWrite + g.tokens.output
  return (
    <Box flexDirection="column" width={width} borderStyle="single" borderColor={C.tealDim} paddingX={1}>
      <Text>
        <Text color={tone} bold>{mark} cache guard </Text>
        <Text color={tone}>{g.status.toLowerCase()}</Text>
        <Text color={C.dim}>
          {g.nextAt !== null && (g.status === 'ARMED' || g.status === 'WARM') ? ` · next ${elapsed(Math.max(0, g.nextAt - s.now))}` : ''} · beats {g.beats} · last read {pct(g.lastBeatRead)}
        </Text>
      </Text>
      <Text color={C.dim}>
        beat usage {compact(tokens)} tok · {usd(g.usd)} API est. · TTL {g.ttl}
        {g.status === 'PAUSED' || g.status === 'ERROR' || g.status === 'EXPIRED' ? ` · ${g.reason ?? ''}` : ''}
      </Text>
    </Box>
  )
}

/** USAGE: the plan windows Claude Code reported, as small bars; nothing is guessed. */
export function UsageBox({ el, s, width }: { el: El; s: Snapshot; width: number }) {
  const { Box, Text } = el
  if (!s.prefs.telemetry.usage) return null
  const u = s.usage
  const fresh = freshness(u.readAt, s.now)
  const limits = orderLimits(u.limits)
  const barW = Math.max(6, Math.min(16, width - 40))
  return (
    <Box flexDirection="column" width={width} borderStyle="single" borderColor={C.tealDim} paddingX={1}>
      <Box justifyContent="space-between">
        <Text><Text bold color={C.teal}>USAGE</Text><Text color={C.dim}> · {u.plan ?? 'plan not reported'}</Text></Text>
        <Text color={fresh.isStale ? C.amber : C.dim}>{fresh.isStale && u.readAt !== null ? `stale · ${fresh.label}` : fresh.label}</Text>
      </Box>
      {limits.length === 0 && <Text color={C.dim}>no limits yet · they arrive with responses</Text>}
      {limits.map(l => {
        const [full, rest] = bar(l.percentUsed / 100, barW)
        const color = fresh.isStale ? C.dim : TONE[tone(l.percentUsed)]
        return (
          <Text>
            <Text color={C.fg}>{pad(limitLabel(l.kind), 10)}</Text>
            <Text color={color}>{full}</Text>
            <Text color={C.dim}>{rest}</Text>
            <Text color={color}> {String(Math.round(l.percentUsed)).padStart(3)}%</Text>
            <Text color={C.dim}>  {resetLabel(l.resetsAt, s.now)}</Text>
          </Text>
        )
      })}
    </Box>
  )
}

/** Jev on one line: the latest answer and the routing state. */
function JevLine({ el, s }: { el: El; s: Snapshot }) {
  const { Text } = el
  const j = s.jev
  const d = j.last.at(-1)
  return (
    <Text>
      <Text color={j.status === 'off' ? C.dim : C.green} bold>jev </Text>
      <Text color={C.dim}>{j.status === 'on' ? `${j.decisions} decisions · ${j.routing}` : `${j.status} · ${j.reason ?? ''}`}</Text>
      {d && <Text color={d.isSharp ? C.green : C.orange}> · {d.question} → {d.choice} {d.p.toFixed(2)}</Text>}
    </Text>
  )
}

function AgentBox({ el, a, s, width, slot }: { el: El; a: NexusAgent | undefined; s: Snapshot; width: number; slot: string }) {
  const { Box, Text } = el
  const inner = Math.max(6, width - 4)
  // Fixed footprint: five single-line rows inside the border, whatever the content.
  const card = (border: string, rows: any[], round = false, dimBorder = false) => (
    <Box flexDirection="column" borderStyle={round ? 'round' : 'single'} borderColor={border} borderDimColor={dimBorder} paddingX={1} width={width} height={7}>
      {rows}
    </Box>
  )
  if (!a) {
    return card(C.blue, [
      <Box justifyContent="space-between"><Text bold color={C.dim}>{fit(slot, inner - MINI_W - 1)}</Text><Text color={C.dim}>{'  ·  '}</Text></Box>,
      <Text color={C.dim}> </Text>,
      <Text color={C.dim}>idle</Text>,
      <Text> </Text>,
      <Text color={C.dim}>○ waiting</Text>,
    ], false, true)
  }
  const ended = phase(s, 'done', a.id)
  const born = phase(s, 'spawn', a.id)
  const tone = a.isNexus ? C.blue : C.dim
  const border =
    a.status === 'failed' ? C.red
    : ended !== null && a.status === 'done' ? (isLit(s, ended) ? C.greenHi : C.green)
    : born !== null && isLit(s, born) ? C.blueHi
    : tone
  const pal = a.status === 'done' ? PALETTE.done : a.status === 'failed' ? PALETTE.failed : PALETTE.agent
  const took = elapsed((a.endedAt ?? s.now) - a.startedAt)
  const status =
    a.status === 'running' ? <Text color={C.blue}>● running {elapsed(s.now - a.startedAt)}</Text>
    : a.status === 'done' ? <Text color={ended !== null ? C.greenHi : C.green} bold={ended !== null}>✓ done {took}</Text>
    : a.status === 'failed' ? <Text color={C.red}>✗ failed {took}</Text>
    : <Text color={C.dim}>◌ cancelled {took}</Text>
  return card(
    border,
    [
      <Box justifyContent="space-between">
        <Text bold color={C.fg}>{fit(a.label, inner - MINI_W - 1)}</Text>
        <Orbit el={el} palette={pal} sprite={miniOrbit(agentPhase(s, a), s.reduceMotion)} />
      </Box>,
      <Text color={tone}>{fit(a.isNexus ? modelLabel(a.model) : `${modelLabel(a.model)} · fallback`, inner)}</Text>,
      <Text color={C.fg}>{fit(a.isWorktree ? 'in a worktree' : a.description || a.type, inner)}</Text>,
      <Text color={C.dim}>{fit(turnsLabel(a), inner)}</Text>,
      status,
    ],
    !a.isNexus,
  )
}

/** One agent in full, inside the pane. Only real, reported fields; the rest reads N/A. */
export function AgentDetail({ el, a, s, act, width }: { el: El; a: NexusAgent | undefined; s: Snapshot; act: Actions; width: number }) {
  const { Box, Text, Button } = el
  const row = (label: string, value: string, color: string = C.fg) => (
    <Text><Text color={C.dim}>{pad(label, 10)}</Text><Text color={color}>{value}</Text></Text>
  )
  if (!a) return <Text color={C.dim}>That agent is no longer in this session's list.</Text>
  return (
    <Box flexDirection="column" width={width} borderStyle={a.isNexus ? 'single' : 'round'} borderColor={a.isNexus ? C.blue : C.dim} paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color={C.fg}>{a.label}<Text color={C.blue}> · {modelLabel(a.model)}</Text>{a.isNexus ? '' : <Text color={C.dim}> · fallback</Text>}</Text>
        <Text color={a.status === 'failed' ? C.red : a.status === 'running' ? C.blue : C.green}>{stateLabel(a, s.now)}</Text>
      </Box>
      <Text> </Text>
      {row('task', a.description || 'N/A')}
      {s.prefs.agentDetail === 'full' && row('prompt', a.prompt || 'N/A', C.dim)}
      {row('turns', `${turnsLabel(a)} · tools ${a.tools}${a.lastTool ? ` · last ${a.lastTool}` : ''}`)}
      {row('tokens', tokensLabel(a.tokens))}
      {row('reported', a.reportedTokens === null ? 'N/A' : `${compact(a.reportedTokens)} total (Agent result)`, C.dim)}
      {row('cost', 'API est. N/A per agent', C.dim)}
      {row('files', a.files.length ? a.files.slice(-4).join(', ') : 'none', C.dim)}
      {a.reason && row('ended', a.reason, C.red)}
      <Text> </Text>
      {s.prefs.agentDetail === 'full' && <Text color={C.dim}>recent</Text>}
      {s.prefs.agentDetail === 'full' &&
        (a.recent.length ? a.recent : [{ at: s.now, text: 'none' }]).slice(-5).map(r => (
          <Text color={C.fg}><Text color={C.dim}>{clock(r.at)}  </Text>{r.text}</Text>
        ))}
      {s.prefs.agentDetail === 'full' && <Text> </Text>}
      <Text color={C.dim}>result</Text>
      {(a.summary ? a.summary.split('\n').filter(l => l.trim()).slice(0, 6) : ['N/A']).map(l => <Text color={C.fg}>{l}</Text>)}
      <Text> </Text>
      {Button && act.isFocused ? (
        <Button key="back" hotkey="b" label="back to the diagram" plain dimColor onPress={() => act.back()} />
      ) : (
        <Text color={C.dim}>/nexus back · or focus the pane (ctrl+x tab) and press b</Text>
      )}
    </Box>
  )
}

/** The settings, inside the pane: Select rows while it holds the focus, else the values. */
export function SettingsView({ el, s, act, width }: { el: El; s: Snapshot; act: Actions; width: number }) {
  const { Box, Text, Button, Select } = el as El & { Select?: any }
  return (
    <Box flexDirection="column" width={width} borderStyle="single" borderColor={C.dim} paddingX={1}>
      <Text bold color={C.fg}>settings <Text color={C.dim}>· plugin store only; Claude Code settings untouched</Text></Text>
      {s.prefs.council.activation === 'on' && <Text color={C.amber}>{ON_WARNING}</Text>}
      <Text> </Text>
      {SETTINGS.filter(spec => spec.options).map(spec =>
        Select && act.isFocused ? (
          <Select
            key={`set-${spec.key}`}
            label={`${pad(spec.key, 22)}`}
            value={prefValue(s.prefs, spec.key)}
            options={spec.options!.map(o => ({ value: o, label: o }))}
            onSelect={(value: string) => act.set(spec.key, value)}
          />
        ) : (
          <Text><Text color={C.dim}>{pad(spec.key, 22)}</Text><Text color={C.fg}>{prefValue(s.prefs, spec.key)}</Text></Text>
        ),
      )}
      {SETTINGS.filter(spec => spec.range).map(spec => (
        <Text><Text color={C.dim}>{pad(spec.key, 22)}</Text><Text color={C.fg}>{pad(prefValue(s.prefs, spec.key), 6)}</Text><Text color={C.dim}>/nexus settings {spec.key} {spec.range![0]}-{spec.range![1]}</Text></Text>
      ))}
      <Text> </Text>
      {Button && act.isFocused ? (
        <Button key="back" hotkey="b" label="back to the diagram" plain dimColor onPress={() => act.back()} />
      ) : (
        <Text color={C.dim}>click or ctrl+x tab to edit here · /nexus settings &lt;key&gt; &lt;value&gt; · b or /nexus back</Text>
      )}
    </Box>
  )
}

/** Hotkeys 1-9 open an agent while the pane holds the focus; a hint otherwise. */
function InspectBar({ el, s, act }: { el: El; s: Snapshot; act: Actions }) {
  const { Box, Text, Button } = el
  const list = s.agents.slice(-9)
  if (list.length === 0) return null
  const hidden = s.agents.length - Math.min(3, s.agents.length)
  if (!Button || !act.isFocused) {
    return <Box justifyContent="center"><Text color={C.dim}>{hidden > 0 ? `+${hidden} more · ` : ''}ctrl+x tab, then 1-{list.length} to inspect</Text></Box>
  }
  return (
    <Box flexWrap="wrap" columnGap={2} justifyContent="center">
      {list.map((a, i) => (
        <Button key={`inspect-${a.id}`} hotkey={String(i + 1)} label={a.label} plain dimColor={a.status !== 'running'} onPress={() => act.inspect(a.id)} />
      ))}
    </Box>
  )
}

/** The three boxes shown: running agents first, then the most recent. */
export function pickAgents(list: NexusAgent[]): NexusAgent[] {
  const running = list.filter(a => a.status === 'running')
  const done = list.filter(a => a.status !== 'running').reverse()
  return [...running, ...done].slice(0, 3)
}

/** Where box `i` of three sits along a track, 0..1. */
const SLOT_X = [0, 0.5, 1]

function Diagram({ el, s, width: room, act }: { el: El; s: Snapshot; width: number; act: Actions }) {
  const { Box, Text } = el
  const shown = pickAgents(s.agents)
  const slots = ['search', 'grep', 'audit']
  const boxW = Math.floor((room - 2) / 3)
  // Everything full-width shares the card grid's edges.
  const width = boxW * 3 + 2
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
      {s.prefs.jev === 'bars' && <JevBox el={el} s={s} width={width} />}
      {s.prefs.jev === 'line' && <Box justifyContent="center"><JevLine el={el} s={s} /></Box>}
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
      <InspectBar el={el} s={s} act={act} />
      <Box justifyContent="center">
        <Box flexDirection="column" borderStyle="single" borderColor={back.length ? C.greenHi : C.orange} paddingX={2}>
          <Text color={C.orange} bold>back to {modelLabel(s.lead.model)} · lead</Text>
          <Box justifyContent="center"><Text color={C.fg}>review + verify</Text></Box>
        </Box>
      </Box>
      <Box marginTop={1}><CacheGuardBox el={el} s={s} width={width} /></Box>
      <UsageBox el={el} s={s} width={width} />
    </Box>
  )
}

/** The full reference layout: advisor column left, the flow right. */
export function PaneFull({ el, s, width, act }: { el: El; s: Snapshot; width: number; act: Actions }) {
  const { Box } = el
  const right = width - ADVISOR_W - 2
  // Settings take the whole pane: preferences only, no model or advisor panels beside them.
  if (s.view.kind === 'settings') {
    return (
      <Box flexDirection="column" width={width}>
        <Header el={el} s={s} width={width} act={act} />
        <Box marginTop={1}><SettingsView el={el} s={s} act={act} width={width} /></Box>
      </Box>
    )
  }
  return (
    <Box flexDirection="column" width={width}>
      <Header el={el} s={s} width={width} act={act} />
      <Box gap={2} marginTop={1}>
        <Box flexDirection="column" justifyContent="space-between" width={ADVISOR_W}>
          {s.prefs.council.activation === 'off' ? <AdvisorColumn el={el} s={s} /> : <CouncilColumn el={el} s={s} />}
          <ModelLegend el={el} s={s} width={ADVISOR_W} />
        </Box>
        {s.view.kind === 'agent' ? (
          <AgentDetail el={el} a={s.agents.find(a => a.id === s.view.ref)} s={s} act={act} width={right} />
        ) : (
          <Diagram el={el} s={s} width={right} act={act} />
        )}
      </Box>
    </Box>
  )
}

/** Narrower docks: the same boxes stacked, advisor as a one-line strip. */
export function PaneCompact({ el, s, width, act }: { el: El; s: Snapshot; width: number; act: Actions }) {
  const { Box, Text } = el
  const a = s.advisor
  const p = phase(s, 'advisor')
  if (s.view.kind === 'agent' || s.view.kind === 'settings') {
    return (
      <Box flexDirection="column" width={width}>
        <Header el={el} s={s} width={width} act={act} />
        {s.view.kind === 'agent' ? (
          <AgentDetail el={el} a={s.agents.find(x => x.id === s.view.ref)} s={s} act={act} width={width} />
        ) : (
          <SettingsView el={el} s={s} act={act} width={width} />
        )}
      </Box>
    )
  }
  return (
    <Box flexDirection="column" width={width}>
      <Header el={el} s={s} width={width} act={act} />
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
      {s.prefs.council.activation !== 'off' && (
        <Box flexDirection="column" paddingX={1}>
          <CouncilStrip el={el} s={s} />
          {s.prefs.council.activation === 'on' && <Text color={C.amber}>{ON_WARNING}</Text>}
        </Box>
      )}
      <LeadBox el={el} s={s} />
      {s.prefs.jev === 'bars' && <JevBox el={el} s={s} width={width} />}
      {s.prefs.jev === 'line' && <JevLine el={el} s={s} />}
      {pickAgents(s.agents).map(agent => (
        <AgentBox el={el} a={agent} s={s} width={width} slot="agent" />
      ))}
      {s.agents.length === 0 && <Text color={C.dim}>no subagents yet</Text>}
      <InspectBar el={el} s={s} act={act} />
      <CacheGuardBox el={el} s={s} width={width} />
      <UsageBox el={el} s={s} width={width} />
      <ModelLegend el={el} s={s} width={width} />
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
        <Text color={C.dim}> · ctx {compact(s.usage.tokens)} </Text>
        <Text color={C.purple}>■ advisor {s.advisor.calls}</Text>
        <Text color={C.dim}> </Text>
        <Text color={C.green}>■ jev {s.jev.status === 'on' ? s.jev.decisions : s.jev.status}</Text>
        <Text color={C.amber}> ◈ {modeName(s)}</Text>
      </Text>
      {s.prefs.council.activation !== 'off' && <CouncilStrip el={el} s={s} />}
      {pickAgents(s.agents).map(a => (
        <Text>
          <Text color={a.isNexus ? C.blue : C.dim}>{a.status === 'running' ? spin(s) : a.status === 'done' ? '✓' : a.status === 'failed' ? '✗' : '◌'} {pad(a.label, 10)}</Text>
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
      <Text color={C.blue}>[{running > 0 ? 'running' : 'idle'}]</Text>
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
      {s.prefs.layout === 'minimal' && <MinimalStrip el={el} s={s} />}
    </Box>
  )
}

/** Minimal layout: the lead, context, cost and plan windows on one line. */
function MinimalStrip({ el, s }: { el: El; s: Snapshot }) {
  const { Text } = el
  const fresh = freshness(s.usage.readAt, s.now)
  return (
    <Text>
      <Text color={C.orange}>{modelLabel(s.lead.model)}</Text>
      <Text color={C.dim}>   </Text>
      <TelemetryLine el={el} s={s} />
      {s.prefs.telemetry.usage &&
        orderLimits(s.usage.limits).slice(0, 3).map(l => (
          <Text color={fresh.isStale ? C.dim : TONE[tone(l.percentUsed)]}>   {limitLabel(l.kind)} {Math.round(l.percentUsed)}%</Text>
        ))}
    </Text>
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
        {' '}({isAgent ? 'haiku · agent' : `${modelLabel(s.lead.model)} · lead`}
        {started === null ? '' : ` · ${elapsed(s.now - started)}`}
        {isAgent || s.lead.turnOutputTokens === 0 ? '' : ` · ↓ ${compact(s.lead.turnOutputTokens)} tokens`} · esc to interrupt)
      </Text>
    </Text>
  )
}
