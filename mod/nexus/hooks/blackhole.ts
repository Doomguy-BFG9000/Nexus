// Orbit's lead graphic: a stylized black hole drawn from terminal characters. Pure.
//
// Pixels are braille dots: a cell is 2 dots wide and 4 tall, and a cell is about twice as
// tall as it is wide, so every dot is square. The picture is a (2W) × (4H) grid of
// intensities (0 to 3); a cell lights the dots that are set and takes the brightest tone
// among them. Shape and brightness both survive without colour: the more dots a cell holds,
// the denser the glyph.
//
// The layers, in units of the horizon radius R (u across, v down, centre 0,0):
//   event horizon   r < 1, always dark; only the disk's near edge crosses its lower part
//   photon ring     a dotted circle at r ≈ 1.08
//   accretion disk  the bright band across the lower horizon (v ≈ 0.7), flattened ellipses
//   lensing arcs    dotted half ellipses over the top and under the bottom, joining the disk
//   motes           a few fixed specks round the edge
//
// Motion is slow and seamless. Each dotted curve is a ring of evenly spaced points that
// slides along itself by a whole number of steps per cycle, so frame N equals frame 0.
// Nothing is random at draw time: frames are a pure function of (width, rows, speed, phase).

/** Braille dots per cell, across and down. */
const DX = 2
const DY = 4

export type BhTone = 'blank' | 'faint' | 'low' | 'mid' | 'high'
export type BhRun = { text: string; tone: BhTone }
export type BhSprite = BhRun[][]

/** Cycle length per speed setting (ms). One full evolution of the arcs and the ring. */
export const CYCLE_MS = { slow: 24_000, veryslow: 36_000 } as const
export type BhSpeed = keyof typeof CYCLE_MS
/** Distinct frames per cycle: 2.5 a second at `slow`, which is all a drift this slow needs. */
export const FRAMES = 60

const TONE: BhTone[] = ['blank', 'faint', 'mid', 'high']

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The size the picture needs: the horizon radius in pixels for a W × 2H grid. */
export function horizonRadius(w: number, rows: number): number {
  // Wide enough for the disk (about 6.2 R across) and tall enough for the arcs (about 3.5 R).
  return Math.max(3, Math.min((w * DX) / 6.4, (rows * DY) / 3.6))
}

type Mote = { u: number; v: number; level: number; phase: number }

/** Specks around the structure, placed once from a fixed seed (never at draw time). */
function motes(w: number, px: number, count: number): Mote[] {
  const rnd = mulberry32(0x5eed + w * 31 + px)
  const out: Mote[] = []
  let guard = 0
  while (out.length < count && guard++ < 400) {
    const u = (rnd() * 2 - 1) * 0.98
    const v = (rnd() * 2 - 1) * 0.98
    // Keep clear of the structure: outside the ellipse the disk and arcs fill.
    if ((u / 0.86) ** 2 + (v / 0.62) ** 2 < 1) continue
    // And apart from each other.
    if (out.some(m => Math.abs(m.u - u) < 0.12 && Math.abs(m.v - v) < 0.2)) continue
    out.push({ u, v, level: rnd() < 0.2 ? 3 : 2, phase: rnd() })
  }
  return out
}

/** One frame, `t` in [0, 1): the picture at that point of the cycle. `t === null` is the still frame. */
export function drawBlackHole(w: number, rows: number, t: number | null): BhSprite {
  const cols = Math.max(8, Math.floor(w))
  const cellRows = Math.max(4, Math.floor(rows))
  const W = cols * DX
  const H = cellRows * DY
  const R = horizonRadius(cols, cellRows)
  const cx = (W - 1) / 2
  const cy = (H - 1) / 2
  const grid = new Uint8Array(W * H)
  const phase = t ?? 0
  const plot = (x: number, y: number, level: number) => {
    const px = Math.round(x)
    const py = Math.round(y)
    if (level <= 0 || px < 0 || px >= W || py < 0 || py >= H) return
    const i = py * W + px
    if (level > grid[i]!) grid[i] = level
  }
  const at = (u: number, v: number): [number, number] => [cx + u * R, cy + v * R]
  const level = (intensity: number) => (intensity >= 0.78 ? 3 : intensity >= 0.46 ? 2 : intensity >= 0.16 ? 1 : 0)
  const wrap = (x: number, n: number) => ((x % n) + n) % n

  // How far the disk reaches either way: the grid's own half width, so it is never cut off.
  const reach = Math.min(W / 2 / R - 0.08, 3.2)
  const v0 = 0.7 // the disk's centre line

  // ---- lensing arcs: dotted half ellipses over the top and under the bottom ----------------
  const arc = (a: number, b: number, upper: boolean, base: number, steps: number) => {
    const len = Math.PI * Math.sqrt((a * a + b * b) / 2) * R
    const n = Math.max(12, Math.round(len / 2.2))
    for (let i = 0; i < n; i++) {
      // Dots slide along the arc `steps` positions a cycle, and fade out at both ends,
      // where the arc meets the disk, so a dot that wraps round is never seen to jump.
      const s = wrap(i + steps * phase, n) / n
      const env = Math.sin(Math.PI * s) ** 0.35
      const th = Math.PI * s
      const u = a * Math.cos(Math.PI - th)
      const v = v0 + (upper ? -1 : 1) * b * Math.sin(th)
      const [x, y] = at(u, v)
      // Brighter where the arc nears the disk (large |u|), softer over the top.
      const near = 0.5 + 0.5 * Math.abs(u / a) ** 1.4
      plot(x, y, level(base * env * near))
    }
  }
  const upper = [
    { a: 1.75, b: 2.5, base: 1.1, steps: 2 },
    { a: 2.2, b: 2.35, base: 0.95, steps: 3 },
    { a: 2.65, b: 2.2, base: 0.8, steps: 2 },
    { a: 3.15, b: 2.05, base: 0.62, steps: 3 },
  ]
  const lower = [
    { a: 1.4, b: 1.0, base: 1.0, steps: 2 },
    { a: 1.95, b: 1.1, base: 0.8, steps: 3 },
    { a: 2.55, b: 1.2, base: 0.6, steps: 2 },
  ]
  for (const k of upper) arc(Math.min(k.a, reach), k.b, true, k.base, k.steps)
  for (const k of lower) arc(Math.min(k.a, reach), k.b, false, k.base, k.steps)

  // ---- accretion disk: a bright band across the lower horizon, thinning to both ends -----
  {
    const yc = cy + v0 * R
    for (let x = 0; x < W; x++) {
      const u = (x - cx) / R
      const f = Math.abs(u) / (reach + 0.1)
      if (f >= 1) continue
      // Half thickness in pixels: thick through the middle, a single pixel at the ends.
      const half = 0.7 + 0.1 * R * (1 - f) ** 1.6
      for (let y = Math.floor(yc - half); y <= Math.ceil(yc + half); y++) {
        const edge = 1 - Math.abs(y - yc) / (half + 0.6)
        // A little brighter on the left: the side turning toward the viewer.
        const lit = (0.2 + 1.0 * (1 - f ** 1.1)) * (0.5 + 0.5 * edge) * (1 - 0.12 * (u / (reach + 0.1)))
        plot(x, y, level(lit))
      }
    }
    // Ripples: dotted ellipses either side of the band that slide along it.
    for (let k = 1; k < 7; k++) {
      const a = Math.min(1.2 + k * 0.3, reach)
      const b = 0.1 + 0.05 * (a - 1)
      const len = 2 * Math.PI * Math.sqrt((a * a + b * b) / 2) * R
      const n = Math.max(16, Math.round(len / (2.6 + k * 0.2)))
      for (let i = 0; i < n; i++) {
        const th = 2 * Math.PI * (wrap(i + (2 + (k % 2)) * phase, n) / n)
        const [x, y] = at(a * Math.cos(th), v0 + b * Math.sin(th))
        const fx = Math.abs(a * Math.cos(th)) / (reach + 0.1)
        plot(x, y, level(0.85 * (1 - fx ** 1.4) * (1 - k * 0.07)))
      }
    }
  }

  // ---- photon ring: a dotted circle just outside the horizon ------------------------------
  {
    const rr = 1.08
    const n = Math.max(24, Math.round((2 * Math.PI * rr * R) / 1.8))
    for (let i = 0; i < n; i++) {
      const th = 2 * Math.PI * (wrap(i + phase, n) / n)
      const [x, y] = at(rr * Math.cos(th), rr * Math.sin(th))
      plot(x, y, 3)
    }
  }

  // ---- motes: fixed specks, drifting a pixel at most -------------------------------------
  const half = Math.min(W / 2, 3.4 * R) - 2
  for (const m of motes(W, H, Math.max(4, Math.round(cols / 5)))) {
    const sway = t === null ? 0 : Math.sin(2 * Math.PI * (phase + m.phase)) * 1.2
    plot(cx + m.u * half, cy + m.v * (H / 2 - 2) + sway, m.level)
  }

  // ---- the shadow: nothing but the disk's near edge may be lit inside the horizon ----------
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const r = Math.hypot((x - cx) / R, (y - cy) / R)
      if (r < 1 && (y - cy) / R < v0 - 0.18) grid[y * W + x] = 0
    }
  }

  // ---- dots to cells -----------------------------------------------------------------------
  const BIT = [[0, 1, 2, 6], [3, 4, 5, 7]] as const
  const sprite: BhSprite = []
  for (let row = 0; row < cellRows; row++) {
    const runs: BhRun[] = []
    for (let col = 0; col < cols; col++) {
      let bits = 0
      let top = 0
      for (let dx = 0; dx < DX; dx++) {
        for (let dy = 0; dy < DY; dy++) {
          const l = grid[(row * DY + dy) * W + col * DX + dx]!
          if (l > 0) bits |= 1 << BIT[dx]![dy]!
          if (l > top) top = l
        }
      }
      const ch = bits === 0 ? ' ' : String.fromCharCode(0x2800 + bits)
      const tone = TONE[top]!
      const last = runs.at(-1)
      if (last && last.tone === tone) last.text += ch
      else runs.push({ text: ch, tone })
    }
    sprite.push(runs)
  }
  return sprite
}

const cache = new Map<string, BhSprite[]>()

/** Every frame of a cycle for a size, computed once: the same input is the same frames. */
export function frames(w: number, rows: number): BhSprite[] {
  const key = `${Math.floor(w)}x${Math.floor(rows)}`
  let list = cache.get(key)
  if (!list) {
    if (cache.size >= 12) cache.delete(cache.keys().next().value!)
    list = Array.from({ length: FRAMES }, (_, f) => drawBlackHole(w, rows, f / FRAMES))
    cache.set(key, list)
  }
  return list
}

/** The frame to draw at `ms`; null is the still frame (idle, reduced motion). */
export function blackHole(ms: number | null, w: number, rows: number, speed: BhSpeed = 'slow'): BhSprite {
  if (ms === null || !Number.isFinite(ms)) return drawBlackHole(w, rows, null)
  const cycle = CYCLE_MS[speed]
  const f = Math.floor((wrap1(ms / cycle)) * FRAMES) % FRAMES
  return frames(w, rows)[f]!
}

const wrap1 = (x: number) => x - Math.floor(x)

/** The sprite as plain text, one string a row (for tests and the colourless view). */
export function bhText(s: BhSprite): string[] {
  return s.map(r => r.map(x => x.text).join(''))
}
