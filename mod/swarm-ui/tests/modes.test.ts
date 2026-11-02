import { expect, test } from 'claude-code/testing'

import { MODES, assess, launchedMode, pairing, plan, rank, relaunchCommand } from '../hooks/modes'

test('every mode pairs its own advisor by the engine rule', async () => {
  for (const m of Object.values(MODES)) expect(pairing(m.main, m.advisor).ok).toBe(true)
  expect(rank('sonnet')).toBe(6)
  expect(rank('claude-opus-5-5')).toBe(7)
  expect(rank('fable[1m]')).toBe(9)
})

test('unsupported pairings are refused with the reason', async () => {
  const fableOnOpus = pairing('fable', 'opus')
  expect(fableOnOpus.ok).toBe(false)
  if (!fableOnOpus.ok) expect(fableOnOpus.reason).toMatch(/fable \(rank 9\) outranks the opus advisor \(rank 7\)/)
  expect(pairing('opus', 'sonnet').ok).toBe(false)
  expect(pairing('sonnet', 'haiku').ok).toBe(false)
  const mythos = pairing('sonnet', 'claude-mythos-5-1')
  expect(mythos.ok).toBe(false)
  if (!mythos.ok) expect(mythos.reason).toMatch(/cannot be an advisor/)
  // Equal ranks pass; no advisor always passes.
  expect(pairing('opus', 'opus').ok).toBe(true)
  expect(pairing('fable', null).ok).toBe(true)
})

test('a plan applies what the session advisor allows and names the relaunch for the rest', async () => {
  const balanced = plan('balanced', 'opus', 's1')
  expect(balanced.isComplete).toBe(true)
  expect(balanced.relaunch).toBe(null)
  expect(balanced.now).toEqual({ main: 'sonnet', effort: 'high' })

  // Opus main with the Opus advisor is valid now; the Fable advisor waits for a relaunch.
  const deep = plan('deep', 'opus', 's1')
  expect(deep.now).toEqual({ main: 'opus', effort: 'xhigh' })
  expect(deep.isComplete).toBe(false)
  expect(deep.relaunch).toBe(`claude --resume s1 --model opus --effort xhigh --settings '{"advisorModel":"fable"}'`)

  // Fable main can't run under an Opus advisor: nothing applies in-session.
  const max = plan('max', 'opus', 's1')
  expect(max.now).toBe(null)
  expect(max.notes.join(' ')).toMatch(/outranks/)
  expect(max.relaunch).toMatch(/--model fable --effort max/)

  expect(plan('max', 'fable', 's1').isComplete).toBe(true)
  expect(plan('deep', 'claude-fable-5-1', 's1').isComplete).toBe(true)
})

test('the relaunch never writes a setting: it uses the session-scoped --settings flag', async () => {
  const cmd = relaunchCommand('abc', MODES.deep)
  expect(cmd).not.toMatch(/\/advisor|settings\.json|config set/)
  expect(cmd).toMatch(/--settings '\{"advisorModel":"fable"\}'/)
})

test('the launched mode is read from the model and advisor families', async () => {
  expect(launchedMode('claude-sonnet-5-5', 'opus')).toBe('balanced')
  expect(launchedMode('claude-opus-5-5', 'fable')).toBe('deep')
  expect(launchedMode('claude-fable-5-1', 'fable')).toBe('max')
  expect(launchedMode('claude-haiku-5-5', 'opus')).toBe(null)
})

test('escalation rules: trivial prompts are never assessed, hard ones rise', async () => {
  expect(assess('fix the typo', 0).level).toBe(0)
  expect(assess('/compact', 0).level).toBe(0)
  const routine = assess('add a short paragraph to the README about installing', 0)
  expect(routine).toEqual({ level: 1, reasons: [], isAmbiguous: false })

  const one = assess('please debug why the login form shows twice on submit', 0)
  expect(one.level).toBe(1)
  expect(one.isAmbiguous).toBe(true)

  const deep = assess('refactor the session store and fix the race condition in the cache layer', 0)
  expect(deep.level).toBe(2)
  expect(deep.reasons[0]).toMatch(/refactor/)

  const files = assess('update api.ts, store.ts and views.tsx to use the new client', 0)
  expect(files.isAmbiguous).toBe(true)
  expect(files.reasons).toContain('names 3 files')

  const max = assess('design a novel algorithm from scratch and refactor the scheduler around it', 0)
  expect(max.level).toBe(3)

  const errors = assess('try the build again and see what is still failing here', 3)
  expect(errors.reasons).toContain('3 recent tool errors')
  expect(errors.isAmbiguous).toBe(true)
})
