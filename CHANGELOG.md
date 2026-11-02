# Changelog (swarm-ui)

## 0.4.1 (2026-11-02): NEXUS polish
- NEXUS branding in the pane: a spaced wordmark header with the mode and running models, with room above it. Command and plugin ids are unchanged.
- Haiku cards are fixed-size (7 rows). The orbit sits in the top-right corner as a one-row edge-on orbit, the status row is always last, and text is cut with `…`. The floating orbit row above the cards is gone.
- The advisor panel is grouped into bands (model and status, orbit, stats with placeholders, pair check and recent calls) and ends with its content. At rest, the orbit shows a dim constellation instead of a single glyph.
- The lead orbit is narrower; the Jev header's decision arc is one row.

## 0.4.0 (2026-11-02)
- Advisor sidebar shows data only: model, last consultation, calls, context, duration, short history; "Awaiting consultation." when empty.
- Agent inspection: each instance has its own label (`search#2`), fallback agents are marked, and an agent's lifecycle, tokens, files, recent activity and result can be opened. Use `/swarm agents`, `/swarm inspect`, or hotkeys 1–9 in the focused pane.
- Layouts auto/full/compact/minimal and `/swarm settings`, kept in the plugin's own store.
- Telemetry: main-thread context from Claude Code, session cost labelled "API est.", tokens per model counted once.
- USAGE monitor: only the rate-limit windows Claude Code reports; a Fable row only when Claude Code names one.
- Swarm Orbit animations: lead, Haiku, advisor (Dual-Orbit, wide and tight), Jev and Cache Guard.
- Cache Guard (off by default): idle-time cache warming through model forks, inspired by Cachebeat.
- MIT licence; GitHub marketplace manifest at the repository root.

## 0.3.0
- Active Jev routing for the lead's read-only calls, gated by calibration (`/swarm-jev`).

## 0.2.x
- Session-scoped model modes (`/swarm-mode`), escalation dialog, event animations, Jev Keychain key.

## 0.1.0
- Native pane, band and spinner in Claude Code's own terminal.
