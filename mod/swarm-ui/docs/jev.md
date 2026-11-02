# Jev routing

[← Back to the README](../../../README.md)

[TypeSafe](https://typesafe.ai) Jev answers small routing questions about the lead's next step: which file, which tool, retry or stop. It's **optional and observe-only by default**, and it needs a TypeSafe key; without one it stays off.

## Observe (default)

Jev's answers are only drawn in the dashboard, as green bars: bright when **sharp** (≥ 0.85), muted when **split**. Nothing Claude Code runs is changed.

## Active

`/nexus-jev active` first runs six calibration cases with known answers. Routing turns active only if they pass (no unsafe answer and at least 2/3 right); otherwise it stays in observe. After that, and only for the lead's own read-only `Read`/`LSP` calls, Jev may re-run a failed read once or attach an optional "next file" note, and only when it's sure (p ≥ 0.85 and confidence ≥ 0.6). It never touches shell commands, edits, permissions or subagents. Anything below that bar falls back to the lead with nothing changed.

`/nexus-jev [status|active|observe|off|calibrate]` switches between these.

## Setting the key

Export `TYPESAFE_API_KEY`, or on macOS store it in the Keychain:

```sh
security add-generic-password -s claude-swarm-typesafe -a "$USER" -w
```

NEXUS holds it in memory only; it's never drawn or logged.

## Privacy and limits

- Only tool names, file basenames and error *kinds* are ever sent to Jev, never prompts or file contents.
- Calls are bounded by a per-session budget ($0.50 API est.), a per-minute rate limit, a timeout and a back-off after any error.
- Routing covers only the lead's read-only `Read`/`LSP` calls.
- The Keychain option is macOS only; elsewhere use the environment variable.
