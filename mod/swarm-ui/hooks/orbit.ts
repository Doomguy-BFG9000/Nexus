// Swarm Orbit: the animation family, drawn from geometry rather than canned
// frames. Satellites move by angle; radii ease in and out; trails are earlier
// angles. A terminal cell is about twice as tall as it is wide, so x is
// stretched by 2 to keep orbits round. Pure: a sprite is rows of tone runs.
//
// Every sprite has a still form for reduced motion, and none moves unless the
// caller passes a phase taken from a real event (a running agent, a working
// lead, a reported advisor call, a Jev answer, a Cache Guard refresh).

/** Plain tones, plus four role tones (lead, agents, advisor, Jev) for the NEXUS mark. */
export type Tone = 'core' | 'sat' | 'trail' | 'faint' | 'blank' | 'r1' | 'r2' | 'r3' | 'r4'
export type Run = { text: string; tone: Tone }
export type Sprite = Run[][]

type Cell = { ch: string; tone: Tone; rank: number }
const RANK: Record<Tone, number> = { blank: 0, faint: 1, trail: 2, sat: 3, r1: 3, r2: 3, r3: 3, r4: 3, core: 4 }

export const ease = (t: number) => -(Math.cos(Math.PI * Math.min(1, Math.max(0, t))) - 1) / 2
const TAU = Math.PI * 2

class Grid {
  cells: Cell[][]
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.cells = Array.from({ length: h }, () => Array.from({ length: w }, () => ({ ch: ' ', tone: 'blank' as Tone, rank: 0 })))
  }
  get cx() {
    return (this.w - 1) / 2
  }
  get cy() {
    return (this.h - 1) / 2
  }
  /** Puts a glyph at radius r (in rows) and angle a around the centre; the higher tone wins a cell. */
  polar(r: number, a: number, ch: string, tone: Tone) {
    this.put(this.cx + 2 * r * Math.cos(a), this.cy + r * Math.sin(a), ch, tone)
  }
  put(x: number, y: number, ch: string, tone: Tone) {
    const col = Math.round(x)
    const row = Math.round(y)
    if (row < 0 || row >= this.h || col < 0 || col >= this.w) return
    const cell = this.cells[row]![col]!
    if (RANK[tone] >= cell.rank) this.cells[row]![col] = { ch, tone, rank: RANK[tone] }
  }
  sprite(): Sprite {
    return this.cells.map(row => {
      const runs: Run[] = []
      for (const c of row) {
        const last = runs.at(-1)
        if (last && last.tone === c.tone) last.text += c.ch
        else runs.push({ text: c.ch, tone: c.tone })
      }
      return runs
    })
  }
}

const cyc = (ms: number, period: number) => (((ms % period) + period) % period) / period

// ---- Sonnet / lead: Core Orbit ----------------------------------------------
/** Four satellites round an orange core; the ring breathes out and regroups. */
export function coreOrbit(ms: number | null): Sprite {
  const g = new Grid(7, 3)
  g.put(g.cx, g.cy, '●', 'core')
  const still = ms === null
  const a0 = still ? Math.PI / 4 : TAU * cyc(ms, 1600)
  const r = still ? 1 : 0.75 + 0.35 * ease(0.5 + 0.5 * Math.sin(TAU * cyc(ms, 2400)))
  for (let k = 0; k < 4; k++) {
    const a = a0 + (k * TAU) / 4
    if (!still) g.polar(r * 0.9, a - 0.5, '·', 'faint')
    g.polar(r * 0.9, a, '∙', 'sat')
  }
  return g.sprite()
}

// ---- Haiku: Swarm Orbit -----------------------------------------------------
export type AgentPhase =
  | { state: 'idle' }
  | { state: 'running'; sinceStart: number }
  | { state: 'done'; sinceEnd: number }
  | { state: 'failed' }
  | { state: 'cancelled' }

/** Above each card: grows in, orbits, disperses and regroups while the agent runs. */
export function swarmOrbit(p: AgentPhase, isStill: boolean): Sprite {
  const g = new Grid(9, 3)
  if (p.state === 'idle') {
    g.put(g.cx, g.cy, '·', 'faint')
    return g.sprite()
  }
  if (p.state === 'failed') {
    g.put(g.cx, g.cy, '◌', 'core')
    return g.sprite()
  }
  if (p.state === 'cancelled') {
    g.put(g.cx, g.cy, '◌', 'faint')
    return g.sprite()
  }
  if (p.state === 'done') {
    // One outward pulse, then a still success mark.
    const t = isStill ? 1 : Math.min(1, p.sinceEnd / 800)
    g.put(g.cx, g.cy, '◉', 'core')
    if (t < 1) for (let k = 0; k < 6; k++) g.polar(0.8 + 1.4 * ease(t), (k * TAU) / 6, t < 0.6 ? '∙' : '·', t < 0.6 ? 'sat' : 'faint')
    return g.sprite()
  }
  if (isStill) {
    g.put(g.cx, g.cy, '●', 'core')
    for (let k = 0; k < 3; k++) g.polar(1, (k * TAU) / 3 + Math.PI / 6, '•', 'sat')
    return g.sprite()
  }
  const grow = Math.min(1, p.sinceStart / 600)
  const c = cyc(p.sinceStart, 2400)
  let r: number
  let glyph = '•'
  let tone: Tone = 'sat'
  if (grow < 1) r = ease(grow)
  else if (c < 0.6) r = 1
  else if (c < 0.78) {
    r = 1 + 0.7 * ease((c - 0.6) / 0.18)
    glyph = '·'
    tone = 'trail'
  } else r = 1.7 - 1.3 * ease((c - 0.78) / 0.22)
  const a0 = TAU * cyc(p.sinceStart, 1200)
  g.put(g.cx, g.cy, grow < 0.5 ? '∘' : '●', 'core')
  for (let k = 0; k < 3; k++) {
    const a = a0 + (k * TAU) / 3
    g.polar(r, a - 0.6, '·', 'faint')
    g.polar(r, a, glyph, tone)
  }
  return g.sprite()
}

/** Five cells wide: in the corner of an agent card. */
export const MINI_W = 5

/**
 * The Haiku orbit seen edge-on, in one row: two satellites swing past the
 * core, bright while in front of it, dim behind. Still glyphs for every state
 * but running; a running agent's phase comes from its real start time.
 */
export function miniOrbit(p: AgentPhase, isStill: boolean): Sprite {
  const g = new Grid(MINI_W, 1)
  const mid = (MINI_W - 1) / 2
  if (p.state === 'idle') g.put(mid, 0, '·', 'faint')
  else if (p.state === 'failed') g.put(mid, 0, '◌', 'core')
  else if (p.state === 'cancelled') g.put(mid, 0, '◌', 'faint')
  else if (p.state === 'done') {
    g.put(mid, 0, '◉', 'core')
    // The final outward pulse, once.
    if (!isStill && p.sinceEnd < 600) {
      const d = p.sinceEnd < 300 ? 1 : 2
      g.put(mid - d, 0, '·', 'sat')
      g.put(mid + d, 0, '·', 'sat')
    }
  } else if (isStill) {
    g.put(mid, 0, '●', 'core')
    g.put(mid - 2, 0, '∙', 'trail')
    g.put(mid + 2, 0, '∙', 'trail')
  } else {
    const grow = Math.min(1, p.sinceStart / 600)
    g.put(mid, 0, grow < 0.5 ? '∘' : '●', 'core')
    const a = TAU * cyc(p.sinceStart, 1400)
    for (const off of [0, Math.PI]) {
      const x = mid + 2 * grow * Math.cos(a + off)
      const isFront = Math.sin(a + off) > 0
      g.put(x, 0, isFront ? '•' : '·', isFront ? 'sat' : 'faint')
    }
  }
  return g.sprite()
}

// ---- Opus / Fable advisor: Dual-Orbit Resonance ------------------------------
export type DualVariant = 'tight' | 'wide'

export const DUAL = {
  tight: { w: 13, h: 5, r: 1.3, cycleMs: 2400 },
  wide: { w: 21, h: 7, r: 2.4, cycleMs: 3000 },
} as const

/**
 * Dual-Orbit Resonance. Two satellites on their own tilted orbits turn in
 * opposite directions, each trailing a short comet tail. Their radii breathe
 * out, then each breaks into points that spread along its path, and the
 * points draw back together into the satellite. The angle never jumps, so the
 * end of one cycle is the start of the next. `ms` is the time since a
 * consultation was reported; null draws the resting form.
 */
export function dualOrbit(variant: DualVariant, ms: number | null): Sprite {
  const v = DUAL[variant]
  const g = new Grid(v.w, v.h)
  if (ms === null) {
    // At rest: the faint orbit path, the core, two satellites parked opposite.
    for (let k = 0; k < 16; k++) g.polar(v.r, (k * TAU) / 16, '·', 'faint')
    g.polar(v.r, Math.PI, '∘', 'trail')
    g.polar(v.r, 0, '∘', 'trail')
    g.put(g.cx, g.cy, '◇', 'core')
    return g.sprite()
  }
  const c = cyc(ms, v.cycleMs)
  // Whole turns per cycle keep the loop seamless: A turns once, B turns twice the other way.
  const angA = TAU * c - Math.PI / 2
  const angB = -2 * TAU * c + Math.PI / 2
  // Radius: grows from the core over the first fifth, breathes, holds while dispersed.
  const grow = ease(Math.min(1, c / 0.2))
  const breathe = 1 + 0.12 * Math.sin(TAU * 2 * c)
  // Dispersal: 0.55-0.75 spread out, 0.75-0.95 gather back, then whole again.
  const spread = c < 0.55 ? 0 : c < 0.75 ? ease((c - 0.55) / 0.2) : c < 0.95 ? 1 - ease((c - 0.75) / 0.2) : 0
  g.put(g.cx, g.cy, spread > 0.5 ? '◈' : grow < 0.4 ? '∘' : '●', 'core')
  const sat = (angle: number, dir: 1 | -1, rScale: number) => {
    const r = v.r * rScale * grow * breathe
    // Tilt B's orbit by squashing it: a second plane, not a mirror of A.
    const at = (a: number) => [r * Math.cos(a), r * Math.sin(a) * (rScale < 1 ? 0.6 : 1)] as const
    const place = (a: number, ch: string, tone: Tone) => {
      const [x, y] = at(a)
      g.put(g.cx + 2 * x, g.cy + y, ch, tone)
    }
    if (spread > 0.02) {
      // Points along the path, spreading with `spread`, fading as they go.
      for (const k of [-2, -1, 1, 2]) place(angle + k * 0.45 * spread, Math.abs(k) === 1 ? '•' : '·', Math.abs(k) === 1 ? 'trail' : 'faint')
      place(angle, spread > 0.6 ? '∙' : '●', spread > 0.6 ? 'trail' : 'sat')
      return
    }
    place(angle - dir * 0.5, '·', 'faint')
    place(angle - dir * 0.25, '∙', 'trail')
    place(angle, '●', 'sat')
  }
  sat(angA, 1, 1)
  sat(angB, -1, 0.72)
  return g.sprite()
}

// ---- NEXUS mark: the logo beside the wordmark --------------------------------
export const LOGO = { w: 11, h: 3, cycleMs: 2600 }
const ROLE_TONES: Tone[] = ['r1', 'r2', 'r3', 'r4']

/**
 * The NEXUS mark. Still: the hub and its four role-coloured nodes on the
 * diagonals. Moving (while a turn runs): the nodes revolve, breathe out,
 * scatter into points and gather back, one seamless cycle every 2.6 s.
 */
export function nexusLogo(ms: number | null): Sprite {
  const g = new Grid(LOGO.w, LOGO.h)
  g.put(g.cx, g.cy, '◉', 'core')
  if (ms === null) {
    ROLE_TONES.forEach((t, k) => g.polar(1.15, Math.PI / 4 + (k * TAU) / 4 + Math.PI, '•', t))
    return g.sprite()
  }
  const c = cyc(ms, LOGO.cycleMs)
  const a0 = TAU * c + (5 * Math.PI) / 4
  const scatter = c < 0.6 ? 0 : c < 0.8 ? ease((c - 0.6) / 0.2) : 1 - ease((c - 0.8) / 0.2)
  const r = 1.0 + 0.25 * Math.sin(TAU * c) ** 2 + 0.55 * scatter
  ROLE_TONES.forEach((t, k) => {
    const a = a0 + (k * TAU) / 4
    if (scatter > 0.3) {
      g.polar(r, a - 0.35 * scatter, '·', t)
      g.polar(r, a + 0.35 * scatter, '·', t)
    } else {
      g.polar(r * 0.9, a - 0.45, '·', 'faint')
      g.polar(r, a, '•', t)
    }
  })
  return g.sprite()
}

// ---- Jev: Decision Orbit -----------------------------------------------------
export type JevOutcome = 'accepted' | 'fallback' | 'observed'

/** A green arc from left to right over the top of the orbit, ending in the outcome's mark. */
export function decisionOrbit(outcome: JevOutcome | null, ms: number | null, isStill: boolean): Sprite {
  const g = new Grid(9, 3)
  if (outcome === null || ms === null) {
    g.put(g.cx, g.cy, '·', 'faint')
    return g.sprite()
  }
  const end = outcome === 'accepted' ? '◆' : outcome === 'fallback' ? '↩' : '·'
  const t = isStill ? 1 : Math.min(1, ms / 700)
  if (t >= 1) {
    g.put(g.cx, g.cy, end, outcome === 'observed' ? 'faint' : 'core')
    return g.sprite()
  }
  g.put(g.cx, g.cy, '∘', 'faint')
  const a = Math.PI + Math.PI * ease(t)
  g.polar(1, a - 0.5, '·', 'trail')
  g.polar(1, a, '●', 'sat')
  return g.sprite()
}

/** The decision arc in one row (for the Jev header): a dot crosses, then the outcome's mark. */
export function decisionMini(outcome: JevOutcome | null, ms: number | null, isStill: boolean): Sprite {
  const g = new Grid(MINI_W, 1)
  const mid = (MINI_W - 1) / 2
  if (outcome === null || ms === null) {
    g.put(mid, 0, '·', 'faint')
    return g.sprite()
  }
  const t = isStill ? 1 : Math.min(1, ms / 700)
  if (t >= 1) {
    g.put(mid, 0, outcome === 'accepted' ? '◆' : outcome === 'fallback' ? '↩' : '·', outcome === 'observed' ? 'faint' : 'core')
    return g.sprite()
  }
  const x = (MINI_W - 1) * ease(t)
  g.put(x - 1, 0, '·', 'trail')
  g.put(x, 0, '●', 'sat')
  return g.sprite()
}

// ---- Cache Guard: Refresh Orbit ----------------------------------------------
const SWEEP = ['◜', '◝', '◞', '◟']

/** One cell: a teal sweep only while a refresh runs; a still mark otherwise. */
export function refreshOrbit(state: string, ms: number | null, isStill: boolean): string {
  if (state === 'REFRESHING') return isStill || ms === null ? '◌' : SWEEP[Math.floor(ms / 125) % 4]!
  if (state === 'WARM') return '●'
  if (state === 'ARMED') return '◌'
  if (state === 'ERROR' || state === 'EXPIRED') return '◍'
  return '·'
}

/** Plain text of a sprite, for previews and tests. */
export function plain(s: Sprite): string[] {
  return s.map(row => row.map(r => r.text).join(''))
}
