import { expect, test } from 'claude-code/testing'

import { DUAL, MINI_W, coreOrbit, decisionMini, decisionOrbit, dualOrbit, miniOrbit, plain, refreshOrbit, agentOrbit } from '../hooks/orbit'

const glyphs = (rows: string[]) => rows.join('\n').replace(/\s/g, '')
/** Cells (col,row) that hold a bright satellite. */
function satellites(rows: string[]): [number, number][] {
  const out: [number, number][] = []
  rows.forEach((r, y) => [...r].forEach((ch, x) => ch === '●' && !(x === (r.length - 1) / 2 && y === (rows.length - 1) / 2) && out.push([x, y])))
  return out
}

for (const variant of ['tight', 'wide'] as const) {
  test(`dual orbit (${variant}): resting form, satellites in motion, dispersal, seamless loop`, async () => {
    const v = DUAL[variant]
    const at = (c: number) => plain(dualOrbit(variant, c * v.cycleMs))
    const sats = (rows: string[]) => satellites(rows)
    // At rest: core, two parked satellites and the faint path; nothing bright.
    expect(glyphs(plain(dualOrbit(variant, null))).replace(/·/g, '')).toBe('∘◇∘')
    // Turning: two bright satellites, moving frame to frame.
    const frames = [0.3, 0.36, 0.42, 0.48].map(at)
    for (const f of frames) expect(sats(f).length).toBeGreaterThanOrEqual(1)
    expect(new Set(frames.map(f => f.join('|'))).size).toBe(frames.length)
    // Dispersal: more points than the whole satellites ever show.
    const count = (rows: string[]) => glyphs(rows).replace(/[●◈∘]/g, '').length
    expect(count(at(0.66))).toBeGreaterThan(count(at(0.35)))
    // Seamless: the cycle's end looks like the next cycle's start.
    expect(at(1 + 0.01)).toEqual(at(0.01))
  })
}

test('the lead core orbit turns while working and holds still otherwise', async () => {
  expect(plain(coreOrbit(0))).not.toEqual(plain(coreOrbit(300)))
  expect(glyphs(plain(coreOrbit(null))).replace(/∙/g, '')).toBe('●')
  expect(plain(coreOrbit(null))).toEqual(plain(coreOrbit(null)))
})

test('haiku agent orbit follows the real lifecycle', async () => {
  expect(glyphs(plain(agentOrbit({ state: 'idle' }, false)))).toBe('·')
  const run = [0, 300, 900, 1500, 2000].map(ms => plain(agentOrbit({ state: 'running', sinceStart: ms }, false)).join('|'))
  expect(new Set(run).size).toBe(run.length)
  // Two agents started at different times look different at the same moment.
  expect(plain(agentOrbit({ state: 'running', sinceStart: 700 }, false))).not.toEqual(plain(agentOrbit({ state: 'running', sinceStart: 1900 }, false)))
  // Completion: one outward pulse, then a still success mark.
  expect(glyphs(plain(agentOrbit({ state: 'done', sinceEnd: 200 }, false))).length).toBeGreaterThan(1)
  expect(glyphs(plain(agentOrbit({ state: 'done', sinceEnd: 900 }, false)))).toBe('◉')
  expect(glyphs(plain(agentOrbit({ state: 'done', sinceEnd: 9000 }, false)))).toBe('◉')
  // Cancelled and failed stop at once.
  expect(glyphs(plain(agentOrbit({ state: 'cancelled' }, false)))).toBe('◌')
  expect(glyphs(plain(agentOrbit({ state: 'failed' }, false)))).toBe('◌')
})

test('reduced motion: every running frame is the same still picture', async () => {
  const still = [0, 500, 1234, 99999].map(ms => plain(agentOrbit({ state: 'running', sinceStart: ms }, true)).join('|'))
  expect(new Set(still).size).toBe(1)
  expect(glyphs(plain(agentOrbit({ state: 'done', sinceEnd: 10 }, true)))).toBe('◉')
  expect(glyphs(plain(decisionOrbit('accepted', 10, true)))).toBe('◆')
})

test('jev decision orbit: an arc that lands on the outcome, nothing when idle', async () => {
  expect(glyphs(plain(decisionOrbit(null, null, false)))).toBe('·')
  expect(plain(decisionOrbit('accepted', 100, false))).not.toEqual(plain(decisionOrbit('accepted', 400, false)))
  expect(glyphs(plain(decisionOrbit('accepted', 800, false)))).toBe('◆')
  expect(glyphs(plain(decisionOrbit('fallback', 800, false)))).toBe('↩')
  expect(glyphs(plain(decisionOrbit('observed', 800, false)))).toBe('·')
})

test('cache refresh orbit sweeps only while refreshing', async () => {
  expect(refreshOrbit('REFRESHING', 0, false)).not.toBe(refreshOrbit('REFRESHING', 130, false))
  expect(refreshOrbit('REFRESHING', 130, true)).toBe('◌')
  expect(refreshOrbit('ARMED', 130, false)).toBe(refreshOrbit('ARMED', 999, false))
  expect(refreshOrbit('OFF', 0, false)).toBe('·')
})

test('the card-corner orbit fits five cells in every state and moves only while running', async () => {
  const states = [
    { state: 'idle' }, { state: 'failed' }, { state: 'cancelled' }, { state: 'done', sinceEnd: 100 }, { state: 'done', sinceEnd: 5000 },
    { state: 'running', sinceStart: 0 }, { state: 'running', sinceStart: 900 },
  ] as const
  for (const p of states) {
    const rows = plain(miniOrbit(p as any, false))
    expect(rows.length).toBe(1)
    expect(rows[0]!.length).toBe(MINI_W)
  }
  const running = [700, 820, 940, 1060, 1180, 1300].map(ms => plain(miniOrbit({ state: 'running', sinceStart: ms }, false))[0])
  expect(new Set(running).size).toBeGreaterThanOrEqual(3)
  expect(plain(miniOrbit({ state: 'running', sinceStart: 700 }, true))).toEqual(plain(miniOrbit({ state: 'running', sinceStart: 9999 }, true)))
  expect(plain(miniOrbit({ state: 'done', sinceEnd: 5000 }, false))[0]!.trim()).toBe('◉')
})

test('the one-row Jev arc crosses, then lands on the outcome, in five cells', async () => {
  for (const ms of [0, 200, 400, 900]) expect(plain(decisionMini('accepted', ms, false))[0]!.length).toBe(MINI_W)
  expect(plain(decisionMini('accepted', 100, false))).not.toEqual(plain(decisionMini('accepted', 450, false)))
  expect(plain(decisionMini('fallback', 900, false))[0]!.trim()).toBe('↩')
  expect(plain(decisionMini(null, null, false))[0]!.trim()).toBe('·')
})

test('the lead orbit has no blank edge columns, so its box centres the mark itself', async () => {
  for (const ms of [null, 0, 400, 900]) expect(plain(coreOrbit(ms)).every(r => r.length === 5)).toBe(true)
  // Still, the mark fills its footprint: a satellite on each corner, the core in the middle.
  expect(plain(coreOrbit(null))).toEqual(['∙   ∙', '  ●  ', '∙   ∙'])
})
