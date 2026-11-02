// What swarm-ui keeps in $.state. Every figure comes from an engine event;
// a value the engine never reported stays null and is drawn as N/A.
// $.state is the session's own: two sessions never share a value.

export type Lead = {
  /** The model that answered the last request (usage.model), else the session's. */
  model: string | null
  /** What the last request asked for, after this mod's rewrite (if any). */
  requested: string | null
  effort: string | null
  /** Model requests made by the main loop this session. */
  steps: number
  outputTokens: number
  /** Output tokens of the running turn (for the spinner). */
  turnOutputTokens: number
  /** Tokens the next request re-sends: last response's input + cache + output. */
  contextTokens: number | null
  turnStartedAt: number | null
  /** A permission dialog is up: the lead waits on the person, not working. */
  isWaiting: boolean
}

export type Advisor = {
  /** Server-side advisor calls seen in turn.step's serverToolUses. */
  calls: number
  lastAt: number | null
  lastMs: number | null
  /** The lead's context size when the advisor was last called (what it read). */
  contextAtCall: number | null
  /** The latest consultations, newest last: when, how long, the lead's context then. */
  history: { at: number; ms: number | null; context: number | null }[]
}

export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type SwarmAgent = {
  id: string
  type: string
  /** This instance's own name: the type's short name and its spawn number (`search#2`). */
  label: string
  /** One of the configured swarm agents (`swarm-*`); anything else is a fallback agent. */
  isSwarm: boolean
  description: string
  /** The first line of the prompt it was given. */
  prompt: string
  model: string | null
  status: 'running' | 'done' | 'failed' | 'cancelled'
  /** Model requests the agent made (turn.step with its agentId). */
  steps: number
  /** The agent definition's maxTurns, when it declares one. */
  maxTurns: number | null
  tools: number
  lastTool: string | null
  isWorktree: boolean
  startedAt: number
  endedAt: number | null
  /** Files its tool calls named, newest last. */
  files: string[]
  recent: { at: number; text: string }[]
  /** Its last message, as SubagentStop reported it. */
  summary: string | null
  /** Why it failed or was cancelled. */
  reason: string | null
  /** Summed from its own requests (turn.step usage), each counted once. */
  tokens: Tokens
  /** totalTokens as the Agent tool's result reported it, when it did. */
  reportedTokens: number | null
  toolUseId: string | null
}

/** What $.session.usage() last said, and when it was read. */
export type Usage = {
  readAt: number | null
  /** Main thread: input tokens of the last response, the window, the percentage. */
  tokens: number | null
  window: number | null
  percent: number | null
  /** Claude Code's own API-priced total (/cost); not a subscription charge. */
  costUsd: number | null
  limits: { kind: string; percentUsed: number; resetsAt: string | null }[]
  /** The plan as the login names it, only where Claude Code tells a mod; else null. */
  plan: string | null
  compactions: number
}

export type View = { kind: 'diagram' | 'agent' | 'settings' | 'usage' | 'cache'; ref: string | null }

export type JevDecision = {
  at: number
  question: string
  choice: string
  /** probabilities[choice]: what the 0.85 threshold is applied to. */
  p: number
  /** The API's own confidence figure, when it sent one. */
  confidence: number | null
  isSharp: boolean
}

export type Jev = {
  status: 'off' | 'on' | 'down'
  reason: string | null
  decisions: number
  /** The latest decision per question ('which file', 'which tool', 'retry or stop'). */
  last: JevDecision[]
  /** 'which tool' answers compared with the tool the lead actually called. */
  toolChecked: number
  toolAgreed: number
  calls: number
  /** Estimated from the input tokens the API reported. */
  spentUsd: number
  /** off: no calls; observe: drawn only; active: may retry a failed read or attach a hint. */
  routing: 'off' | 'observe' | 'active' | 'calibrating'
  calibration: { passed: boolean; right: number; total: number; unsafe: number; at: number } | null
  /** Hints attached to a read's result, and how many the lead's next read followed. */
  hints: number
  hintsChecked: number
  hintsFollowed: number
  /** Failed reads Jev had re-run, and how many then succeeded. */
  retries: number
  recovered: number
  /** Routable moments where Jev's answer missed the bar (or none came): the lead decided. */
  fallbacks: number
  /** The last routing outcome, for the dashboard. */
  lastRoute: string | null
}

export type ModeId = 'balanced' | 'deep' | 'max'

export type Mode = {
  /** The mode the person chose this session; null = the session as launched. */
  selected: ModeId | null
  /** What the turn.step rewrite asks for; null = no rewrite. */
  main: string | null
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null
  /** The advisor the session runs with (settings, --settings), never written by this mod. */
  sessionAdvisor: string | null
  /** The model the session was started with ($.session.model()). */
  sessionModel: string | null
  /** A relaunch command that would complete the selected mode, when one is needed. */
  relaunch: string | null
  /** Highest recommendation level the person kept their mode for: not asked again. */
  declinedLevel: number
  /** Haiku classifications spent this session (capped). */
  classified: number
  recentErrors: number
}

export type Fx = {
  kind: 'advisor' | 'spawn' | 'done' | 'jev' | 'mode' | 'route' | 'beat'
  at: number
  ms: number
  /** The agent id, Jev question, ... the effect belongs to. */
  ref: string | null
}

export type LogRow = {
  at: number
  who: 'jev' | 'advisor' | 'lead' | 'search' | 'grep' | 'audit' | 'haiku' | 'mode'
  kind: 'start' | 'done' | 'error' | 'advisor' | 'mode' | 'jev' | 'info'
  text: string
  detail: string
}

export type Prefs = {
  version: 2
  /** auto picks by pane width; full falls back when the pane is too narrow. */
  layout: 'auto' | 'full' | 'compact' | 'minimal'
  /** auto follows Claude Code's reduceMotion; off draws no motion and runs no timer. */
  animation: 'auto' | 'full' | 'reduced' | 'off'
  agentDetail: 'brief' | 'full'
  /** The orbit animation: tight and quick, or wide and slow. */
  orbitStyle: 'tight' | 'wide'
  telemetry: { context: boolean; cost: boolean; usage: boolean; tokens: boolean }
  /** Session log rows above the prompt, 0 to 6. */
  logRows: number
  /** The width the pane asks for when it opens (a width dragged or keyed in Claude Code wins). */
  paneColumns: number
  jev: 'bars' | 'line' | 'hidden'
  escalation: 'ask' | 'off'
  cacheGuard: {
    enabled: boolean
    /** Minutes of verified inactivity before a beat (5 to 55). */
    idleMin: number
    /** Hours after which it stops by itself (1 to 24). */
    maxHours: number
    /** Beats per session (1 to 50). */
    maxBeats: number
    /** API-priced estimate per session, USD. */
    budgetUsd: number
    /** Arm without TTL evidence: the person states their cache lasts an hour. */
    trustTtl: boolean
  }
}

export type ModelRow = Tokens & { requests: number; leadRequests: number; agentRequests: number }

export type GuardStatus = 'OFF' | 'ARMED' | 'REFRESHING' | 'WARM' | 'EXPIRED' | 'PAUSED' | 'ERROR'

export type GuardTokens = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type Guard = {
  status: GuardStatus
  /** Why it is in that state, in a few words. */
  reason: string | null
  /** When it was first armed this session: the hours cap counts from here. */
  armedAt: number | null
  /** The end of the lead's last real turn: idle time counts from here. */
  activityAt: number | null
  nextAt: number | null
  beats: number
  lastBeatAt: number | null
  tokens: GuardTokens
  /** Claude Code's own cost ledger, before and after each beat. */
  usd: number
  /** What the last beat cost: the next one is expected to cost about the same. */
  lastBeatUsd: number | null
  /** The share of the last beat's input the cache served. */
  lastBeatRead: number | null
  /** The share of the first real request after a beat the cache served. */
  afterBeatRead: number | null
  isAwaitingProof: boolean
  /** What this session has shown of its cache lifetime. */
  ttl: '1h' | '5m' | 'unverified'
  ttlSource: string | null
  errors: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'swarm-ui': {
      lead: Shaped<Lead>
      advisor: Shaped<Advisor>
      agents: Shaped<SwarmAgent[]>
      view: Shaped<View>
      prefs: Shaped<Prefs>
      usage: Shaped<Usage>
      models: Shaped<Record<string, ModelRow>>
      guard: Shaped<Guard>
      jev: Shaped<Jev>
      log: Shaped<LogRow[]>
      mode: Shaped<Mode>
      fx: Shaped<Fx[]>
      reduceMotion: boolean
      tick: number
    }
  }
}
