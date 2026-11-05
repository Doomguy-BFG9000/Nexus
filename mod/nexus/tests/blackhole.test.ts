import { expect, test } from 'claude-code/testing'

import { CYCLE_MS, FRAMES, bhText, blackHole, drawBlackHole, frames, horizonRadius } from '../hooks/blackhole'

const SIZES: [number, number][] = [[40, 8], [56, 11], [66, 12], [76, 14], [24, 6]]
const dots = (ch: string) => (ch === ' ' ? 0 : [...Array(8).keys()].filter(b => ((ch.charCodeAt(0) - 0x2800) >> b) & 1).length)
/** Cells that count as inside the shadow: all eight dots well well within the horizon (r < 0.5 R; the disk's near edge crosses the lower part of the horizon). */
function shadowCells(w: number, rows: number): [number, number][] {
  const R = horizonRadius(w, rows)
  const W = w * 2
  const H = rows * 4
  const out: [number, number][] = []
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < w; col++) {
      let inside = true
      for (const dx of [0, 1]) for (const dy of [0, 1, 2, 3]) inside &&= Math.hypot((col * 2 + dx - (W - 1) / 2) / R, (row * 4 + dy - (H - 1) / 2) / R) < 0.5
      if (inside) out.push([col, row])
    }
  return out
}

test('the event horizon is dark in every frame, at every size', () => {
  for (const [w, h] of SIZES) {
    const cells = shadowCells(w, h)
    if (w >= 40) expect(cells.length).toBeGreaterThan(2)
    for (const f of [0, 7, 15, 30, 45, 59]) {
      const text = bhText(drawBlackHole(w, h, f / FRAMES))
      for (const [c, r] of cells) expect(text[r]![c]).toBe(' ')
    }
    const still = bhText(drawBlackHole(w, h, null))
    for (const [c, r] of shadowCells(w, h)) expect(still[r]![c]).toBe(' ')
  }
})

test('every frame is exactly w columns by h rows, with only braille dots and spaces', () => {
  for (const [w, h] of SIZES) {
    const text = bhText(blackHole(5000, w, h))
    expect(text.length).toBe(h)
    for (const row of text) {
      expect([...row].length).toBe(w)
      expect(row).toMatch(/^[ ⠀-⣿]*$/)
    }
  }
})

test('it looks like the reference: a bright disk across the lower half, dark above it, arcs over and under', () => {
  const text = bhText(drawBlackHole(66, 12, 0.25))
  const weight = text.map(r => [...r].reduce((n, ch) => n + dots(ch), 0))
  const brightest = weight.indexOf(Math.max(...weight))
  // The disk is the densest row, in the lower half, and the rows above the shadow's top hold arcs.
  expect(brightest).toBeGreaterThanOrEqual(6)
  expect(brightest).toBeLessThanOrEqual(9)
  expect(weight[0]! + weight[1]! + weight[2]!).toBeGreaterThan(10)
  expect(weight[10]! + weight[11]!).toBeGreaterThan(10)
  // The disk reaches far to both sides of the shadow.
  const row = [...text[brightest]!]
  expect(row.findIndex(c => c !== ' ')).toBeLessThan(12)
  expect(row.length - 1 - row.findLastIndex(c => c !== ' ')).toBeLessThan(12)
  // Mostly black.
  const lit = text.join('').replace(/ /g, '').length
  expect(lit / (66 * 12)).toBeLessThan(0.5)
})

test('the loop is seamless: the end of the cycle is the start of the next', () => {
  for (const [w, h] of SIZES.slice(0, 3)) expect(bhText(drawBlackHole(w, h, 1))).toEqual(bhText(drawBlackHole(w, h, 0)))
  const cycle = CYCLE_MS.slow
  expect(bhText(blackHole(cycle * 3, 66, 12))).toEqual(bhText(blackHole(0, 66, 12)))
  expect(bhText(blackHole(cycle * 3 + 1234, 66, 12))).toEqual(bhText(blackHole(1234, 66, 12)))
})

test('slow, not flashing: neighbouring frames differ in a few cells, never most of them', () => {
  for (const [w, h] of [[56, 11], [76, 14]] as [number, number][]) {
    const list = frames(w, h).map(bhText)
    let worst = 0
    let total = 0
    list.forEach((f, i) => {
      const g = list[(i + 1) % list.length]!
      let diff = 0
      f.forEach((row, r) => [...row].forEach((ch, c) => ch !== g[r]![c] && diff++))
      worst = Math.max(worst, diff / (w * h))
      total += diff
    })
    expect(worst).toBeLessThan(0.14)
    // ...and it does move: the cycle is not a still picture.
    expect(total).toBeGreaterThan(0)
    expect(new Set(list.map(f => f.join('\n'))).size).toBeGreaterThan(FRAMES / 2)
  }
})

test('the horizon, ring and disk never move; only the dots slide', () => {
  // The shadow stays black at every phase (above), and the disk's densest row is the same row throughout.
  const row = (f: number) => {
    const t = bhText(drawBlackHole(66, 12, f / FRAMES))
    const w = t.map(r => [...r].reduce((n, ch) => n + dots(ch), 0))
    return w.indexOf(Math.max(...w))
  }
  expect(new Set([0, 10, 20, 30, 40, 50].map(row)).size).toBe(1)
})

test('speed: very slow takes longer to change than slow; reduced motion is one fixed frame', () => {
  expect(CYCLE_MS.slow).toBeGreaterThanOrEqual(20_000)
  expect(CYCLE_MS.veryslow).toBeLessThanOrEqual(40_000)
  expect(CYCLE_MS.veryslow).toBeGreaterThan(CYCLE_MS.slow)
  const at = (ms: number, sp: 'slow' | 'veryslow') => bhText(blackHole(ms, 66, 12, sp)).join('\n')
  expect(at(0, 'slow')).toBe(at(0, 'veryslow'))
  expect(at(CYCLE_MS.slow / 2, 'slow')).not.toBe(at(0, 'slow'))
  // Half a slow cycle in, a very slow cycle has not reached its own half.
  expect(at(CYCLE_MS.slow / 2, 'veryslow')).not.toBe(at(CYCLE_MS.slow / 2, 'slow'))
  expect(blackHole(null, 66, 12)).toEqual(blackHole(null, 66, 12))
  expect(blackHole(Number.NaN, 66, 12)).toEqual(blackHole(null, 66, 12))
})

test('frames are computed once per size and reused (no redraw cost per tick)', () => {
  expect(frames(66, 12)).toBe(frames(66, 12))
  expect(blackHole(2000, 66, 12)).toBe(frames(66, 12)[Math.floor((2000 / CYCLE_MS.slow) * FRAMES)])
  const t0 = performance.now()
  for (let i = 0; i < 5000; i++) blackHole(i * 100, 66, 12)
  expect(performance.now() - t0).toBeLessThan(500)
})

test('the whole cycle of a large picture is cheap to build', () => {
  const t0 = performance.now()
  frames(100, 16)
  const ms = performance.now() - t0
  console.log(`black hole: ${FRAMES} frames at 100x16 built in ${ms.toFixed(1)} ms`)
  expect(ms).toBeLessThan(1500)
})

test('without colour the shape still reads: dot density alone separates the disk from the sky', () => {
  const text = bhText(drawBlackHole(66, 12, 0.25))
  const density = (r: string) => [...r].reduce((n, ch) => n + dots(ch), 0)
  const mid = Math.max(...text.map(density))
  const sparse = text.filter(r => density(r) > 0 && density(r) < mid / 3).length
  expect(mid).toBeGreaterThan(150)
  expect(sparse).toBeGreaterThanOrEqual(4)
})

test('tiny and odd sizes draw without error', () => {
  for (const [w, h] of [[1, 1], [8, 4], [9, 5], [200, 30]] as [number, number][]) {
    const s = blackHole(1000, w, h)
    expect(s.length).toBe(Math.max(4, h))
  }
})
