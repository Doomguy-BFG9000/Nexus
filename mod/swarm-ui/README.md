# swarm-ui

This plugin turns Claude Code's own terminal interface into the "Sonnet builds · Haiku swarms" layout. It uses the supported mod API, so there is no wrapper and no patched binary.

- **Docked pane** (`/swarm`): the Opus advisor column, the Sonnet lead box, the Jev fork layer, three Haiku subagent boxes and their connectors. The full layout needs a pane body of at least 84 columns, which means a terminal about 190+ columns wide (a pane can take at most 45% of the width). Narrower terminals get a stacked layout, then a one-line list.
- **Band above the prompt**: the session log and the `haiku [...] subagents [...] opus [...] jev [...]` status row.
- **Spinner**: drawn in the lead's orange, or the swarm's blue when a subagent's spinner is showing.

The pane only docks in the fullscreen TUI (`"tui": "fullscreen"`). Other surfaces (VS Code, desktop) keep their own look.

## Where the numbers come from
| Shown | Source |
|---|---|
| lead model, effort, ctx, steps | `turn.step` (model, effort, usage) for the main loop |
| advisor calls, last advice, context read | `serverToolUses` named `advisor` in `turn.step`. "context read" is the lead's context size at that call |
| agent boxes | `agent.spawn`, plus `turn.step` and `tool.call` carrying the agent's id, plus `classic.SubagentStop` |
| `2/25` bars | turns made out of the agent definition's `maxTurns` (no bar if the definition has none) |
| Jev | TypeSafe Jev answers (observe-only), only when `TYPESAFE_API_KEY` is set |

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
