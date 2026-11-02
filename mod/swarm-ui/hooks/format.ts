// Palette sampled from the reference screenshot.
export const C = {
  bg: '#16171d',
  fg: '#d6d8e0',
  dim: '#6c7086',
  orange: '#eb9a6c',
  purple: '#a99cf2',
  green: '#86d9a2',
  blue: '#7ea8f5',
  amber: '#e6c07b',
  red: '#e88388',
  // Lit frames of the event animations.
  orangeHi: '#ffc39a',
  purpleHi: '#d4ccff',
  purpleBg: '#2a2b38',
  blueHi: '#b9d0ff',
  greenHi: '#b8f5cb',
  freshBg: '#23242e',
}

/** `claude-sonnet-5-5` -> `sonnet 5.5`; anything else is shown as given. */
export function modelLabel(id: string | null | undefined): string {
  if (!id) return 'N/A'
  const m = /claude-([a-z]+)-(\d+)-(\d+)/.exec(id)
  if (m) return `${m[1]} ${m[2]}.${m[3]}`
  return id
}

export function compact(n: number | null | undefined): string {
  if (n === null || n === undefined) return 'N/A'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

export function clock(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

/** A bar of `width` cells filled by `ratio` (0..1). */
export function bar(ratio: number, width: number): [string, string] {
  const full = Math.max(0, Math.min(width, Math.round(ratio * width)))
  return ['█'.repeat(full), '░'.repeat(width - full)]
}

export function pad(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length)
}

/** `swarm-search` -> `search`; other agent types keep their name. */
export function role(type: string): string {
  return type.startsWith('swarm-') ? type.slice(6) : type
}

export const SPIN = ['◐', '◓', '◑', '◒']
