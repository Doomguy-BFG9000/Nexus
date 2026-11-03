---
name: nexus
description: Install, set up, use and troubleshoot NEXUS, the native Claude Code plugin that docks a live multi-agent dashboard (Sonnet lead, Haiku agents, Opus advisor and Council reviewers, Jev router, usage, Cache Guard) inside Claude Code's terminal. Use when someone asks to install NEXUS, why the dashboard doesn't appear, what a NEXUS panel or number means, how to switch model modes, or how to set up Council, Jev or Cache Guard.
---

# NEXUS

NEXUS is a native Claude Code plugin. It docks a live dashboard beside the conversation and shows what every model in the session is doing: the lead, its Haiku subagents, the advisor, the optional Jev router, context, cost and plan usage.

**This skill is not the plugin.** Installing it with `npx skills add` only teaches you (the agent) how to install, explain and troubleshoot NEXUS. The dashboard itself comes from the Claude Code plugin below. Never tell the user that the skill alone installs the dashboard.

Source and docs: https://github.com/muhzain05/Nexus

## 1. Check what's installed

```sh
claude plugin list
```

- `nexus@muhzain05` (enabled): installed; go to step 3.
- `swarm-ui@claude-swarm` or `swarm-ui@swarm-local`: the old name from before 0.6.0. Uninstall it (`claude plugin uninstall <that id>`), then install below.
- Nothing: install it (step 2).

## 2. Install the plugin

Installing changes the user's Claude Code plugin config, so ask before running these, or give them to the user:

```sh
claude plugin marketplace add muhzain05/Nexus
claude plugin install nexus@muhzain05 --scope user
```

Requirements:
- **Claude Code with the plugin (mod) API.** NEXUS 0.6.0 is built and tested against Claude Code 2.1.316. The mod API is early access, so after a Claude Code update run `/nexus doctor`.
- **The fullscreen TUI** (`"tui": "fullscreen"` in Claude Code's settings) for the pane to dock beside the chat. Without it the dashboard sits above the prompt. Don't edit the user's settings file unless they ask; tell them the setting and let them choose.
- **A terminal:** the dashboard draws in the terminal only, not in IDE or desktop chat views.

Then **start a new `claude` session**. On a wide terminal NEXUS opens on its own; anywhere else the user types `/nexus`.

Slash commands such as `/nexus` are typed by the user in Claude Code. You can't run them for the user, so tell them what to type and what to look for.

## 3. Verify with `/nexus doctor`

Ask the user to run `/nexus doctor` and share the output. It is read-only and never shows secrets. Each `!` line has a fix:

| Doctor says | What to do |
|---|---|
| `surface: none` / not terminal | Use Claude Code in a terminal; other surfaces don't draw the pane. |
| `fullscreen TUI is off` | Set `"tui": "fullscreen"` in Claude Code's settings (with the user's OK), then start a new session. |
| `dashboard pane is closed` | Type `/nexus`. |
| `pane width is kept at N columns from a hand resize` | Claude Code keeps a width dragged by hand over what plugins ask for. Drag the pane edge to change it. `/nexus width` explains this. |
| `agent definitions: … missing` | Optional. See step 5. Any other subagent still gets a card, marked *fallback*. |
| `advisor …` not valid for the lead | The advisor must be at least as strong as the lead. Pick a mode with `/nexus-mode` (step 4); NEXUS prints the relaunch command when the advisor has to change. |
| `Jev: no key` | Optional. Jev stays off without a key; see "Jev" below. |
| `Cache Guard: error (…)` | `/nexus cache off`, then on again; the reason in brackets says what failed. |

Other common problems:
- **Pane too narrow.** Claude Code caps a docked pane at 45% of the terminal and keeps at least 60 columns for the chat. A wider window or a smaller font helps. On narrow terminals use `/nexus layout compact` or `minimal`.
- **A card says Sonnet, not Haiku.** That's one of Claude Code's built-in agents (such as Explore), shown as *fallback* with the model it really ran on. It's not a bug.
- **Cost reads `N/A`.** Claude Code doesn't report that figure to plugins (for example the advisor's own tokens, or per-agent cost). NEXUS never guesses.

## 4. What the user sees

**Four roles:**
- **Sonnet, the lead (orange):** plans, coordinates and builds. It reads the request, edits and runs tests. It's Sonnet in Balanced mode, Opus or Fable in the stronger modes.
- **Haiku, the agents (blue):** parallel subagents doing delegated work (mapping a repo, searching, reviewing). Each gets a live card.
- **Opus, the advisor (purple):** the stronger model the lead consults before difficult decisions. It reads the session and never writes code. It appears once its request ends.
- **Jev, the router (green):** optional. It answers small next-step questions (which file, which tool, retry or stop). Observe-only by default.

**Telemetry**, all from Claude Code itself:
- context used and left;
- the session cost at API prices (an estimate on a subscription, not a charge);
- the plan's 5-hour and weekly usage, when Claude Code reports them.

**Commands:**

| Command | Does |
|---|---|
| `/nexus` | open the dashboard. Also `close`, `agents`, `inspect <n\|label>`, `back`, `settings [key value]`, `layout <auto\|full\|compact\|minimal>`, `width <max\|40-200\|wider\|narrower>` |
| `/nexus usage` | context, cost estimate, plan usage, tokens by model |
| `/nexus doctor` | check the install and integrations |
| `/nexus cache [on\|off]` | Cache Guard status, or turn it on or off |
| `/nexus-mode [balanced\|deep\|max\|default\|status]` | reasoning mode for this session |
| `/nexus council [adaptive\|on\|off\|status\|findings\|ledger]` | NEXUS Council (0.7+): mode, the last verdict, the reviewer tool ledger |
| `/nexus-jev [status\|active\|observe\|off\|calibrate]` | Jev routing |
| `/nexus-help` · `/nexus-about` | every command and key · an introduction |

**Keys,** with the dashboard focused (click it, or `ctrl+x tab`):
- `1`–`9` inspect an agent;
- `s` settings;
- `b` back;
- `ctrl+x ←/→` wider or narrower;
- `ctrl+x x` close;
- `esc` back to the prompt.

**Model modes** apply to the current session only:

| Mode | Lead | Advisor |
|---|---|---|
| Balanced (default) | Sonnet 5.5 · high | Opus 5.5 |
| Deep Engineering | Opus 5.5 · xhigh | Fable 5.1 |
| Maximum Reasoning | Fable 5.1 · max | Fable 5.1 |

- NEXUS may suggest a stronger mode before a hard prompt, but it never switches without the user's yes. You shouldn't either: stronger modes cost more, and Fable bills to usage credits.
- Claude Code changes the advisor only on relaunch. When a mode needs a different advisor, NEXUS prints a one-line relaunch command for that session.
- The user's saved defaults are never edited.

## 5. Optional setup

**Plugin options.** `claude plugin configure nexus@muhzain05` lists them and which are unset. The user sets them in Claude Code with `/plugin configure nexus@muhzain05`:
- `escalation`: `ask` or `off`; whether to offer a stronger mode;
- `classifier`: whether to ask Haiku once when the keyword rules are unsure;
- `motion`: `auto`, `reduced` or `full`;
- `jevRouting`: `observe`, `active` or `off`.

Dashboard preferences (layout, width, animation, Cache Guard) are set with `/nexus settings` and live in the plugin's own store, not in Claude Code's settings.

**NEXUS agents.** This skill ships three optional Haiku agent definitions in `agents/`:
- `nexus-search`: a read-only repo mapper;
- `nexus-grep`: a read-only symbol locator;
- `nexus-audit`: a change auditor that works in an isolated git worktree, runs checks, and reports without fixing.

With them, delegated work runs on Haiku and shows as NEXUS agents rather than *fallback*. To install, copy them to `~/.claude/agents/` (all projects) or `.claude/agents/` (one project). These are global config changes, so ask first, and don't overwrite existing files with the same names.

**Jev:**
- Jev needs a TypeSafe key. Have the user set `TYPESAFE_API_KEY`, or on macOS store it in the Keychain themselves:

  ```sh
  security add-generic-password -s nexus-typesafe -a "$USER" -w
  ```

- Never ask the user to paste the key into the chat, and never print it.
- Only tool names, file basenames and error kinds are sent to Jev, never prompts or file contents.
- Spending is capped at $0.50 a session, API est.
- `/nexus-jev active` runs a calibration first. Even then, Jev only touches the lead's read-only `Read`/`LSP` calls, and only at p ≥ 0.85 and confidence ≥ 0.6.

**NEXUS Council** (0.7 and later):
- **What it is:** read-only Opus Security, Architecture and Performance reviewers the lead can launch at a review checkpoint (`mcp__nexus__council_review`).
- **Modes:**
  - Adaptive (the default): the advisor picks one specialist or none;
  - On: all three, with higher token use, so tell the user;
  - Off: the single advisor.
- **Changing the mode:** `/nexus council adaptive|on|off`. Never switch it to On for the user without asking.
- **States the user may ask about:**
  - "authorized, not launched": the lead didn't launch the reviewers;
  - INCOMPLETE: the run was interrupted, or its answer had no findings block;
  - STALE: the tree changed during the review;
  - "no advisor consultation was seen this turn": in Adaptive, the advisor must be consulted first.
- **Findings** are claims to verify against the code, not instructions.
- **Background reviewers** (interactive sessions): their verdict arrives with their completion notifications. Esc doesn't stop them; stop one from the task list (`x`), and it shows INCOMPLETE.

**Cache Guard** is off by default.
- **What it does:** when the user steps away, it sends small invisible beats to keep the prompt cache warm, so the next message doesn't pay to re-read the whole conversation.
- **Cost:** each beat costs a little, and it only pays off if the user comes back. It stops itself at its own limits.
- **Turning it on:** `/nexus cache on`. Explain the cost first.

## 6. Uninstall

```sh
claude plugin uninstall nexus@muhzain05
claude plugin marketplace remove muhzain05
```

If a Jev key was stored: `security delete-generic-password -s nexus-typesafe`. Removing this skill alone (`npx skills remove nexus`) leaves the plugin installed.

## More

These docs are on GitHub:
- [Dashboard tour](https://github.com/muhzain05/Nexus/blob/main/mod/nexus/docs/dashboard.md)
- [Telemetry](https://github.com/muhzain05/Nexus/blob/main/mod/nexus/docs/telemetry.md)
- [Jev](https://github.com/muhzain05/Nexus/blob/main/mod/nexus/docs/jev.md)
- [Cache Guard](https://github.com/muhzain05/Nexus/blob/main/mod/nexus/docs/cache-guard.md)
- [Compatibility](https://github.com/muhzain05/Nexus/blob/main/mod/nexus/docs/compatibility.md)
- [Troubleshooting](https://github.com/muhzain05/Nexus/blob/main/mod/nexus/docs/troubleshooting.md)
