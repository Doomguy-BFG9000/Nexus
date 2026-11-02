# Compatibility

[← Back to the README](../../../README.md)

- **Claude Code:** built against Claude Code 2.1.316 and its native plugin (mod) API. No wrapper app, no second terminal, no patched binary; your prompt, permissions, shortcuts and sessions work exactly as before.
- **Fullscreen TUI:** the pane docks beside the conversation only in the fullscreen TUI (`"tui": "fullscreen"` in your Claude Code settings). Otherwise it sits above the prompt.
- **Terminal width:** on a wide terminal NEXUS docks on its own; anywhere else, type `/nexus`. Claude Code caps a docked pane at 45% of the terminal and keeps at least 60 columns for the conversation. On narrow terminals, use `/nexus layout compact` or `minimal`.
- **Jev key in the Keychain:** macOS only; elsewhere use the `TYPESAFE_API_KEY` environment variable.
- **Updates:** the mod API is early access. After a Claude Code update, check the plugin from a clone of this repo:

```sh
claude plugin validate mod/nexus && claude plugin test mod/nexus
```
