// What swarm-ui keeps in $.state. Every figure comes from an engine event;
// a value the engine never reported stays null and is drawn as N/A.

export type Lead = {
  model: string | null
  effort: string | null
  /** Model requests made by the main loop this session. */
  steps: number
  outputTokens: number
  /** Output tokens of the running turn (for the spinner). */
  turnOutputTokens: number
  /** Tokens the next request re-sends: last response's input + cache + output. */
  contextTokens: number | null
  turnStartedAt: number | null
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
  p: number
  isSharp: boolean
}

export type Jev = {
  status: 'off' | 'on' | 'down'
  reason: string | null
  decisions: number
  /** The latest decision per question ('which file', 'which tool', 'retry or stop'). */
  last: JevDecision[]
}

export type LogRow = {
  at: number
  who: 'jev' | 'opus' | 'sonnet' | 'search' | 'grep' | 'audit' | 'haiku'
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
      tick: number
    }
  }
}
