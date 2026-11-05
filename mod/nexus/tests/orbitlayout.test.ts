import { expect, test } from 'claude-code/testing'

import { O, agentRows, alerts, fitLine, orbitLines, orbitMode, panel, tapeRows, width } from '../hooks/orbitlayout'
import type { Line } from '../hooks/orbitlayout'
import { NOW, agent, snap, unreported, withPrefs } from './snap'

const text = (lines: Line[]) => lines.map(l => l.map(g => g.t).join(''))
const all = (lines: Line[]) => text(lines).join('\n')
const WIDTHS = [40, 48, 56, 64, 72, 84, 96, 100, 110, 130, 160]
// East Asian wide characters and emoji would take two cells: none may appear.
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]|[\u{1f300}-\u{1faff}]/u

test('every line is exactly as wide as the pane, at every width, density, graphic and preset', () => {
  for (const w of WIDTHS)
    for (const density of ['comfortable', 'compact'])
      for (const cp of ['blackhole', 'classic', 'off'])
        for (const preset of ['minimal', 'standard', 'full']) {
          const p = withPrefs(['density', density], ['centerpiece', cp], ['telemetry.preset', preset])
          const lines = orbitLines(snap({}, p), w)
          const widths = new Set(text(lines).map(l => [...l].length))
          expect([w, ...widths]).toEqual([w, w])
        }
})

test('only single-cell glyphs: no wide characters, so a column is a cell', () => {
  for (const w of [56, 100]) expect(all(orbitLines(snap(), w))).not.toMatch(WIDE)
})

test('layout modes: wide beside, stacked, narrow; compact forces stacking', () => {
  expect(orbitMode(100, 'auto')).toBe('wide')
  expect(orbitMode(84, 'auto')).toBe('stacked')
  expect(orbitMode(60, 'auto')).toBe('narrow')
  expect(orbitMode(120, 'compact')).toBe('stacked')
  // Wide has the lead and the advisor on the same row; stacked does not.
  const wide = text(orbitLines(snap(), 100)).find(l => l.includes('Lead session'))!
  expect(wide).toMatch(/advisor/)
  expect(text(orbitLines(snap(), 80)).find(l => l.includes('Lead session'))).not.toMatch(/advisor/)
})

test('the lead centrepiece: black hole by default, the classic orbit, or none', () => {
  const braille = (p: ReturnType<typeof withPrefs>) => (all(orbitLines(snap({}, p), 100)).match(/[⠀-⣿]/g) ?? []).length
  expect(braille(withPrefs())).toBeGreaterThan(150)
  expect(braille(withPrefs(['centerpiece', 'off']))).toBe(0)
  const classic = all(orbitLines(snap({}, withPrefs(['centerpiece', 'classic'])), 100))
  expect(classic).toMatch(/[∙●]/)
  expect(classic.match(/[⠀-⣿]/g) ?? []).toHaveLength(0)
  // Off gives the room back.
  expect(orbitLines(snap({}, withPrefs(['centerpiece', 'off'])), 100).length).toBeLessThan(orbitLines(snap(), 100).length)
})

test('density: compact is shorter than comfortable', () => {
  expect(orbitLines(snap({}, withPrefs(['density', 'compact'])), 100).length).toBeLessThan(orbitLines(snap(), 100).length)
})

test('the black hole moves with the clock and holds still under reduced motion', () => {
  // Only the black hole's own cells: the header's clock moves whatever the graphic does.
  const at = (now: number, reduce: boolean) => (all(orbitLines(snap({ now, reduceMotion: reduce }), 100)).match(/[\u2800-\u28ff ]{20,}/g) ?? []).join('|')
  expect(at(NOW, false)).not.toBe(at(NOW + 12_000, false))
  expect(at(NOW, true)).toBe(at(NOW + 12_000, true))
  const off = withPrefs(['animation', 'off'])
  const holeOf = (now: number) => (all(orbitLines(snap({ now }, off), 100)).match(/[\u2800-\u28ff ]{20,}/g) ?? []).join('|')
  expect(holeOf(NOW)).toBe(holeOf(NOW + 12_000))
})

test('animation speed: very slow changes less over the same time', () => {
  const diff = (speed: string) => {
    const p = withPrefs(['animationSpeed', speed])
    const a = text(orbitLines(snap({ now: NOW }, p), 100))
    const b = text(orbitLines(snap({ now: NOW + 4_000 }, p), 100))
    return a.reduce((n, row, i) => n + [...row].filter((ch, c) => ch !== [...b[i]!][c]).length, 0)
  }
  expect(diff('veryslow')).toBeLessThan(diff('slow'))
})

test('a long task name gives way; the state and the time never do', () => {
  const long = 'Trace every call site of the pricing function across the whole monorepo and summarise the findings in detail'
  const s = snap({ agents: [agent('a1', 'nexus-grep', 1, long, 'running', 12, 25, 95_000), agent('a2', 'nexus-audit', 3, long, 'failed', 30, 30, 3_000)] })
  for (const w of [48, 56, 72, 100]) {
    const rows = text(orbitLines(s, w)).filter(l => /^│ [●◐✓✗◌] (grep#1|audit#3)/.test(l))
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatch(/running/)
    expect(rows[0]).toMatch(/1m 35s/)
    expect(rows[1]).toMatch(/failed/)
    expect(rows[1]).toMatch(/3s/)
    expect(rows.join('')).toMatch(/…/)
  }
})

test('failures and limits are always shown, whatever the preset, and never cut', () => {
  const s = snap({ agents: [agent('a1', 'nexus-audit', 1, 'x', 'failed', 3, 30, 5000)], usage: { ...snap().usage, percent: 93, limits: [{ kind: 'five_hour', percentUsed: 95, resetsAt: null }] } }, withPrefs(['telemetry.preset', 'minimal']))
  expect(alerts(s).map(a => a.text).join('|')).toMatch(/audit#1 failed.*context 93%.*5h limit 95%/)
  for (const w of [40, 56, 100]) {
    const out = all(orbitLines(s, w))
    expect(out).toMatch(/audit#1 failed/)
    expect(out).toMatch(/context 93%/)
    expect(out).toMatch(/5h limit 95%/)
  }
})

test('amber warnings can be turned off; red alerts cannot', () => {
  const warm = { ...snap().usage, percent: 75 }
  const on = snap({ usage: warm })
  expect(alerts(on).some(a => /context 75%/.test(a.text))).toBe(true)
  const off = snap({ usage: warm }, withPrefs(['telemetry.warnings', 'off']))
  expect(alerts(off).some(a => /context 75%/.test(a.text))).toBe(false)
  const hot = snap({ usage: { ...snap().usage, percent: 96 } }, withPrefs(['telemetry.warnings', 'off']))
  expect(alerts(hot).some(a => /context 96%/.test(a.text))).toBe(true)
})

test('presets: Minimal hides numbers, Standard shows context and times, Full adds tokens and costs', () => {
  const at = (preset: string) => all(orbitLines(snap({}, withPrefs(['telemetry.preset', preset])), 100))
  const min = at('minimal')
  expect(min).toMatch(/Subagents/)
  expect(min).not.toMatch(/context|\$12\.99|tok|Activity|Jev · routing|Usage/)
  const std = at('standard')
  expect(std).toMatch(/ctx 425k\/1\.0M/)
  expect(std).toMatch(/context 425k/)
  expect(std).toMatch(/Jev · routing/)
  expect(std).toMatch(/Activity/)
  expect(std).toMatch(/4m 34s/)
  expect(std).not.toMatch(/\$12\.99/)
  expect(std).not.toMatch(/\d+k tok/)
  const full = at('full')
  expect(full).toMatch(/\$12\.99 est/)
  expect(full).toMatch(/API-priced, not a bill/)
  expect(full).toMatch(/\d+k tok/)
})

test('custom: each visibility choice works alone', () => {
  const only = (key: string) => all(orbitLines(snap({}, withPrefs(['telemetry.preset', 'minimal'], [key, 'on'])), 100))
  expect(only('telemetry.cost')).toMatch(/\$12\.99/)
  expect(only('telemetry.tokens')).toMatch(/tokens/)
  expect(only('telemetry.times')).toMatch(/4m 34s/)
  expect(only('telemetry.activity')).toMatch(/Activity/)
  expect(only('telemetry.routing')).toMatch(/Jev · routing/)
  expect(only('telemetry.usage')).toMatch(/5h/)
})

test('nothing reported: N/A or an honest empty state, never zero and never invented', () => {
  const out = all(orbitLines(unreported(withPrefs(['telemetry.preset', 'full'])), 100))
  expect(out).toMatch(/context\s+N\/A/)
  expect(out).toMatch(/cost N\/A/)
  expect(out).toMatch(/plan windows N\/A/)
  expect(out).toMatch(/tokens N\/A/)
  expect(out).toMatch(/not yet consulted/)
  expect(out).not.toMatch(/\$0|\b0%|0k\b|0\.00/)
  expect(out).toMatch(/search\s+grep\s+audit\s+test/)
})

test('an agent that made no request reports its tokens as N/A, not 0', () => {
  const s = snap({ agents: [agent('a9', 'nexus-test', 1, 'tests', 'running', 0, 20, 1000)] }, withPrefs(['telemetry.preset', 'full']))
  expect(text(orbitLines(s, 100)).find(l => /test#1/.test(l))).toMatch(/N\/A tok/)
})

test('many agents: any number of instances of a role, the busiest first, the rest counted', () => {
  const list = [
    ...Array.from({ length: 9 }, (_, i) => agent(`d${i}`, 'nexus-grep', i + 1, `done ${i}`, 'done', 5, 25, 10_000)),
    agent('r1', 'nexus-audit', 1, 'a', 'running', 2, 30, 1000),
    agent('r2', 'nexus-audit', 2, 'b', 'running', 3, 30, 2000),
    agent('r3', 'nexus-test', 1, 'c', 'running', 1, 20, 500),
  ]
  const { shown, hidden } = agentRows(list, 6)
  expect(shown.slice(0, 3).map(a => a.status)).toEqual(['running', 'running', 'running'])
  expect(hidden).toBe(6)
  const out = all(orbitLines(snap({ agents: list }), 100))
  expect(out).toMatch(/audit#1/)
  expect(out).toMatch(/audit#2/)
  expect(out).toMatch(/test#1/)
  expect(out).toMatch(/\+6 more/)
  expect(out).toMatch(/3 running\s+12 total/)
})

test('Jev says whether it is only observing or acting, and Council its own state', () => {
  expect(all(orbitLines(snap(), 100))).toMatch(/observe only/)
  const s = snap()
  expect(all(orbitLines({ ...s, jev: { ...s.jev, routing: 'active' } }, 100))).toMatch(/active/)
  expect(all(orbitLines({ ...s, jev: { ...s.jev, status: 'off' } }, 100))).toMatch(/off · set in the plugin options/)
  const out = all(orbitLines(snap(), 100))
  expect(out).toMatch(/security\s+done · 2 findings/)
  expect(out).toMatch(/✓ 3\/3/)
  expect(all(orbitLines(snap({}, withPrefs(['council.activation', 'off'])), 100))).toMatch(/off · the single advisor reviews/)
})

test('the activity tape drops repeats and keeps its sources', () => {
  const dup = [
    { at: NOW - 3000, who: 'jev' as const, kind: 'jev' as const, text: 'route → which file', detail: '' },
    { at: NOW - 2500, who: 'jev' as const, kind: 'jev' as const, text: 'route → which file', detail: '' },
    { at: NOW, who: 'council' as const, kind: 'done' as const, text: 'security review · done', detail: '' },
  ]
  expect(tapeRows(dup)).toHaveLength(2)
  const out = all(orbitLines(snap({ log: dup }), 100))
  expect(out.match(/route → which file/g)).toHaveLength(1)
  expect(out).toMatch(/COUNCIL\s+security review · done/)
})

test('panel: corners and title survive a too-long tag; the bottom-right corner is clipped', () => {
  const p = panel({ title: 'Jev · routing', titleColor: O.jev, edge: O.edge.jev, width: 36, rows: [[{ t: 'row' }]], tag: [{ t: 'decisions 169  observe only and a very long tag' }], accent: true })
  const t = text(p)
  expect(t.every(l => [...l].length === 36)).toBe(true)
  expect(t[0]).toMatch(/^┌─ Jev · routing/)
  expect(t[0]).toMatch(/─┐$/)
  expect(t.at(-1)).toMatch(/^└─+╱$/)
  expect(t[1]).toMatch(/^│ row\s+│$/)
})

test('fitLine: the flexible field shrinks first, then the right end; padding fills', () => {
  expect(width(fitLine([{ t: 'ab' }], 6))).toBe(6)
  const l = fitLine([{ t: 'id ' }, { t: 'a long task name', flex: true }, { t: ' done 3s' }], 20)
  expect(width(l)).toBe(20)
  const s = l.map(x => x.t).join('')
  expect(s).toMatch(/^id a.*… done 3s$/)
})

test('keyboard hints are never what gets cut: the pane always ends on a hint line', () => {
  for (const w of [40, 56, 100]) {
    const last = text(orbitLines(snap(), w)).at(-1)!
    expect(last.length).toBeGreaterThan(0)
  }
})
