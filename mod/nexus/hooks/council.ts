// NEXUS Council: three read-only Opus reviewers the lead can call at a review
// checkpoint, and the deterministic router that decides what extra capability
// a reviewer may use. Pure: prompts, parsing, validation, merging, rules.
// Inspired by Karpathy's LLM Council (independent reviews, then synthesis);
// the specialisations, activation modes and routing are NEXUS's own.
import type { Checkpoint, Council, CouncilRole, Finding, Grant, Reviewer, Tokens } from '../types'

export const ROLES: readonly CouncilRole[] = ['security', 'architecture', 'performance']

export const ROLE_LABEL: Record<CouncilRole, string> = {
  security: 'SECURITY',
  architecture: 'ARCHITECTURE',
  performance: 'PERFORMANCE',
}

/** The engine names a plugin's agent `<plugin>:<name>`. */
export const AGENT_NAME: Record<CouncilRole, string> = {
  security: 'council-security',
  architecture: 'council-architecture',
  performance: 'council-performance',
}
export const agentType = (role: CouncilRole) => `nexus:${AGENT_NAME[role]}`
export const isCouncilType = (type: string) => type.startsWith('nexus:council-')
export const roleOfType = (type: string): CouncilRole | null => ROLES.find(r => agentType(r) === type) ?? null

export const COUNCIL_TOOL = 'mcp__nexus__council_review'
export const REQUEST_TOOL = 'mcp__nexus__request_capability'
export const GIT_TOOL = 'mcp__nexus__git_read'

/** What every reviewer starts with: enforced by the agent definition, then by the tool.call hook. */
export const BASE_TOOLS = ['Read', 'Grep', 'Glob'] as const
/** Listed in the definition so a grant can take effect, but refused until the router grants it. */
export const GRANTABLE_TOOLS = [GIT_TOOL] as const
/** Withheld outright: never callable by a reviewer, whatever it asks. */
export const WITHHELD_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'BashOutput', 'KillShell', 'WebFetch', 'WebSearch', 'Agent', 'Task', 'TodoWrite'] as const

export const ON_WARNING =
  '⚠ Higher token usage: Full Council runs three Opus reviewers per eligible review. Use Adaptive for lower token consumption.'

const FOCUS: Record<CouncilRole, string> = {
  security:
    'vulnerabilities, unsafe operations, injection (shell, SQL, path, prompt), authentication and authorisation, credential or secret exposure, unsafe deserialisation, dependency risk, and security-sensitive behaviour changes',
  architecture:
    'structure, modularity, interfaces and abstractions, coupling, error handling and failure modes, concurrency and ordering, state ownership, integration with existing code, and unnecessary complexity',
  performance:
    'algorithmic complexity, memory use and allocations, repeated or blocking I/O, unbounded growth, hot-path overhead and scalability. Report only what the code shows: no speculative optimisation without evidence in the diff or the files',
}

/** The reviewer's system prompt: its role, its limits and its answer format. */
export function reviewerSystemPrompt(role: CouncilRole): string {
  return [
    `You are the ${ROLE_LABEL[role]} reviewer of NEXUS Council, an independent, read-only code reviewer running on Opus inside Claude Code.`,
    `Review only for: ${FOCUS[role]}.`,
    'You never modify anything. You have Read, Grep and Glob. If you need git history, call mcp__nexus__request_capability with capability "git_read" and a reason; once granted, mcp__nexus__git_read runs fixed read-only git commands. Requests for anything else are refused.',
    'Do not open secrets (.env files, keys, certificates, credentials). Do not spawn agents or ask for another review.',
    'Every finding must point at code you actually read. Quote the evidence. Say how the lead can verify it. Prefer few, real findings over many speculative ones; an empty list is a valid answer.',
    'End your answer with exactly one fenced ```json block holding an array of findings, each:',
    '{"severity": "critical|high|medium|low|info", "file": "path relative to the repository root", "line": 123, "title": "one line", "evidence": "what the code shows", "action": "recommended fix or how to verify", "confidence": 0.0-1.0}',
  ].join('\n')
}

export type Snapshot = {
  hash: string
  diff: string
  untracked: string[]
  files: string[]
  isTruncated: boolean
  /** Untracked files left out because they look like secrets. */
  withheld?: number
}

/** Diff text a reviewer gets in its prompt; past this it is told the rest was cut and to Read the files. */
export const DIFF_CHARS = 60_000

/** The task one reviewer is spawned with: the fixed snapshot, bounded, and what the lead asked. */
export function reviewerTask(role: CouncilRole, snap: Snapshot, summary: string, rationale: string | null): string {
  const diff = snap.diff.length > DIFF_CHARS ? snap.diff.slice(0, DIFF_CHARS) : snap.diff
  const cut = snap.isTruncated || snap.diff.length > DIFF_CHARS
  return [
    `Review this change as the ${ROLE_LABEL[role]} reviewer. Snapshot ${snap.hash}.`,
    summary ? `What the lead says it changed: ${summary}` : '',
    rationale ? `Why you were asked: ${rationale}` : '',
    `Changed files: ${snap.files.join(', ') || 'none listed'}`,
    snap.untracked.length ? `New untracked files (not in the diff; Read them): ${snap.untracked.join(', ')}` : '',
    snap.withheld ? `${snap.withheld} untracked file(s) that look like secrets were withheld; do not try to read them.` : '',
    cut ? `The diff below is TRUNCATED at ${DIFF_CHARS} characters. Read the changed files for the rest; do not assume what you cannot see.` : '',
    '```diff',
    diff || '(no tracked changes)',
    '```',
  ]
    .filter(Boolean)
    .join('\n')
}

/** FNV-1a over the snapshot: equal text, equal hash. */
export function hashText(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** Files a `git diff` names, in order, once each. */
export function diffFiles(diff: string): string[] {
  const out: string[] = []
  for (const m of diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)) {
    const f = m[2]!
    if (!out.includes(f)) out.push(f)
  }
  return out
}

/**
 * The advisor's pick, as the lead relayed it. Anything unreadable is `none`:
 * a parse failure never launches all three.
 */
export function parseSelection(selection: unknown): CouncilRole | 'none' {
  if (typeof selection !== 'string') return 'none'
  const s = selection.trim().toLowerCase()
  const word = s.replace(/^council\s*:\s*/, '').split(/[\s—–\-:,.]+/)[0] ?? ''
  return (ROLES as readonly string[]).includes(word) ? (word as CouncilRole) : 'none'
}

/** Which reviewers a checkpoint launches: never more than the mode allows. */
export function reviewersFor(activation: 'off' | 'adaptive' | 'on', pick: CouncilRole | 'none'): CouncilRole[] {
  if (activation === 'on') return [...ROLES]
  if (activation === 'adaptive') return pick === 'none' ? [] : [pick]
  return []
}

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const

/** The findings in a reviewer's answer: the last ```json block (or a bare array). Null when none parses. */
export function parseFindings(answer: string, role: CouncilRole): Omit<Finding, 'ref'>[] | null {
  const blocks = [...answer.matchAll(/```json\s*([\s\S]*?)```/g)].map(m => m[1]!)
  const candidates = blocks.length ? [blocks.at(-1)!] : [answer.slice(answer.indexOf('['), answer.lastIndexOf(']') + 1)]
  for (const raw of candidates) {
    let data: unknown
    try {
      data = JSON.parse(raw.trim())
    } catch {
      continue
    }
    if (!Array.isArray(data)) continue
    return data.flatMap(item => {
      if (!item || typeof item !== 'object') return []
      const f = item as Record<string, unknown>
      const title = typeof f.title === 'string' ? f.title.trim() : ''
      if (!title) return []
      const severity = (SEVERITIES as readonly string[]).includes(String(f.severity).toLowerCase()) ? (String(f.severity).toLowerCase() as Finding['severity']) : 'info'
      const line = typeof f.line === 'number' && Number.isInteger(f.line) && f.line > 0 ? f.line : null
      const confidence = typeof f.confidence === 'number' && f.confidence >= 0 && f.confidence <= 1 ? f.confidence : null
      return [{
        role,
        alsoBy: [],
        severity,
        file: typeof f.file === 'string' && f.file.trim() ? f.file.trim().replace(/^\.\//, '') : null,
        line,
        title: redact(title).slice(0, 200),
        evidence: typeof f.evidence === 'string' ? redact(f.evidence.trim()).slice(0, 600) : '',
        action: typeof f.action === 'string' ? redact(f.action.trim()).slice(0, 400) : '',
        confidence,
      }]
    })
  }
  return null
}

/** Emails, credential assignments and long token-like strings, masked before NEXUS shows or returns a finding. */
export function redact(text: string): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email redacted]')
    .replace(/\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_KEY)[A-Z0-9_]*)\s*[=:]\s*\S+/gi, '$1=[redacted]')
    .replace(/\b(?:sk|ghp|gho|xox[abprs]|AKIA)[A-Za-z0-9_-]{10,}\b/g, '[token redacted]')
    .replace(/\b[A-Za-z0-9_\-]{40,}\b/g, '[long token redacted]')
}

/** A reviewer's path as the repository names it: absolute paths under the root lose the root. */
export function relPath(file: string | null, root: string): string | null {
  if (!file) return file
  const r = root.endsWith('/') ? root : `${root}/`
  return root && file.startsWith(r) ? file.slice(r.length) : file
}

/** Paths a reviewer may not read and NEXUS will not quote. */
export function isSecretPath(path: string): boolean {
  const base = path.split('/').pop() ?? path
  return /^\.env(\..*)?$/i.test(base) || /\.(pem|key|p12|pfx|keychain(-db)?)$/i.test(base) || /^id_(rsa|ecdsa|ed25519)/.test(base) || /(^|\/)(secrets?|credentials)(\/|$)/i.test(path) || /^credentials.*\.json$/i.test(base) || /\.netrc$|\.npmrc$|\.pypirc$/.test(base)
}

/** Checks each finding's reference against the files as they are now: `lines` maps file → its line count, or null when unreadable. */
export function checkRefs(findings: Omit<Finding, 'ref'>[], lines: Record<string, number | null>): Finding[] {
  return findings.map(f => {
    if (!f.file) return { ...f, ref: 'no-ref' as const }
    if (isSecretPath(f.file)) return { ...f, evidence: '(withheld: secret path)', ref: 'secret-path' as const }
    const n = lines[f.file]
    if (n === null || n === undefined) return { ...f, ref: 'missing-file' as const }
    if (f.line !== null && f.line > n) return { ...f, ref: 'line-out-of-range' as const }
    return { ...f, ref: 'ok' as const }
  })
}

const words = (t: string) => new Set(t.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])
function similar(a: string, b: string): boolean {
  const x = words(a)
  const y = words(b)
  if (!x.size || !y.size) return false
  let both = 0
  for (const w of x) if (y.has(w)) both++
  return both / Math.min(x.size, y.size) >= 0.6
}

/** One entry per issue: same file, lines within 3, similar titles. The higher severity and every reporter are kept. */
export function dedupe(findings: Finding[]): Finding[] {
  const rank = (s: Finding['severity']) => SEVERITIES.indexOf(s)
  const out: Finding[] = []
  for (const f of findings) {
    const twin = out.find(
      g => g.file === f.file && (g.line === null || f.line === null || Math.abs(g.line - f.line) <= 3) && similar(g.title, f.title),
    )
    if (!twin) {
      out.push({ ...f, alsoBy: [...f.alsoBy] })
      continue
    }
    if (twin.role !== f.role && !twin.alsoBy.includes(f.role)) twin.alsoBy.push(f.role)
    if (rank(f.severity) < rank(twin.severity)) twin.severity = f.severity
    if (f.evidence.length > twin.evidence.length) twin.evidence = f.evidence
  }
  return out.sort((a, b) => rank(a.severity) - rank(b.severity))
}

/** The verdict the lead gets back: what ran, how each run ended, the merged findings as claims to verify. */
export function verdictText(cp: Checkpoint, reviewers: Reviewer[]): string {
  const lines: string[] = []
  lines.push(`NEXUS Council · snapshot ${cp.hash} · ${cp.activation}${cp.activation === 'adaptive' ? ` (advisor pick: ${cp.selection})` : ''}`)
  if (cp.status === 'skipped' || cp.status === 'refused') {
    lines.push(cp.reason ?? cp.status)
    return lines.join('\n')
  }
  for (const r of reviewers) {
    const state = r.status === 'done' ? `done · ${r.findings ?? 0} finding${r.findings === 1 ? '' : 's'}` : `${r.status.toUpperCase()}${r.reason ? `: ${r.reason}` : ''}`
    lines.push(`- ${ROLE_LABEL[r.role]}: ${state}`)
  }
  if (cp.isStale) lines.push('STALE: the working tree changed while the council reviewed; re-check every finding against the current code.')
  if (cp.isTruncated) lines.push('The diff was truncated for the reviewers; they were told to read the files for the rest.')
  if (!cp.findings.length) {
    lines.push('No findings.')
  } else {
    lines.push('Findings (claims to verify before acting; same-model agreement is not independent proof):')
    for (const f of cp.findings) {
      const at = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : 'no file reference'
      const refNote = f.ref === 'ok' || f.ref === 'no-ref' ? '' : ` [reference ${f.ref}]`
      const by = [f.role, ...f.alsoBy].join('+')
      const conf = f.confidence === null ? '' : ` · confidence ${f.confidence.toFixed(2)}`
      lines.push(`${f.severity.toUpperCase()} · ${by} · ${at}${refNote}${conf}`)
      lines.push(`  ${f.title}`)
      if (f.evidence) lines.push(`  evidence: ${f.evidence}`)
      if (f.action) lines.push(`  action: ${f.action}`)
    }
  }
  return lines.join('\n')
}

// ---- tool routing: minimal start, grants by deterministic rule ---------------

export type RouteDecision = { decision: Grant['decision']; rule: string }

/**
 * Whether a reviewer may have `capability`. Rules, in order: anything that can
 * write, run a shell or reach the network is refused; git_read (fixed read-only
 * argv, no shell) is granted; everything else is refused. A model's advice
 * (Jev, a local decision model) may only ever narrow this, never widen it.
 */
export function route(capability: string): RouteDecision {
  const c = capability.trim().toLowerCase()
  if (!c) return { decision: 'deny', rule: 'empty request' }
  if (/write|edit|bash|shell|exec|run|delete|rm|web|fetch|network|agent|task|install/.test(c)) {
    return { decision: 'deny', rule: 'reviewers are read-only: no writes, shell, network or agents' }
  }
  if (c === 'git_read' || c === GIT_TOOL.toLowerCase()) return { decision: 'grant', rule: 'git_read runs fixed read-only git argv' }
  return { decision: 'deny', rule: 'not on the reviewer allowlist' }
}

/** May this reviewer call `tool` now? The definition already withholds the rest; this is the second check. */
export function mayCall(tool: string, granted: readonly string[], input: Record<string, unknown>): { ok: true } | { ok: false; why: string } {
  if ((BASE_TOOLS as readonly string[]).includes(tool)) {
    const path = ['file_path', 'path'].map(k => input[k]).find(v => typeof v === 'string') as string | undefined
    if (path && isSecretPath(path)) return { ok: false, why: `${path} looks like a secret; reviewers do not read secrets` }
    return { ok: true }
  }
  if (tool === REQUEST_TOOL) return { ok: true }
  if ((GRANTABLE_TOOLS as readonly string[]).includes(tool)) {
    return granted.includes(tool) ? { ok: true } : { ok: false, why: `${tool} needs a grant: call ${REQUEST_TOOL} first` }
  }
  return { ok: false, why: `${tool} is not available to council reviewers (read-only)` }
}

/** The fixed argv git_read may run, or why not. Paths and refs are checked; nothing reaches a shell. */
export function gitArgv(op: unknown, target: unknown, ref: unknown): { argv: string[] } | { error: string } {
  const safePath = (p: unknown) => typeof p === 'string' && p.length > 0 && p.length < 300 && !p.startsWith('-') && !p.startsWith('/') && !p.includes('..') && !isSecretPath(p)
  const safeRef = (r: unknown) => typeof r === 'string' && /^[A-Za-z0-9._\/~^-]{1,80}$/.test(r) && !r.startsWith('-')
  if (op === 'log') {
    if (target !== undefined && !safePath(target)) return { error: 'invalid path' }
    return { argv: ['git', 'log', '--oneline', '-n', '20', '--no-color', ...(target ? ['--', String(target)] : [])] }
  }
  if (op === 'show') {
    if (!safeRef(ref)) return { error: 'invalid ref' }
    if (target !== undefined && !safePath(target)) return { error: 'invalid path' }
    return { argv: ['git', 'show', '--no-color', '--stat', '--patch', String(ref), ...(target ? ['--', String(target)] : [])] }
  }
  if (op === 'blame') {
    if (!safePath(target)) return { error: 'invalid path' }
    return { argv: ['git', 'blame', '--no-color', '-w', '--', String(target)] }
  }
  return { error: 'op must be log, show or blame' }
}

// ---- state -------------------------------------------------------------------

const ZERO: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

export const idleReviewer = (role: CouncilRole): Reviewer => ({
  role,
  status: 'idle',
  agentId: null,
  startedAt: null,
  endedAt: null,
  activity: null,
  tools: 0,
  tokens: { ...ZERO },
  findings: null,
  reason: null,
  rationale: null,
})

export const NEW_COUNCIL: Council = {
  reviewers: { security: idleReviewer('security'), architecture: idleReviewer('architecture'), performance: idleReviewer('performance') },
  checkpoint: null,
  reviewed: [],
  granted: {},
  ledger: [],
  reviews: 0,
  launches: 0,
}

/** Tokens the council's reviewers reported, summed: what the panel totals. */
export function councilTokens(c: Council): Tokens {
  return ROLES.reduce(
    (t, r) => {
      const x = c.reviewers[r].tokens
      return { input: t.input + x.input, output: t.output + x.output, cacheRead: t.cacheRead + x.cacheRead, cacheWrite: t.cacheWrite + x.cacheWrite }
    },
    { ...ZERO },
  )
}

/** The instructions the lead (and, reading the session, the advisor) get while Council is on or adaptive. */
export function composeSection(activation: 'adaptive' | 'on', hasAdvisor: boolean): string {
  const lines = [
    `NEXUS Council is ${activation === 'on' ? 'ON (full council)' : 'ADAPTIVE'} in this session.`,
    `At a genuine review checkpoint (you changed code in a meaningful way and ${hasAdvisor ? 'consulted the advisor about it' : 'want an independent review'}), call ${COUNCIL_TOOL} once for that change. Not for trivial edits, not twice for the same diff, never from a subagent.`,
    'Pass `summary` (one or two lines: what changed). The tool authorizes read-only Opus reviewers and tells you exactly which to launch with the Agent tool; launch those, in one message, in the foreground. Their checked findings come back with the Agent results: treat them as claims to verify against the code before you act on any.',
  ]
  if (activation === 'adaptive') {
    lines.push(
      'Adaptive: the advisor decides whether one specialist review would help. Advisor: when consulted after code changes, end your advice with one line `Council: <none|security|architecture|performance> — <short reason>` (none unless a specialist would add something).',
      'Lead: pass that pick as `selection` and the reason as `rationale`, exactly as the advisor gave them. If the advisor said none, or gave no Council line, do not call the tool.',
    )
  } else {
    lines.push('On: all three specialists (security, architecture, performance) review each eligible checkpoint. Pass `selection: "all"`.')
  }
  return lines.join('\n')
}
