# swarm-ui

This plugin turns Claude Code's own terminal interface into the "Sonnet builds · Haiku swarms" layout. It uses the supported mod API, so there is no wrapper and no patched binary.

- **Docked pane** (`/swarm`): the Opus advisor column, the Sonnet lead box, the Jev fork layer, three Haiku subagent boxes and their connectors. The full layout needs a pane body of at least 84 columns, which means a terminal about 190+ columns wide (a pane can take at most 45% of the width). Narrower terminals get a stacked layout, then a one-line list.
- **Band above the prompt**: the session log and the `haiku [...] subagents [...] opus [...] jev [...]` status row.
- **Spinner**: drawn in the lead's orange, or the swarm's blue when a subagent's spinner is showing.

The pane only docks in the fullscreen TUI (`"tui": "fullscreen"`). Other surfaces (VS Code, desktop) keep their own look.

## Model modes (`/swarm-mode`)
| Mode | Main | Advisor | Measured cost of a cold one-line turn |
|---|---|---|---|
| Balanced | Sonnet 5.5, high | Opus 5.5 | $0.10 |
| Deep Engineering | Opus 5.5, xhigh | Fable 5.1 | $0.20 (plus Fable advisor calls, billed to usage credits) |
| Maximum Reasoning | Fable 5.1, max | Fable 5.1 | $0.52, billed to usage credits |

`/swarm-mode` opens a dialog; `/swarm-mode balanced|deep|max|default|status` does the same without it.
- **Applied now, this session only:** the main model and effort. A `turn.step` hook rewrites the main loop's requests; subagents are never rewritten.
- **Advisor:** never changed in-session. `/advisor` would save your default for every session, so this mod never runs it. When a mode needs a different advisor, it prints a relaunch command (`claude --resume <id> --model … --effort … --settings '{"advisorModel":"…"}'`) whose advisor lasts only for that process.
- **Pairing rule:** a rewrite whose main model outranks the session's advisor is refused, with the reason (for example, Fable under an Opus advisor). The API rejects such a request with a 400, and the engine retries it without the advisor.
- **Escalation:**
  - Before a prompt that looks like a harder task, a native dialog offers: keep the current mode, switch to the recommended one, or choose manually.
  - The decision uses keyword rules first; when they're unsure, Haiku is asked, at most 20 times a session.
  - It never switches without a yes. Dismissing the dialog keeps the current mode.
- **Per-call advisor approval:** not possible. The advisor runs inside the API request and is reported only after it ends, so its pulse plays when the step finishes.

## Options (`/config`, plugin rows)
- `escalation`: `ask` or `off`.
- `classifier`: the Haiku check, on or off.
- `motion`: `auto` (follows Claude Code's `reduceMotion`), `reduced` or `full`.

Animations are driven by real events only. They run at 10 frames a second while an effect plays and stop when idle. With reduced motion, nothing moves, and counters redraw once a second while work runs.

## Jev routing (`/swarm-jev`)
| Setting | What Jev does |
|---|---|
| `observe` (default) | Its answers are drawn and logged; nothing changes. |
| `active` | First, 6 fixed calibration cases must pass this session (no unsafe answer, at least 2/3 right). After that, Jev acts on only two decisions, both limited to the lead's own `Read`/`LSP` calls that the engine marked read-only (see below). |
| `off` | No Jev requests at all. |

What `active` may do:
- **Retry:** a failed read-only call runs once more when Jev answers `retry` (at most 5 per session). Only the failure's kind is sent (for example "file not found"), never the message or a path.
- **Next-file hint:** after a read inside the workspace, Jev picks among that file's visible sibling files. Its pick is attached to the result as an optional note. The model still decides.

The bar for acting is p ≥ 0.85 and confidence ≥ 0.6. Anything below it, a missing answer, a timeout, the rate limit or the budget falls back to the lead with nothing changed. Jev never touches shell commands, edits, writes, permissions, subagents, commits or anything outside the workspace.

`/swarm-jev observe` (or `off`) turns active routing off at once. The `jevRouting` option in `/config` sets the starting value; active mode still runs the calibration first.

## Jev key
The key comes from `TYPESAFE_API_KEY` or, failing that, from the login Keychain item `claude-swarm-typesafe` (`security add-generic-password -s claude-swarm-typesafe -a "$USER" -w`). It's held in memory only and never drawn or logged.

## Where the numbers come from
| Shown | Source |
|---|---|
| lead model, effort, ctx, steps | `turn.step` (model, effort, usage) for the main loop |
| advisor calls, last advice, context read | `serverToolUses` named `advisor` in `turn.step`. "context read" is the lead's context size at that call |
| agent boxes | `agent.spawn`, plus `turn.step` and `tool.call` carrying the agent's id, plus `classic.SubagentStop` |
| `2/25` bars | turns made out of the agent definition's `maxTurns` (no bar if the definition has none) |
| Jev | TypeSafe Jev answers (observe-only): probability (the 0.85 threshold), confidence, tool agreement, spend |
| models | the lead's model is the one each response reports (`usage.model`); the advisor is the session's setting, since the API doesn't name it per call |

Anything never reported shows `N/A`. Nothing is simulated.

## Install (user scope, all projects)
```sh
claude plugin marketplace add "<repo>/mod"
claude plugin install swarm-ui@swarm-local --scope user
```
The marketplace is a local folder, so after an edit, run `/reload-plugins` in a session.

## Check after a Claude Code update
```sh
claude plugin validate mod/swarm-ui && claude plugin test mod/swarm-ui
```
The mod API is early access. A hook that breaks is skipped on its own, and Claude Code keeps working.

## Remove
```sh
claude plugin uninstall swarm-ui@swarm-local
```
