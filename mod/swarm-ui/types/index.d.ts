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
}

export type SwarmAgent = {
  id: string
  type: string
  description: string
  model: string | null
  status: 'running' | 'done'
  /** Model requests the agent made (turn.step with its agentId). */
  steps: number
  /** The agent definition's maxTurns, when it declares one. */
  maxTurns: number | null
  tools: number
  lastTool: string | null
  isWorktree: boolean
  startedAt: number
  endedAt: number | null
}

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
  kind: 'advisor' | 'spawn' | 'done' | 'jev' | 'mode'
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

declare module 'claude-code' {
  interface PluginState {
    'swarm-ui': {
      lead: Shaped<Lead>
      advisor: Shaped<Advisor>
      agents: Shaped<SwarmAgent[]>
      jev: Shaped<Jev>
      log: Shaped<LogRow[]>
      mode: Shaped<Mode>
      fx: Shaped<Fx[]>
      reduceMotion: boolean
      tick: number
    }
  }
}
