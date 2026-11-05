// The Test agent's command gate. Pure.
//
// What this is: a deterministic second check on the Bash calls of the `nexus-test` agent. A call
// must be one known test command with only flags that runner is listed as accepting, each with a
// value of the right kind (a number, a name from a short list, a test filter, a repository path).
// An unknown flag is refused, not guessed at: runners accept flags that run code, write files or
// reach the network, and a list of banned flags cannot keep up. It is checked by NEXUS on top of
// Claude Code's own permissions (the engine still asks the person as it always does); it never
// grants more than the lead already has.
//
// What this is not: isolation. A test command runs the project's own test code with the lead's
// permissions, so that code can do whatever the lead may do; a build tool may also fetch the
// project's declared dependencies. The gate limits what the *agent* can ask for, not what the
// project's tests do once started.

import { isSecretPath } from './council'

export type Verdict = { ok: true; runner: string } | { ok: false; why: string }

/** Tests never run longer than this, whatever the agent asks for (ms). */
export const MAX_TIMEOUT_MS = 300_000
export const DEFAULT_TIMEOUT_MS = 120_000

/** The only tools the Test agent may call, whatever its definition lists (an MCP tool, Skill or a future tool is refused). */
export const ALLOWED_TOOLS = ['Read', 'Glob', 'Grep', 'Bash', 'SubagentHandback'] as const

/** Bash input fields that would loosen a sandbox or a permission: dropped from the call. */
export const LOOSENING = /sandbox|dangerous|disable|unsafe|bypass/i

// ---- tokenising: quotes group words; nothing is expanded --------------------------------------
export type Word = { text: string; quoted: boolean }

/** Words of a command, or why it is not one plain command. */
export function words(command: string): { words: Word[] } | { error: string } {
  if (/[\n\r\0]/.test(command)) return { error: 'one single-line command only' }
  const out: Word[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  let quoted = false
  let open = false
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = null
      else if (ch === '$' || ch === '`' || ch === '\\') return { error: `${ch === '\\' ? 'a backslash' : ch === '$' ? '$' : 'a backtick'} inside quotes is not accepted` }
      else cur += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      quoted = true
      open = true
      continue
    }
    if (/\s/.test(ch)) {
      if (open) out.push({ text: cur, quoted })
      cur = ''
      quoted = false
      open = false
      continue
    }
    // Shell syntax: chaining, pipes, redirects, substitution, globs, brackets and variables.
    if (/[;&|<>`$\\(){}[\]*?~!#]/.test(ch)) return { error: `shell syntax (${ch}) is not accepted: give one plain test command` }
    cur += ch
    open = true
  }
  if (quote) return { error: 'an unclosed quote' }
  if (open) out.push({ text: cur, quoted })
  return { words: out }
}

// ---- values ------------------------------------------------------------------------------------
type Kind = 'bool' | 'int' | 'duration' | 'filter' | 'path' | `enum:${string}`

/** A path that stays inside the repository and is not a secret. */
function pathProblem(w: string): string | null {
  if (!/^[A-Za-z0-9_.@%+=,:/-]{1,200}$/.test(w)) return `${w.slice(0, 40)} is not a plain relative path`
  if (w.startsWith('/') || w.startsWith('~') || /(^|\/)\.\.(\/|$)/.test(w)) return `${w} is outside the repository: use a relative path inside it`
  // A URL or a package specifier would fetch and run code from outside the repository.
  if (w.includes('://') || /^(npm|jsr|data|file|git|https?|ftp|ssh):/i.test(w)) return `${w.slice(0, 40)} is not a path inside the repository`
  // `NAME=value` as a word sets the environment of the command (make passes it to recipes).
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) return 'setting environment variables is not accepted'
  if (isSecretPath(w) || /(^|\/)(\.env(\..*)?|\.npmrc|\.netrc|\.pypirc|credentials[^/]*|id_(rsa|ecdsa|ed25519)[^/]*|[^/]*\.(pem|key|p12|pfx))$/i.test(w)) return `${w} looks like a secret file`
  return null
}

/** Whether `v` is a good value of `kind`; a reason when not. */
function valueProblem(kind: Kind, v: string, flag: string): string | null {
  switch (kind) {
    case 'bool':
      return `${flag} takes no value`
    case 'int':
      return /^\d{1,6}$/.test(v) ? null : `${flag} takes a number`
    case 'duration':
      return /^\d{1,6}(ms|s|m|h)$/.test(v) ? null : `${flag} takes a duration like 30s`
    case 'filter':
      // A test name or expression: letters, digits, spaces and the few marks names use. Never shell or path syntax.
      return /^[A-Za-z0-9_ .,:()|^+=/#\-]{1,200}$/.test(v) && !/(^|\/)\.\.(\/|$)/.test(v) ? null : `${flag} takes a test name or expression`
    case 'path':
      return pathProblem(v)
    default: {
      const ok = kind.slice(5).split('|')
      return ok.includes(v) ? null : `${flag} takes ${ok.join(' | ')}`
    }
  }
}

// ---- one table: what each runner accepts -------------------------------------------------------
type Spec = {
  /** Words that must come first (any one of these sequences). */
  lead?: string[][]
  /** Flags by exact name, and the kind of value each takes. Anything not here is refused. */
  flags?: Record<string, Kind>
  /** Single letters that may be joined into one flag (`-xvs`). */
  joined?: string
  /** What may follow: repository paths or test names. */
  positional?: 'path' | 'none'
  /** For build tools: the only targets allowed, at least one, flags anywhere (make test, mvn -q test). */
  goals?: string[]
  /** `run test` or `run test:<name>` after the tool (npm, pnpm, yarn, bun). */
  runScript?: boolean
  /** Flags that may come after a bare `--` (cargo's test-binary arguments). */
  after?: Record<string, Kind>
}

const NPM: Spec = { lead: [['test'], ['t']], runScript: true, positional: 'path' }
const JEST: Spec = {
  flags: { '--runInBand': 'bool', '-i': 'bool', '--silent': 'bool', '--verbose': 'bool', '--bail': 'bool', '-b': 'bool', '--ci': 'bool', '--passWithNoTests': 'bool', '-t': 'filter', '--testNamePattern': 'filter', '--testPathPattern': 'filter', '--maxWorkers': 'int' },
  positional: 'path',
}
const VITEST: Spec = { lead: [['run']], flags: { '--silent': 'bool', '--bail': 'int', '--passWithNoTests': 'bool', '-t': 'filter', '--testNamePattern': 'filter', '--reporter': 'enum:default|verbose|dot|basic' }, positional: 'path' }
const MOCHA: Spec = { flags: { '--bail': 'bool', '--recursive': 'bool', '--exit': 'bool', '--grep': 'filter', '-g': 'filter', '--timeout': 'int', '--reporter': 'enum:spec|dot|min|list|tap|progress' }, positional: 'path' }
const PYTEST: Spec = {
  flags: { '-x': 'bool', '--exitfirst': 'bool', '-q': 'bool', '--quiet': 'bool', '-v': 'bool', '-vv': 'bool', '-s': 'bool', '--lf': 'bool', '--ff': 'bool', '--last-failed': 'bool', '--failed-first': 'bool', '--collect-only': 'bool', '--co': 'bool', '--no-header': 'bool', '--disable-warnings': 'bool', '-k': 'filter', '-m': 'filter', '--maxfail': 'int', '--durations': 'int', '-n': 'int', '--tb': 'enum:auto|long|short|line|native|no' },
  joined: 'xqvs',
  positional: 'path',
}
const UNITTEST: Spec = { lead: [['discover'], []], flags: { '-v': 'bool', '-b': 'bool', '-f': 'bool', '-k': 'filter', '-s': 'path', '-t': 'path' }, positional: 'path' }
const GO: Spec = {
  lead: [['test']],
  flags: { '-v': 'bool', '-short': 'bool', '-race': 'bool', '-failfast': 'bool', '-run': 'filter', '-skip': 'filter', '-count': 'int', '-parallel': 'int', '-p': 'int', '-timeout': 'duration', '-shuffle': 'enum:on|off', '-json': 'bool' },
  positional: 'path',
}
const CARGO: Spec = {
  lead: [['test'], ['nextest', 'run']],
  flags: { '--lib': 'bool', '--bins': 'bool', '--doc': 'bool', '--workspace': 'bool', '--all-features': 'bool', '--no-fail-fast': 'bool', '--quiet': 'bool', '-q': 'bool', '--offline': 'bool', '--package': 'path', '-p': 'path', '--test': 'path' },
  positional: 'path',
  after: { '--nocapture': 'bool', '--show-output': 'bool', '--ignored': 'bool', '--exact': 'bool', '--test-threads': 'int' },
}
const MVN: Spec = { goals: ['test', 'verify'], flags: { '-q': 'bool', '-B': 'bool', '-o': 'bool', '-pl': 'path', '-Dtest': 'filter', '-DfailIfNoTests': 'enum:true|false' } }
const GRADLE: Spec = { goals: ['test'], flags: { '--tests': 'filter', '--offline': 'bool', '-q': 'bool', '--quiet': 'bool', '--continue': 'bool', '--info': 'bool' } }

const RUNNERS: Record<string, Spec> = {
  npm: NPM,
  pnpm: NPM,
  yarn: NPM,
  bun: { lead: [['test']], runScript: true, flags: { '--bail': 'bool', '--timeout': 'int', '-t': 'filter' }, positional: 'path' },
  deno: { lead: [['test']], flags: { '--filter': 'filter', '--fail-fast': 'bool', '--quiet': 'bool' }, positional: 'path' },
  pytest: PYTEST,
  go: GO,
  cargo: CARGO,
  swift: { lead: [['test']], flags: { '--filter': 'filter', '--parallel': 'bool' }, positional: 'none' },
  dotnet: { lead: [['test']], flags: { '--filter': 'filter', '--no-restore': 'bool', '--no-build': 'bool', '--verbosity': 'enum:quiet|minimal|normal' }, positional: 'path' },
  mvn: MVN,
  gradle: GRADLE,
  './gradlew': GRADLE,
  gradlew: GRADLE,
  rspec: { flags: { '--fail-fast': 'bool', '--format': 'enum:progress|documentation|json', '--seed': 'int', '-e': 'filter' }, positional: 'path' },
  rake: { goals: ['test', 'spec'] },
  phpunit: { flags: { '--filter': 'filter', '--stop-on-failure': 'bool', '--testdox': 'bool' }, positional: 'path' },
  jest: JEST,
  vitest: VITEST,
  mocha: MOCHA,
  ava: { flags: { '--verbose': 'bool', '--fail-fast': 'bool' }, positional: 'path' },
  tap: { positional: 'path' },
  make: { goals: ['test', 'check'] },
  ctest: { flags: { '-R': 'filter', '-j': 'int', '--output-on-failure': 'bool' }, positional: 'none' },
  claude: { lead: [['plugin', 'test']], positional: 'path' },
}

/** `bundle exec rspec|rake test`: the same rules as the bare command. */
const BUNDLE: Record<string, string> = { rspec: 'rspec', rake: 'rake' }

/** What `npx --no-install <runner>` may run: the same specs. Never a package npx would download. */
const NPX: Record<string, Spec> = {
  jest: JEST,
  vitest: VITEST,
  mocha: MOCHA,
  ava: RUNNERS.ava!,
  tap: RUNNERS.tap!,
  playwright: { lead: [['test']], flags: { '--grep': 'filter', '--reporter': 'enum:list|line|dot', '--workers': 'int', '--retries': 'int' }, positional: 'path' },
}

function check(spec: Spec, args: Word[]): string | null {
  let rest = args
  if (spec.runScript && rest[0]?.text === 'run') {
    if (!/^test(:[\w-]+)?$/.test(rest[1]?.text ?? '')) return 'only the project’s test script is accepted (`test` or `run test[:name]`)'
    rest = rest.slice(2)
  } else if (spec.lead) {
    const hit = spec.lead.find(seq => seq.every((w, i) => rest[i]?.text === w))
    if (!hit) return `only ${spec.lead.map(s => `\`${s.join(' ') || '…'}\``).join(' or ')}${spec.runScript ? ' or `run test[:name]`' : ''} is accepted here`
    rest = rest.slice(hit.length)
  }
  let goals = 0
  let inAfter = false
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i]!.text
    if (w === '--') {
      if (!spec.after || inAfter) return 'a bare `--` (arguments for another program) is not accepted'
      inAfter = true
      continue
    }
    if (w.startsWith('-')) {
      const table = inAfter ? spec.after! : (spec.flags ?? {})
      const eq = w.indexOf('=')
      const name = eq > 0 ? w.slice(0, eq) : w
      let kind = table[name]
      if (!kind && spec.joined && !inAfter && /^-[a-zA-Z]+$/.test(w) && [...w.slice(1)].every(c => spec.joined!.includes(c))) kind = 'bool'
      if (!kind) return `${name} is not an accepted flag for this test command (it may run code, write files or use the network)`
      if (kind === 'bool') {
        if (eq > 0) return `${name} takes no value`
        continue
      }
      let value: string
      if (eq > 0) value = w.slice(eq + 1)
      else {
        const next = rest[i + 1]
        if (!next || next.text.startsWith('-')) return `${name} needs a value`
        value = next.text
        i++
      }
      const bad = valueProblem(kind, value, name)
      if (bad) return bad
      continue
    }
    if (spec.goals) {
      if (!spec.goals.includes(w)) return `only ${spec.goals.map(g => `\`${g}\``).join(' or ')} is accepted as a target (not ${w.slice(0, 30)})`
      goals++
      continue
    }
    if (spec.positional !== 'path') return `${w.slice(0, 40)}: this command takes no extra words`
    // A positional word: a path or a test name. Quoting may carry spaces and brackets (a test id); nothing else.
    if (rest[i]!.quoted && /^[A-Za-z0-9_.@%+=,:/ [\]#-]{1,200}$/.test(w) && !/(^|\/)\.\.(\/|$)/.test(w) && !pathProblem(w.replace(/[ [\]#]/g, '_'))) continue
    const bad = pathProblem(w)
    if (bad) return bad
  }
  if (spec.goals && goals === 0) return `name the target: ${spec.goals.map(g => `\`${g}\``).join(' or ')}`
  return null
}

/** Whether `command` is a known test command the Test agent may run, in one plain piece. */
export function judgeCommand(command: unknown): Verdict {
  if (typeof command !== 'string' || !command.trim()) return { ok: false, why: 'no command given' }
  if (command.length > 400) return { ok: false, why: 'the command is too long for a test command' }
  const parsed = words(command.trim())
  if ('error' in parsed) return { ok: false, why: parsed.error }
  const ws = parsed.words
  if (ws.length === 0) return { ok: false, why: 'no command given' }
  const head = ws[0]!.text
  // `FOO=bar cmd` would set the environment (INSTA_UPDATE, NODE_OPTIONS...): not accepted.
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(head)) return { ok: false, why: 'setting environment variables is not accepted' }
  if (ws[0]!.quoted) return { ok: false, why: 'the command name itself cannot be quoted' }
  let why: string | null
  let runner = head
  if (head === 'npx') {
    // npx can download and run a package: only with --no-install, and only a known runner.
    if (ws[1]?.text !== '--no-install' && ws[1]?.text !== '--no') return { ok: false, why: 'npx can download code: use `npx --no-install <runner>` or `npm test`' }
    const r = ws[2]?.text ?? ''
    const spec = NPX[r]
    if (!spec) return { ok: false, why: `npx --no-install ${r || '…'} is not a known test runner` }
    runner = `npx ${r}`
    why = check(spec, ws.slice(3))
  } else if (head === 'python' || head === 'python3' || head === 'py') {
    const mod = ws[1]?.text === '-m' ? ws[2]?.text : undefined
    if (mod !== 'pytest' && mod !== 'unittest') return { ok: false, why: 'only `-m pytest` or `-m unittest`' }
    runner = `${head} -m ${mod}`
    why = check(mod === 'pytest' ? PYTEST : UNITTEST, ws.slice(3))
  } else if (head === 'bundle') {
    const target = BUNDLE[ws[2]?.text ?? '']
    if (ws[1]?.text !== 'exec' || !target) return { ok: false, why: 'only `bundle exec rspec` or `bundle exec rake test`' }
    runner = `bundle exec ${target}`
    why = check(RUNNERS[target]!, ws.slice(3))
  } else {
    const spec = RUNNERS[head]
    if (!spec) return { ok: false, why: `\`${head}\` is not a known test command (npm/pnpm/yarn test, pytest, go test, cargo test, vitest run, jest, make test, claude plugin test…)` }
    why = check(spec, ws.slice(1))
  }
  return why ? { ok: false, why } : { ok: true, runner }
}

/** The timeout the call will run with: the agent's own, never over the cap, never none. */
export function cappedTimeout(asked: unknown): number {
  const n = typeof asked === 'number' && Number.isFinite(asked) && asked > 0 ? asked : DEFAULT_TIMEOUT_MS
  return Math.min(n, MAX_TIMEOUT_MS)
}

// ---- the agent's report ------------------------------------------------------------------------
export type Report = { result: 'passed' | 'failed' | 'not run' | null; passed: number | null; failed: number | null; skipped: number | null }

/** What the agent said it ran and found, from its own `result:` and count lines. Missing is null, never zero. */
export function parseReport(text: string | null | undefined): Report {
  const t = text ?? ''
  const r = /^\s*result:\s*(passed|failed|not run)\b/im.exec(t)?.[1]?.toLowerCase() as Report['result'] | undefined
  const n = (k: string) => {
    const m = new RegExp(`\\b${k}:\\s*(\\d+)`, 'i').exec(t)
    return m ? Number(m[1]) : null
  }
  return { result: r ?? null, passed: n('passed'), failed: n('failed'), skipped: n('skipped') }
}

/** A one-line summary for the activity tape; never more than the report said. */
export function reportLine(label: string, rep: Report): string {
  if (rep.result === null) return `${label} finished · no result line in its report`
  const counts = [rep.failed !== null ? `${rep.failed} failed` : null, rep.passed !== null ? `${rep.passed} passed` : null, rep.skipped ? `${rep.skipped} skipped` : null].filter(Boolean)
  return `${label} ${rep.result}${counts.length ? ` · ${counts.join(', ')}` : ''}`
}
