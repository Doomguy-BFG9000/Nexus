// The Orbit theme's pane: the dashboard from orbitlayout.ts, the four-section settings and the
// full activity tape. Classic's views stay in views.tsx and are untouched.
import { clock, pad } from './format'
import { O, fitLine, header, keysLine, orbitLines, tapeRows } from './orbitlayout'
import type { Line } from './orbitlayout'
import { SECTIONS, SETTINGS, defaultValue, prefValue, visibility } from './prefs'
import type { SectionId, Setting } from './prefs'
import { AgentDetail } from './views'
import type { Actions, Snapshot } from './views'

type El = { Box: any; Text: any; Button?: any; Select?: any }

/** One line of coloured segments as a Text row. */
function Row({ el, line, id }: { el: El; line: Line; id: string }) {
  const { Text } = el
  return (
    <Text key={id}>
      {line.map((g, i) => (
        <Text key={`${id}-${i}`} color={g.c} bold={g.b}>
          {g.t}
        </Text>
      ))}
    </Text>
  )
}

function Rows({ el, lines, id }: { el: El; lines: Line[]; id: string }) {
  return <>{lines.map((l, i) => <Row key={`${id}-${i}`} el={el} line={l} id={`${id}-${i}`} />)}</>
}

const seg = (t: string, c?: string, b?: boolean) => ({ t, c, b })

/** Hotkeys while the pane holds the focus; a quiet hint otherwise. */
function Keys({ el, s, act, width }: { el: El; s: Snapshot; act: Actions; width: number }) {
  const { Box, Text, Button } = el
  if (!Button || !act.isFocused) return <Row el={el} line={keysLine(s, width, false)} id="keys" />
  const list = s.agents.slice(-9)
  return (
    <Box flexWrap="wrap" columnGap={2} width={width}>
      <Button key="orbit-settings" hotkey="s" label="[s] settings" plain onPress={() => act.settings()} />
      <Button key="orbit-activity" hotkey="a" label="[a] activity" plain onPress={() => act.activity()} />
      {list.map((a, i) => (
        <Button key={`inspect-${a.id}`} hotkey={String(i + 1)} label={`[${i + 1}] ${a.label}`} plain dimColor={a.status !== 'running'} onPress={() => act.inspect(a.id)} />
      ))}
      <Text color={O.dim}>ctrl+x tab to leave</Text>
    </Box>
  )
}

function Back({ el, act, label = '[b] back' }: { el: El; act: Actions; label?: string }) {
  const { Button, Text } = el
  return Button && act.isFocused ? <Button key="orbit-back" hotkey="b" label={label} plain onPress={() => act.back()} /> : <Text color={O.dim}>b or /nexus back</Text>
}

// ---- settings -------------------------------------------------------------------------------
function summary(s: Snapshot, id: SectionId): string {
  const p = s.prefs
  switch (id) {
    case 'appearance':
      return `${p.theme} · ${p.theme === 'orbit' ? (p.centerpiece === 'blackhole' ? 'black hole' : p.centerpiece) : 'original look'}`
    case 'agents':
      return `council ${p.council.activation} · tests ${p.testRunner === 'allowlist' ? 'known commands' : 'off'}`
    case 'usage':
      return `${p.telemetry.preset} · ${Object.values(visibility(p)).filter(Boolean).length} of 8 shown`
    case 'advanced':
      return `Cache Guard ${p.cacheGuard.enabled ? 'on' : 'off'} · Jev panel ${p.jev}`
  }
}

/** Choices for a numeric setting: the ends, a few steps, the current value and the default. */
export function rangeChoices(spec: Setting, current: string, def: string): string[] {
  const [lo, hi] = spec.range!
  const set = new Set<number>()
  if (hi - lo <= 12) for (let i = lo; i <= hi; i++) set.add(i)
  else for (let i = 0; i <= 5; i++) set.add(Math.round(lo + ((hi - lo) * i) / 5))
  const out = new Set<string>([...[...set].sort((a, b) => a - b).map(String)])
  if (spec.key === 'paneColumns') {
    for (const v of ['60', '80', '100', '120']) out.add(v)
    out.add('max')
  }
  for (const v of [current, def]) if (v) out.add(v)
  return [...out].sort((a, b) => (a === 'max' ? 1 : b === 'max' ? -1 : Number(a) - Number(b)))
}

/** A value as a person reads it; what is stored and what `/nexus settings` takes are unchanged. */
export function valueLabel(key: string, v: string): string {
  if (key === 'centerpiece') return { blackhole: 'Black hole', classic: 'Classic orbit', off: 'Off' }[v] ?? v
  if (key === 'animationSpeed') return { slow: 'Slow', veryslow: 'Very slow' }[v] ?? v
  if (key === 'testRunner') return { allowlist: 'Known test commands', off: 'Off' }[v] ?? v
  if (key === 'telemetry.preset') return v.charAt(0).toUpperCase() + v.slice(1)
  return v
}

function SettingRow({ el, s, act, spec, width }: { el: El; s: Snapshot; act: Actions; spec: Setting; width: number }) {
  const { Box, Text, Select } = el
  const now = prefValue(s.prefs, spec.key)
  const def = defaultValue(spec.key)
  const choices = spec.options ?? rangeChoices(spec, now, def)
  const label = pad(spec.label, 26)
  return (
    <Box flexDirection="column" width={width}>
      {Select && act.isFocused ? (
        <Select
          key={`set-${spec.key}`}
          label={label}
          value={now}
          options={choices.map(o => ({ value: o, label: o === def ? `${valueLabel(spec.key, o)} (default)` : valueLabel(spec.key, o) }))}
          onSelect={(value: string) => act.set(spec.key, value)}
        />
      ) : (
        <Text>
          <Text color={O.soft}>{label}</Text>
          <Text color={O.fg} bold>{valueLabel(spec.key, now)}</Text>
          <Text color={O.dim}>{now === def ? '  default' : `  default ${valueLabel(spec.key, def)}`}</Text>
        </Text>
      )}
      <Text color={O.dim}>  {spec.help}</Text>
    </Box>
  )
}

/** What a section shows besides its choices: read-only facts, so no setting hides in a command. */
function Facts({ el, s, id }: { el: El; s: Snapshot; id: SectionId }) {
  const { Text } = el
  if (id === 'agents') {
    return (
      <>
        <Text><Text color={O.soft}>{pad('Operating mode', 26)}</Text><Text color={O.fg}>{s.mode.selected ?? 'as launched'}</Text><Text color={O.dim}>  change with /nexus-mode</Text></Text>
        <Text><Text color={O.soft}>{pad('Agent roles', 26)}</Text><Text color={O.fg}>search · grep · audit · test</Text></Text>
        <Text color={O.dim}>  Roles are Haiku agents. NEXUS only watches them; Claude Code decides when to use one.</Text>
      </>
    )
  }
  if (id === 'advanced') {
    return (
      <>
        <Text><Text color={O.soft}>{pad('Jev routing', 26)}</Text><Text color={O.fg}>{s.jev.routing}</Text><Text color={O.dim}>  plugin option; /nexus-jev changes it for one session</Text></Text>
        <Text><Text color={O.soft}>{pad('Preferences version', 26)}</Text><Text color={O.fg}>v{s.prefs.version}</Text><Text color={O.dim}>  /nexus settings export prints them</Text></Text>
      </>
    )
  }
  return null
}

export function OrbitSettings({ el, s, act, width }: { el: El; s: Snapshot; act: Actions; width: number }) {
  const { Box, Text, Button } = el
  const ref = s.view.ref
  const rule: Line = [{ t: '─'.repeat(width), c: O.faint }]

  if (ref === 'reset-all') {
    return (
      <Box flexDirection="column" width={width}>
        <Rows el={el} lines={[[seg('Settings', O.fg, true), seg(' › ', O.faint), seg('Reset everything', O.amber, true)], rule]} id="rs" />
        <Text color={O.fg}>Put every setting back to its default?</Text>
        <Text color={O.dim}>Theme, animation, what agents may run, Council, Cache Guard and what is shown. Nothing else changes: no keys, no sessions.</Text>
        <Text> </Text>
        {Button && act.isFocused ? (
          <Box columnGap={2}>
            <Button key="reset-yes" hotkey="y" label="[y] yes, reset all" plain onPress={() => act.reset('all')} />
            <Button key="reset-no" hotkey="n" label="[n] keep my settings" plain onPress={() => act.section(null)} />
          </Box>
        ) : (
          <Text color={O.dim}>focus the pane (ctrl+x tab) to confirm, or /nexus settings reset all confirm</Text>
        )}
      </Box>
    )
  }

  const section = SECTIONS.find(x => x.id === ref)
  if (!section) {
    // The menu: four plain categories, each with where it stands.
    return (
      <Box flexDirection="column" width={width}>
        <Rows el={el} lines={[[seg('Settings', O.fg, true), seg('   kept in the plugin store · Claude Code settings are never touched', O.dim)], rule]} id="sm" />
        {SECTIONS.map((sec, i) => (
          <Box key={`sec-${sec.id}`} flexDirection="column" marginTop={1}>
            {Button && act.isFocused ? (
              <Button key={`open-${sec.id}`} hotkey={String(i + 1)} label={`[${i + 1}] ${sec.title}`} plain onPress={() => act.section(sec.id)} />
            ) : (
              <Text color={O.opus} bold>{i + 1}  {sec.title}</Text>
            )}
            <Text color={O.soft}>   {summary(s, sec.id)}</Text>
            <Text color={O.dim}>   {sec.blurb}</Text>
          </Box>
        ))}
        <Text> </Text>
        <Box columnGap={2}>
          <Back el={el} act={act} label="[x] close settings" />
          {Button && act.isFocused && <Button key="reset-all" hotkey="r" label="[r] reset everything…" plain dimColor onPress={() => act.section('reset-all')} />}
        </Box>
      </Box>
    )
  }

  // One section: only its own settings, advanced options never on the main page.
  const t = s.prefs.telemetry
  const specs = SETTINGS.filter(x => x.section === section.id).filter(x => !(x.key.startsWith('telemetry.') && x.key !== 'telemetry.preset' && t.preset !== 'custom'))
  return (
    <Box flexDirection="column" width={width}>
      <Rows el={el} lines={[[seg('Settings', O.dim), seg(' › ', O.faint), seg(section.title, O.fg, true)], rule]} id="sp" />
      <Text color={O.dim}>{section.blurb}</Text>
      <Text> </Text>
      {specs.map(spec => (
        <Box key={`row-${spec.key}`} flexDirection="column" marginBottom={1}>
          <SettingRow el={el} s={s} act={act} spec={spec} width={width} />
        </Box>
      ))}
      {section.id === 'usage' && t.preset !== 'custom' && <Text color={O.dim}>Choose “custom” above to pick each number yourself.</Text>}
      <Facts el={el} s={s} id={section.id} />
      <Text> </Text>
      <Box columnGap={2}>
        {Button && act.isFocused ? (
          <>
            <Button key="sec-back" hotkey="b" label="[b] back" plain onPress={() => act.section(null)} />
            <Button key="sec-reset" hotkey="r" label={`[r] reset ${section.title}`} plain dimColor onPress={() => act.reset(section.id)} />
            <Button key="sec-exit" hotkey="x" label="[x] exit" plain dimColor onPress={() => act.back()} />
          </>
        ) : (
          <Text color={O.dim}>focus the pane (ctrl+x tab) to change these · /nexus settings {section.id}</Text>
        )}
      </Box>
    </Box>
  )
}

// ---- activity ---------------------------------------------------------------------------------
function ActivityView({ el, s, act, width }: { el: El; s: Snapshot; act: Actions; width: number }) {
  const { Box, Text } = el
  const rows = tapeRows(s.log).slice(-40).reverse()
  return (
    <Box flexDirection="column" width={width}>
      <Rows el={el} lines={[[seg('Activity', O.fg, true), seg(`   ${rows.length} events · newest first`, O.dim)], [{ t: '─'.repeat(width), c: O.faint }]]} id="av" />
      {rows.length === 0 && <Text color={O.dim}>nothing yet</Text>}
      {rows.map((r, i) => (
        <Box key={`ev-${i}`} flexDirection="column">
          <Text>
            <Text color={O.dim}>{clock(r.at)}  </Text>
            <Text color={O.soft}>{pad(r.who, 8)}</Text>
            <Text color={r.kind === 'error' ? O.red : O.fg}>{r.text}</Text>
          </Text>
          {r.detail ? <Text color={O.dim}>{'                      '}{r.detail}</Text> : null}
        </Box>
      ))}
      <Text> </Text>
      <Back el={el} act={act} />
    </Box>
  )
}

// ---- the pane ---------------------------------------------------------------------------------
export function PaneOrbit({ el, s, width, act }: { el: El; s: Snapshot; width: number; act: Actions }) {
  const { Box } = el
  const head = <Rows el={el} lines={header(s, width).map(l => fitLine(l, width))} id="oh" />
  if (s.view.kind === 'settings') {
    return (
      <Box flexDirection="column" width={width}>
        {head}
        <Box marginTop={1}><OrbitSettings el={el} s={s} act={act} width={width} /></Box>
      </Box>
    )
  }
  if (s.view.kind === 'activity') {
    return (
      <Box flexDirection="column" width={width}>
        {head}
        <Box marginTop={1}><ActivityView el={el} s={s} act={act} width={width} /></Box>
      </Box>
    )
  }
  if (s.view.kind === 'agent') {
    return (
      <Box flexDirection="column" width={width}>
        {head}
        <AgentDetail el={el} a={s.agents.find(a => a.id === s.view.ref)} s={s} act={act} width={width} />
      </Box>
    )
  }
  // The header is part of orbitLines: draw the rest of the dashboard from it.
  return (
    <Box flexDirection="column" width={width}>
      <Rows el={el} lines={orbitLines(s, width)} id="od" />
      <Keys el={el} s={s} act={act} width={width} />
    </Box>
  )
}
