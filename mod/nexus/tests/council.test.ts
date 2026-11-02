import { expect, test } from 'claude-code/testing'

import {
  NEW_COUNCIL,
  checkRefs,
  composeSection,
  dedupe,
  diffFiles,
  gitArgv,
  hashText,
  isSecretPath,
  mayCall,
  parseFindings,
  parseSelection,
  reviewerSystemPrompt,
  reviewerTask,
  reviewersFor,
  route,
  verdictText,
} from '../hooks/council'
import type { Finding } from '../types'
import { DEFAULT_PREFS, migrate, setPref } from '../hooks/prefs'

test('modes: off launches none, adaptive at most one, on all three', async () => {
  expect(reviewersFor('off', 'security')).toEqual([])
  expect(reviewersFor('adaptive', 'none')).toEqual([])
  expect(reviewersFor('adaptive', 'performance')).toEqual(['performance'])
  expect(reviewersFor('on', 'none')).toEqual(['security', 'architecture', 'performance'])
})

test('the advisor pick: one specialist or none; anything unreadable is none, never all three', async () => {
  expect(parseSelection('security')).toBe('security')
  expect(parseSelection('Council: architecture — the new cache layer couples two modules')).toBe('architecture')
  expect(parseSelection('  PERFORMANCE: n^2 loop')).toBe('performance')
  expect(parseSelection('none')).toBe('none')
  expect(parseSelection('all')).toBe('none')
  expect(parseSelection('security and performance')).toBe('security')
  expect(parseSelection('maybe later')).toBe('none')
  expect(parseSelection(undefined)).toBe('none')
  expect(parseSelection(42)).toBe('none')
})

test('findings: the last json block is read and validated; no block means null (incomplete), not zero', async () => {
  const answer = [
    'Reviewed.',
    '```json',
    '[{"severity":"HIGH","file":"./src/a.ts","line":12,"title":"Shell injection in run()","evidence":"exec(`ls ${dir}`)","action":"use argv","confidence":0.8},',
    ' {"severity":"weird","title":"Missing ref"},',
    ' {"title":""}, "junk"]',
    '```',
  ].join('\n')
  const f = parseFindings(answer, 'security')!
  expect(f.length).toBe(2)
  expect(f[0]).toMatchObject({ role: 'security', severity: 'high', file: 'src/a.ts', line: 12, confidence: 0.8 })
  expect(f[1]).toMatchObject({ severity: 'info', file: null, line: null })
  expect(parseFindings('I looked and it is fine.', 'security')).toBe(null)
  expect(parseFindings('```json\n[]\n```', 'performance')).toEqual([])
  expect(parseFindings('```json\n{not json\n```', 'performance')).toBe(null)
})

test('references are checked against the files as they are now', async () => {
  const base = { role: 'architecture' as const, alsoBy: [], severity: 'low' as const, title: 't', evidence: 'e', action: 'a', confidence: null }
  const out = checkRefs(
    [
      { ...base, file: 'a.ts', line: 3 },
      { ...base, file: 'a.ts', line: 99 },
      { ...base, file: 'gone.ts', line: 1 },
      { ...base, file: null, line: null },
      { ...base, file: 'config/.env', line: 1 },
    ],
    { 'a.ts': 10, 'gone.ts': null },
  )
  expect(out.map(f => f.ref)).toEqual(['ok', 'line-out-of-range', 'missing-file', 'no-ref', 'secret-path'])
  expect(out[4]!.evidence).toBe('(withheld: secret path)')
})

test('duplicates merge across specialists: higher severity and every reporter kept', async () => {
  const f = (role: Finding['role'], severity: Finding['severity'], line: number, title: string): Finding => ({
    role, alsoBy: [], severity, file: 'db.ts', line, title, evidence: 'x', action: 'y', confidence: null, ref: 'ok',
  })
  const merged = dedupe([
    f('performance', 'medium', 40, 'Query runs inside the loop over users'),
    f('architecture', 'high', 42, 'Query inside loop over users couples layers'),
    f('security', 'low', 90, 'Unrelated logging of tokens'),
  ])
  expect(merged.length).toBe(2)
  expect(merged[0]).toMatchObject({ severity: 'high', role: 'performance', alsoBy: ['architecture'] })
})

test('router: git_read is granted; write, shell, network and anything unknown are denied', async () => {
  expect(route('git_read').decision).toBe('grant')
  for (const c of ['Write', 'Bash', 'shell', 'WebFetch', 'Edit', 'run tests', 'Agent', 'install', '', 'LSP', 'something_else']) {
    expect(route(c).decision).toBe('deny')
  }
})

test('second check: base tools allowed except secrets; grantable tools only after a grant; the rest never', async () => {
  expect(mayCall('Read', [], { file_path: 'src/a.ts' })).toEqual({ ok: true })
  expect(mayCall('Read', [], { file_path: '/repo/.env.local' }).ok).toBe(false)
  expect(mayCall('Grep', [], { path: 'keys/server.pem' }).ok).toBe(false)
  expect(mayCall('mcp__nexus__git_read', [], {}).ok).toBe(false)
  expect(mayCall('mcp__nexus__git_read', ['mcp__nexus__git_read'], {}).ok).toBe(true)
  expect(mayCall('mcp__nexus__request_capability', [], {}).ok).toBe(true)
  for (const t of ['Write', 'Edit', 'Bash', 'WebFetch', 'Agent', 'mcp__nexus__council_review']) expect(mayCall(t, ['mcp__nexus__git_read'], {}).ok).toBe(false)
})

test('git_read builds fixed argv and refuses flags, absolute paths, traversal and secrets', async () => {
  expect(gitArgv('log', undefined, undefined)).toEqual({ argv: ['git', 'log', '--oneline', '-n', '20', '--no-color'] })
  expect(gitArgv('show', 'src/a.ts', 'HEAD~1')).toEqual({ argv: ['git', 'show', '--no-color', '--stat', '--patch', 'HEAD~1', '--', 'src/a.ts'] })
  expect(gitArgv('blame', 'src/a.ts', undefined)).toEqual({ argv: ['git', 'blame', '--no-color', '-w', '--', 'src/a.ts'] })
  for (const bad of [gitArgv('log', '--output=/tmp/x', undefined), gitArgv('show', undefined, '--exec=x'), gitArgv('blame', '/etc/passwd', undefined), gitArgv('blame', '../x', undefined), gitArgv('blame', '.env', undefined), gitArgv('push', undefined, undefined), gitArgv('show', undefined, 'a;b')]) {
    expect('error' in bad).toBe(true)
  }
})

test('secret paths', async () => {
  for (const p of ['.env', 'app/.env.production', 'id_rsa', 'certs/site.key', 'a/b.pem', 'secrets/x.txt', 'credentials.json', '.npmrc']) expect(isSecretPath(p)).toBe(true)
  for (const p of ['src/env.ts', 'README.md', 'keyboard.ts', 'docs/secret-handling.md']) expect(isSecretPath(p)).toBe(false)
})

test('snapshot helpers: stable hash, files named by the diff once each', async () => {
  expect(hashText('abc')).toBe(hashText('abc'))
  expect(hashText('abc')).not.toBe(hashText('abd'))
  const diff = 'diff --git a/x.ts b/x.ts\n+1\ndiff --git a/y.ts b/y.ts\n+2\ndiff --git a/x.ts b/x.ts\n'
  expect(diffFiles(diff)).toEqual(['x.ts', 'y.ts'])
})

test('a reviewer is told when the diff was truncated and gets its own instructions', async () => {
  const snap = { hash: 'h', diff: 'x'.repeat(70_000), untracked: ['new.ts'], files: ['a.ts', 'new.ts'], isTruncated: false }
  const task = reviewerTask('performance', snap, 'added a cache', 'loops over users')
  expect(task).toMatch(/TRUNCATED at 60000 characters/)
  expect(task).toMatch(/New untracked files .*new\.ts/)
  expect(task.length).toBeLessThan(61_000)
  expect(reviewerSystemPrompt('performance')).toMatch(/no speculative optimisation without evidence/)
  expect(reviewerSystemPrompt('security')).toMatch(/never modify anything/)
})

test('the verdict says how each run ended, flags staleness, and frames findings as claims', async () => {
  const cp = { ...NEW_COUNCIL, checkpoint: null }
  const text = verdictText(
    {
      id: 1, at: 0, activation: 'on', selection: 'all', rationale: null, advisorSeen: true, hash: 'abcd', files: ['a.ts'], isTruncated: false,
      status: 'partial', reason: null, isStale: true, endedAt: 1,
      findings: [{ role: 'security', alsoBy: ['architecture'], severity: 'high', file: 'a.ts', line: 3, title: 'T', evidence: 'E', action: 'A', confidence: 0.7, ref: 'ok' }],
    },
    [
      { ...cp.reviewers.security, status: 'done', findings: 1 },
      { ...cp.reviewers.architecture, status: 'incomplete', reason: 'interrupted before it answered' },
      { ...cp.reviewers.performance, status: 'failed', reason: 'the run ended on an API error' },
    ],
  )
  expect(text).toMatch(/SECURITY: done · 1 finding/)
  expect(text).toMatch(/ARCHITECTURE: INCOMPLETE: interrupted/)
  expect(text).toMatch(/PERFORMANCE: FAILED/)
  expect(text).toMatch(/STALE/)
  expect(text).toMatch(/claims to verify/)
  expect(text).toMatch(/HIGH · security\+architecture · a\.ts:3 · confidence 0\.70/)
})

test('instructions: adaptive asks the advisor for one Council line; on asks for all', async () => {
  expect(composeSection('adaptive', true)).toMatch(/Council: <none\|security\|architecture\|performance>/)
  expect(composeSection('adaptive', true)).toMatch(/do not call the tool/)
  expect(composeSection('on', true)).toMatch(/all three specialists/)
})

test('preferences v3: council defaults to adaptive, a choice survives, widths from v2 are kept', async () => {
  expect(DEFAULT_PREFS.council.activation).toBe('adaptive')
  expect(migrate({ version: 2, paneColumns: 150, layout: 'compact' })).toMatchObject({ version: 3, paneColumns: 150, layout: 'compact', council: { activation: 'adaptive' } })
  expect(migrate({ version: 3, council: { activation: 'on' } }).council.activation).toBe('on')
  expect(migrate({ version: 3, council: { activation: 'everything' } }).council.activation).toBe('adaptive')
  expect(migrate({ version: 1, paneColumns: 120 }).paneColumns).toBe(999)
  const set = setPref(DEFAULT_PREFS, 'council.activation', 'off')
  expect(set.ok && set.prefs.council.activation).toBe('off')
  expect(setPref(DEFAULT_PREFS, 'council.activation', 'sometimes').ok).toBe(false)
})
