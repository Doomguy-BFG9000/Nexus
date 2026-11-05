# Troubleshooting and FAQ

[← Back to the README](../../../README.md)

Start with `/nexus doctor`: it checks the install, the fullscreen TUI, the pane width, the agents and the integrations.

### The dashboard doesn't appear.

Use the fullscreen TUI and type `/nexus`. `/nexus doctor` checks the setup. On narrow terminals, use `/nexus layout compact` or `minimal`.

### Why can't the pane get wider?

Claude Code caps a docked pane at 45% of the terminal and keeps at least 60 columns for the conversation. NEXUS asks for the maximum. A wider window or a smaller font gives it more room. If you once resized the pane by hand, Claude Code keeps that width over what a plugin asks for; `/nexus width` explains how to reset it.

### Why does an agent card say Sonnet instead of Haiku?

That's one of Claude Code's built-in agents (such as Explore), not one of your Haiku agents. NEXUS marks it *fallback* and shows the model it actually ran on.

### The dashboard looks different after 0.8 (or not different at all).

New installs open the **Orbit** theme. If you used NEXUS before 0.8 you stay on **Classic** with your old settings until you choose otherwise: `/nexus settings theme orbit` (or `classic` to go back). The pane reopens so its background follows the theme. To put every setting back to its default, `/nexus settings reset all`, then confirm with `/nexus settings reset all confirm`. If a saved settings file could not be read at start, NEXUS draws Classic for that session and writes nothing over your saved settings.

### `/nexus doctor` says the `test` agent definition is missing.

The Test agent is optional. Copy `skills/nexus/agents/nexus-test.md` to `~/.claude/agents/` (or install the companion skill). Without it everything else works as before. [How the Test agent is limited](test-agent.md).

### The black hole is not moving.

It moves only while the session is working, and not at all under reduced motion (`/nexus settings animation` is `reduced` or `off`, or Claude Code's own *reduce motion* is on). That is deliberate: nothing redraws while idle.

### Does NEXUS change my Claude Code settings?

No. Its preferences live in the plugin's own store, and modes apply to the current session only.

### Uninstall

```sh
claude plugin uninstall nexus@muhzain05
claude plugin marketplace remove muhzain05
```

If you stored a Jev key: `security delete-generic-password -s nexus-typesafe`.

See also: [Compatibility](compatibility.md) · [Telemetry](telemetry.md) · [Jev](jev.md) · [Cache Guard](cache-guard.md)
