// /nexus-help and /nexus-about: one source for the drawn views and their
// plain-text fallback. Every command listed here is registered or parsed by
// register.tsx; a test checks that.
import { C } from './format'

export const NEXUS_VERSION = '0.7.0'
export const AUTHOR = 'Muhammad Zain'

type El = { Box: any; Text: any }

export type HelpRow = { cmd: string; text: string }
export type HelpSection = { title: string; rows: HelpRow[] }

export const HELP: HelpSection[] = [
  {
    title: 'Dashboard',
    rows: [
      { cmd: '/nexus', text: 'open the dashboard' },
      { cmd: '/nexus close', text: 'close it (or ctrl+x x while it has focus)' },
      { cmd: '/nexus layout <auto|full|compact|minimal>', text: 'switch the layout' },
      { cmd: '/nexus settings [key value]', text: 'open settings, or change one' },
      { cmd: '/nexus width <max|40-200|wider|narrower>', text: 'pane width (a width dragged by hand wins)' },
      { cmd: '/nexus back', text: 'back to the diagram from a detail view' },
    ],
  },
  {
    title: 'Agents',
    rows: [
      { cmd: '/nexus agents', text: 'list this session’s agents' },
      { cmd: '/nexus inspect <n|label>', text: 'one agent in detail (e.g. search#2)' },
    ],
  },
  {
    title: 'Models',
    rows: [
      { cmd: '/nexus-mode [balanced|deep|max|default|status]', text: 'reasoning mode for this session' },
      { cmd: '/nexus council [adaptive|on|off|status|findings|ledger]', text: 'Opus Council: reviewers, last verdict, tool ledger' },
    ],
  },
  {
    title: 'Telemetry',
    rows: [{ cmd: '/nexus usage', text: 'context, cost estimate, plan usage, tokens' }],
  },
  {
    title: 'Integrations',
    rows: [
      { cmd: '/nexus-jev [status|active|observe|off|calibrate]', text: 'Jev routing' },
      { cmd: '/nexus cache [on|off]', text: 'Cache Guard status, or turn it on/off' },
      { cmd: '/nexus doctor', text: 'check the install and integrations' },
    ],
  },
  {
    title: 'Help',
    rows: [
      { cmd: '/nexus-help', text: 'this reference' },
      { cmd: '/nexus-about', text: 'what NEXUS is, and how to start' },
    ],
  },
]

export const KEYS: HelpRow[] = [
  { cmd: 'click · ctrl+x tab', text: 'focus the dashboard' },
  { cmd: '1-9', text: 'inspect an agent' },
  { cmd: 's · ⚙', text: 'settings' },
  { cmd: 'b', text: 'back to the diagram' },
  { cmd: 'ctrl+x ← / →', text: 'wider / narrower' },
  { cmd: 'ctrl+x x', text: 'close the dashboard' },
  { cmd: 'esc', text: 'hand the keys back to the prompt' },
]

export type AboutSection = { title: string; lines: string[] }

export const ABOUT: AboutSection[] = [
  {
    title: 'What it is',
    lines: [
      'NEXUS turns Claude Code’s own terminal into a multi-agent command center. Your conversation stays exactly where it is; a live dashboard docks beside it and shows what every model is doing.',
    ],
  },
  {
    title: 'Who does the work',
    lines: [
      'Lead · Sonnet by default (Opus or Fable in stronger modes) reads your request, edits and runs tests.',
      'Agents · Haiku subagents take delegated work in parallel: mapping a repo, searching, reviewing.',
      'Advisor · a stronger model the lead consults before big decisions. It reads the session and never writes code.',
      'Council · read-only Opus reviewers (security, architecture, performance) the lead can launch at a review checkpoint. Adaptive (default): only the one the advisor picks. On: all three. Off: the advisor alone.',
      'Jev · optional. It answers small routing questions (which file, which tool, retry or not). Observe-only by default.',
    ],
  },
  {
    title: 'Modes',
    lines: [
      'Balanced: Sonnet with an Opus advisor (default). Deep Engineering: Opus with a Fable advisor. Maximum Reasoning: Fable with a Fable advisor. NEXUS can suggest a stronger mode for a hard task, and never switches without your yes.',
    ],
  },
  {
    title: 'What the numbers mean',
    lines: [
      'Context: how much of the lead’s context window the conversation fills now, as Claude Code reports it.',
      'Session cost: Claude Code’s own total at API prices. On a subscription this is an estimate, not a charge.',
      'Usage: your plan’s 5-hour and weekly windows, when Claude Code reports them. Nothing is guessed.',
    ],
  },
  {
    title: 'Cache Guard',
    lines: [
      'Optional, off by default. When you step away, it can keep the conversation’s prompt cache warm with small, invisible beats, so your next message does not pay to re-read everything. It only helps if you come back; every beat costs a little.',
    ],
  },
]

export const QUICK_START: HelpRow[] = [
  { cmd: '/nexus', text: 'open the dashboard beside your conversation' },
  { cmd: 'ask for real work', text: 'e.g. “map this repo with subagents, then summarize” and watch the agents run' },
  { cmd: '/nexus-mode', text: 'pick a stronger mode for a hard task; /nexus usage shows what it costs' },
]

/** The NEXUS mark, still: a hub linked to four role-coloured nodes. */
export function Logo({ el }: { el: El }) {
  const { Box, Text } = el
  return (
    <Box flexDirection="column">
      <Text><Text color={C.orange}>•╲</Text><Text> </Text><Text color={C.blue}>╱•</Text></Text>
      <Text><Text>  </Text><Text bold color={C.fg}>◉</Text><Text>  </Text></Text>
      <Text><Text color={C.purple}>•╱</Text><Text> </Text><Text color={C.green}>╲•</Text></Text>
    </Box>
  )
}

function Masthead({ el, subtitle }: { el: El; subtitle: string }) {
  const { Box, Text } = el
  return (
    <Box flexDirection="column" alignItems="center" marginY={1}>
      <Box gap={2} alignItems="center">
        <Logo el={el} />
        <Box flexDirection="column">
          <Text bold color={C.fg}>N E X U S</Text>
          <Text color={C.dim}>{subtitle}</Text>
        </Box>
      </Box>
    </Box>
  )
}

function Section({ el, title }: { el: El; title: string }) {
  const { Box, Text } = el
  return (
    <Box marginTop={1}>
      <Text bold color={C.purple}>{title}</Text>
    </Box>
  )
}

const CMD_W = 32

function Row({ el, row, cmdColor = C.orange }: { el: El; row: HelpRow; cmdColor?: string }) {
  const { Box, Text } = el
  // A command too long for its column takes its own line, never a mid-word wrap.
  if (row.cmd.length > CMD_W - 2) {
    return (
      <Box flexDirection="column" paddingLeft={2}>
        <Text color={cmdColor}>{row.cmd}</Text>
        <Box paddingLeft={CMD_W}><Text color={C.fg}>{row.text}</Text></Box>
      </Box>
    )
  }
  return (
    <Box paddingLeft={2}>
      <Box width={CMD_W} flexShrink={0}><Text color={cmdColor}>{row.cmd}</Text></Box>
      <Box flexShrink={1}><Text color={C.fg}>{row.text}</Text></Box>
    </Box>
  )
}

export function HelpView({ el }: { el: El }) {
  const { Box, Text } = el
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#3a3b4a" paddingX={2} paddingBottom={1}>
      <Masthead el={el} subtitle="Multi-agent command center" />
      {HELP.map(sec => (
        <Box flexDirection="column">
          <Section el={el} title={sec.title} />
          {sec.rows.map(r => <Row el={el} row={r} />)}
        </Box>
      ))}
      <Section el={el} title="Keys (dashboard focused)" />
      {KEYS.map(r => <Row el={el} row={r} cmdColor={C.blue} />)}
    </Box>
  )
}

export function AboutView({ el }: { el: El }) {
  const { Box, Text } = el
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#3a3b4a" paddingX={2} paddingBottom={1}>
      <Masthead el={el} subtitle="Multi-agent command center" />
      {ABOUT.map(sec => (
        <Box flexDirection="column">
          <Section el={el} title={sec.title} />
          {sec.lines.map(line => (
            <Box paddingLeft={2}><Text color={C.fg}>{line}</Text></Box>
          ))}
        </Box>
      ))}
      <Section el={el} title="Quick start" />
      {QUICK_START.map((r, i) => (
        <Box paddingLeft={2}>
          <Box width={4} flexShrink={0}><Text color={C.green} bold>{i + 1}.</Text></Box>
          <Box width={22} flexShrink={0}><Text color={C.orange}>{r.cmd}</Text></Box>
          <Box flexShrink={1}><Text color={C.fg}>{r.text}</Text></Box>
        </Box>
      ))}
      <Box marginTop={1}><Text color={C.dim}>/nexus-help lists every command.</Text></Box>
      <Box marginTop={1} justifyContent="center">
        <Text><Text color={C.dim}>Created by </Text><Text bold color={C.fg}>{AUTHOR}</Text></Text>
      </Box>
    </Box>
  )
}

/** A command's reply, drawn as a NEXUS row (Claude Code would label plain text with the plugin id). */
export function OutputView({ el, text }: { el: El; text: string }) {
  const { Box, Text } = el
  const [first = '', ...rest] = text.split('\n')
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="#3a3b4a" paddingX={1}>
      <Text><Text color={C.purple}>◉ </Text><Text bold color={C.fg}>{first}</Text></Text>
      {rest.map(line => (
        <Text color={/^\s*✓/.test(line) ? C.green : /^\s*!/.test(line) ? C.amber : /^\(\/nexus/.test(line) ? C.dim : C.fg}>{line || ' '}</Text>
      ))}
    </Box>
  )
}

// ---- plain text, where nothing draws (claude -p, an SDK host) --------------
export function helpText(): string {
  const out = ['N E X U S · Multi-agent command center', '']
  const row = (r: HelpRow) => (r.cmd.length > CMD_W - 2 ? `  ${r.cmd}\n  ${''.padEnd(CMD_W)}${r.text}` : `  ${r.cmd.padEnd(CMD_W)}${r.text}`)
  for (const sec of HELP) {
    out.push(sec.title)
    for (const r of sec.rows) out.push(row(r))
    out.push('')
  }
  out.push('Keys (dashboard focused)')
  for (const r of KEYS) out.push(row(r))
  return out.join('\n')
}

export function aboutText(): string {
  const out = ['N E X U S · Multi-agent command center', '']
  for (const sec of ABOUT) out.push(sec.title, ...sec.lines.map(l => `  ${l}`), '')
  out.push('Quick start', ...QUICK_START.map((r, i) => `  ${i + 1}. ${r.cmd.padEnd(20)}${r.text}`), '', `Created by ${AUTHOR}`)
  return out.join('\n')
}
