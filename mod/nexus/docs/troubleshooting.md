# Troubleshooting and FAQ

[← Back to the README](../../../README.md)

Start with `/nexus doctor`: it checks the install, the fullscreen TUI, the pane width, the agents and the integrations.

### The dashboard doesn't appear.

Use the fullscreen TUI and type `/nexus`. `/nexus doctor` checks the setup. On narrow terminals, use `/nexus layout compact` or `minimal`.

### Why can't the pane get wider?

Claude Code caps a docked pane at 45% of the terminal and keeps at least 60 columns for the conversation. NEXUS asks for the maximum. A wider window or a smaller font gives it more room. If you once resized the pane by hand, Claude Code keeps that width over what a plugin asks for; `/nexus width` explains how to reset it.

### Why does an agent card say Sonnet instead of Haiku?

That's one of Claude Code's built-in agents (such as Explore), not one of your Haiku agents. NEXUS marks it *fallback* and shows the model it actually ran on.

### Does NEXUS change my Claude Code settings?

No. Its preferences live in the plugin's own store, and modes apply to the current session only.

### Uninstall

```sh
claude plugin uninstall nexus@muhzain05
claude plugin marketplace remove muhzain05
```

If you stored a Jev key: `security delete-generic-password -s nexus-typesafe`.

See also: [Compatibility](compatibility.md) · [Telemetry](telemetry.md) · [Jev](jev.md) · [Cache Guard](cache-guard.md)
