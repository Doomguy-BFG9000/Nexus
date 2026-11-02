<div align="center">

<img src="docs/media/nexus-mark.gif" alt="NEXUS: multi-agent command center" width="560">

**A live command center for Claude Code, drawn right inside its own terminal.**

Watch your lead model, its Haiku subagents, the advisor and the Jev router work, as it happens.

![version](https://img.shields.io/badge/version-0.5.0-a99cf2?style=flat-square&labelColor=16171d)
![Claude Code](https://img.shields.io/badge/Claude%20Code-2.1.316-eb9a6c?style=flat-square&labelColor=16171d)
![native plugin](https://img.shields.io/badge/native-plugin%20API-7ea8f5?style=flat-square&labelColor=16171d)
![license](https://img.shields.io/badge/license-MIT-86d9a2?style=flat-square&labelColor=16171d)

[Install](#install) · [Tour](#a-tour-of-the-dashboard) · [Commands](#commands) · [Modes](#model-modes) · [Cache Guard](#cache-guard) · [FAQ](#faq)

</div>

<br>

<div align="center">
<img src="docs/media/nexus-demo.gif" alt="A real turn at 1080p: two Haiku agents run in parallel, finish, and the advisor is consulted" width="100%">
<br>
<sub>A real turn, recorded live at 1920×1080 and played at 1.6× speed: two Haiku agents run side by side, finish, and the Opus advisor is consulted. Nothing on screen is simulated.<br><a href="docs/media/nexus-demo-1080p.mp4"><b>▶ Watch the full 1080p video</b></a></sub>
</div>

<br>

## Why NEXUS

Claude Code already delegates to subagents and consults an advisor, but all of that happens out of sight. NEXUS docks a dashboard beside your conversation that shows it as it happens:

|  |  |
|---|---|
| **Who's working** | The lead's real model and effort, every subagent with its own live card, the advisor's consultations, Jev's routing answers. |
| **What it costs** | Context used and left, the session's API-priced estimate, and your plan's 5-hour and weekly windows, all from Claude Code itself. |
| **Control** | Switch reasoning modes, inspect any agent, choose a layout, and optionally keep the prompt cache warm while you're away. |

It's a native Claude Code plugin built on the supported mod API: no wrapper app, no second terminal, no patched binary. Your prompt, permissions, shortcuts and sessions work exactly as before.

> **Honest by design.** Every number comes from Claude Code. Anything it doesn't report reads `N/A`, and estimates are labelled `API est.`

<br>

## Install

```sh
claude plugin marketplace add muhzain05/Nexus
claude plugin install swarm-ui@claude-swarm --scope user
```

Start a new `claude` session in the **fullscreen TUI** (`"tui": "fullscreen"` in your Claude Code settings). On a wide terminal NEXUS docks on its own; anywhere else, type `/nexus`.

<details>
<summary>From a local clone</summary>

```sh
git clone https://github.com/muhzain05/Nexus
claude plugin marketplace add ./Nexus
claude plugin install swarm-ui@claude-swarm --scope user
```
</details>

**Quick start:** open it with `/nexus` → ask for some real work (*"map this repo with subagents, then summarize"*) and watch the agents run → try `/nexus-mode` and `/nexus usage`.

New to it? `/nexus-about` explains everything in the terminal, and `/nexus-help` lists every command.

<br>

## A tour of the dashboard

<img src="docs/screenshots/nexus-dashboard.png" alt="The NEXUS dashboard mid-turn" align="right" width="430">

**① Header.** The NEXUS mark moves for as long as a turn runs, agents included, and settles when it ends. The **⚙** opens settings.

**② Advisor.** The advisor model (Opus 5.5, or Fable 5.1 in the stronger modes), when it was last consulted, how often and for how long, and how much context it read. It shows *Awaiting consultation.* until the first call.

**③ Lead.** The model that actually answered, its effort, and whether it's working, idle or waiting on you.

**④ Jev.** Routing answers as green bars: bright when **sharp** (≥ 0.85), muted when **split**.

**⑤ Agents.** One fixed card per agent instance (`search#1`, `grep#1`, …), each with a small orbit in its corner and its state on the bottom row. Agents outside your configured set are marked *fallback*.

**⑥ Cache Guard and USAGE.** The optional cache keeper, then your plan's rate-limit windows.

**⑦ Bottom left.** Context used and left, the session estimate, the running models and the current mode.

<br clear="right">

<br>

### Motion that means something

Every animation starts from a real event and stops when it ends. When nothing is happening, NEXUS doesn't redraw at all, and reduced motion swaps every animation for a still frame.

<div align="center">
<img src="docs/media/orbits.gif" alt="The NEXUS mark, lead, Haiku and Jev animations" width="760">
<br><br>
<img src="docs/media/advisor-orbit.gif" alt="The advisor's Dual-Orbit animation" width="520">
<br>
<sub>The advisor runs inside an API request, so Claude Code reports it only once that request ends. Its animation plays then, marked "reported just now", and never pretends to be live.</sub>
</div>

<br>

### Inspect any agent

Click the dashboard (or press `ctrl+x tab`) and press `1`–`9`, or type `/nexus inspect search#2`. You get the agent's task, state and run time, turns over its limit, tool calls, files touched, recent actions, tokens, and its final answer.

<div align="center"><img src="docs/screenshots/inspect.png" alt="Agent detail view: in the dashboard and in the conversation" width="100%"></div>

<br>

### Settings, help and onboarding

<table>
<tr>
<td width="50%"><img src="docs/screenshots/nexus-settings.png" alt="NEXUS settings"></td>
<td width="50%"><img src="docs/screenshots/nexus-help.png" alt="/nexus-help"></td>
</tr>
<tr>
<td align="center"><sub><b>⚙ Settings</b>: layout, motion, telemetry, log rows, Jev, Cache Guard. Kept in the plugin's own store; your Claude Code settings are never touched.</sub></td>
<td align="center"><sub><b>/nexus-help</b>: every command and shortcut, drawn in the transcript</sub></td>
</tr>
</table>

<div align="center"><img src="docs/screenshots/nexus-about.png" alt="/nexus-about" width="100%"><br><sub><b>/nexus-about</b>: a first-run guide with a three-step quick start</sub></div>

<br>

## Commands

| Command | What it does |
|---|---|
| `/nexus` | open the dashboard · `close` to close it |
| `/nexus layout auto\|full\|compact\|minimal` | switch layouts (auto picks by width) |
| `/nexus settings [key value]` | open settings, or change one |
| `/nexus width max\|40-200\|wider\|narrower` | pane width (a width you drag by hand wins) |
| `/nexus agents` · `/nexus inspect <n\|label>` | list agents · open one |
| `/nexus usage` | context, cost estimate, plan usage, tokens by model |
| `/nexus-mode [balanced\|deep\|max\|default\|status]` | reasoning mode for this session |
| `/nexus-jev [status\|active\|observe\|off\|calibrate]` | Jev routing |
| `/nexus cache [on\|off]` | Cache Guard |
| `/nexus doctor` | check the install and integrations |
| `/nexus-help` · `/nexus-about` | reference · introduction |

**Keys, with the dashboard focused:** `1`–`9` inspect · `s` settings · `b` back · `ctrl+x ←/→` resize · `ctrl+x x` close · `esc` back to the prompt.

<sub>Upgrading from the Swarm names? `/swarm`, `/swarm-mode` and `/swarm-jev` still work for now and point you to the new command. Your preferences carry over.</sub>

<br>

## Model modes

| Mode | Lead | Advisor | When |
|---|---|---|---|
| **Balanced** *(default)* | Sonnet 5.5 · high | Opus 5.5 | everyday work |
| **Deep Engineering** | Opus 5.5 · xhigh | Fable 5.1 | refactors, tricky bugs, architecture |
| **Maximum Reasoning** | Fable 5.1 · max | Fable 5.1 | the hardest problems |

`/nexus-mode` switches the lead for this session only. Before a hard-looking prompt, NEXUS can suggest a stronger mode in a dialog, and **it never switches without your yes**. Fable bills to usage credits.

An advisor must rank at least as high as the lead, and Claude Code only lets an advisor change by relaunching the conversation. So when a mode needs a different advisor, NEXUS prints a one-line relaunch command that applies just to that session. Your saved defaults are never edited.

<br>

## What the numbers mean

| On screen | Meaning | Source |
|---|---|---|
| `context 53k / 1.0M · 947k left · 5%` | how full the lead's context window is now | Claude Code's status-line figures |
| `session $0.11 API est.` | this session at API prices; on a subscription, an estimate, not a charge | Claude Code's `/cost` ledger |
| `5h ███░░ 17%` · `7d █░░░ 9%` | your plan's rate-limit windows, with local reset times | the rate-limit windows Claude Code receives |
| tokens by model | each request counted once, lead and agents apart | Claude Code's per-request usage |

Your plan name and a Fable weekly window appear only if Claude Code reports them; nothing is guessed. Plan figures go grey and say **stale** after 15 minutes without a response.

<br>

## Jev

[TypeSafe](https://typesafe.ai) Jev answers small routing questions about the lead's next step: which file, which tool, retry or stop. It's **optional and observe-only by default**.

`/nexus-jev active` first runs six calibration cases. After that, and only for the lead's own read-only `Read`/`LSP` calls, Jev may re-run a failed read once or attach an optional "next file" note, and only when it's sure (p ≥ 0.85 and confidence ≥ 0.6). It never touches shell commands, edits, permissions or subagents.

<details>
<summary>Setting the key</summary>

Export `TYPESAFE_API_KEY`, or on macOS store it in the Keychain:
```sh
security add-generic-password -s claude-swarm-typesafe -a "$USER" -w
```
NEXUS holds it in memory only; it's never drawn or logged. Only tool names, file basenames and error *kinds* are ever sent to Jev.
</details>

<br>

## Cache Guard

Claude Code's prompt cache expires after you've been idle a while, and the next message pays to re-read the whole conversation. **Cache Guard** (off by default) sends a small, invisible beat after a set number of idle minutes to keep that cache warm.

- **How a beat works:** it's a Claude Code model fork. A fork adds no conversation turn or transcript entry, has every tool denied, and is unseen by NEXUS's own hooks.
- **When it won't beat:** never while the lead works, an agent runs or a permission dialog waits.
- **When it stops itself:** after its hours cap, beat count or budget, or once idle time has passed the cache's lifetime.
- **It doesn't assume the cache lasts an hour:** it waits for evidence, or for your `trustTtl` setting.

| You come back… | without Cache Guard | with Cache Guard |
|---|---|---|
| before the cache expires | ~0.1× (cache read) | ~0.1× (no beat needed) |
| after it expires | ~2× (rebuild) | ~0.1× per beat, then ~0.1× |
| never | 0 | every beat was extra |

<sub>Multiples of the conversation's input price, per Anthropic's cache pricing. NEXUS reports what beats cost and shows savings as N/A, because it can't know whether you'll return.</sub>

<sub>Cache Guard draws inspiration from <a href="https://github.com/ARahim3/cachebeat">Cachebeat</a> by <a href="https://github.com/ARahim3">Abdur Rahim (@ARahim3)</a>. It's written independently; no Cachebeat code is reused and no endorsement is implied. See <a href="../../ACKNOWLEDGMENTS.md">ACKNOWLEDGMENTS</a>.</sub>

<br>

## FAQ

<details>
<summary><b>The dashboard doesn't appear.</b></summary>

Use the fullscreen TUI and type `/nexus`. `/nexus doctor` checks the setup. On narrow terminals, use `/nexus layout compact` or `minimal`.
</details>

<details>
<summary><b>Why can't the pane get wider?</b></summary>

Claude Code caps a docked pane at 45% of the terminal and keeps at least 60 columns for the conversation. NEXUS asks for the maximum. A wider window or a smaller font gives it more room.
</details>

<details>
<summary><b>Why does an agent card say Sonnet instead of Haiku?</b></summary>

That's one of Claude Code's built-in agents (such as Explore), not one of your Haiku agents. NEXUS marks it *fallback* and shows the model it actually ran on.
</details>

<details>
<summary><b>Does NEXUS change my Claude Code settings?</b></summary>

No. Its preferences live in the plugin's own store, and modes apply to the current session only.
</details>

<details>
<summary><b>Uninstall</b></summary>

```sh
claude plugin uninstall swarm-ui@claude-swarm
claude plugin marketplace remove claude-swarm
```
If you stored a Jev key: `security delete-generic-password -s claude-swarm-typesafe`.
</details>

<details>
<summary><b>Known limitations</b></summary>

- **Advisor:** visible only once the request it ran in ends. Its tokens and cost aren't reported to plugins.
- **Per-agent cost:** shown as N/A, because Claude Code prices only the session as a whole.
- **Jev routing:** covers only the lead's read-only `Read`/`LSP` calls.
- **Jev key in the Keychain:** macOS only; elsewhere use the environment variable.
- **Updates:** the mod API is early access. After a Claude Code update, run `claude plugin validate` and `claude plugin test` on the plugin folder.
</details>

<br>

<div align="center">

<img src="docs/screenshots/nexus-icon.png" width="72" alt="NEXUS icon">

Created by **Muhammad Zain** · MIT licensed

</div>
