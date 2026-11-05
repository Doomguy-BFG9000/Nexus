# Contributing to NEXUS

Thanks for helping. NEXUS is a native Claude Code plugin (TypeScript, no build step). This page gets you from clone to pull request.

## Set up

You need [Claude Code](https://claude.com/claude-code) (the plugin API is early access; see [compatibility](mod/nexus/docs/compatibility.md) for the tested version) and Git. No `npm install`: the plugin has no dependencies.

```sh
git clone https://github.com/muhzain05/Nexus && cd Nexus
claude plugin validate mod/nexus     # checks the manifest
claude plugin test mod/nexus         # runs every test (a few seconds)
```

To try your change in a real session, install from your clone and start a new `claude` session:

```sh
claude plugin marketplace add ./
claude plugin install nexus@muhzain05 --scope user
```

Then `/nexus doctor` checks the install.

## Where things are

| Path | What lives there |
| :--- | :--- |
| `mod/nexus/hooks/` | The plugin. `register.tsx` wires events; the rest is pure logic you can test without a session |
| `mod/nexus/hooks/orbitlayout.ts`, `orbitview.tsx`, `blackhole.ts` | The Orbit theme: layout as lines of text, the pane, the black hole |
| `mod/nexus/hooks/views.tsx` | The Classic theme |
| `mod/nexus/hooks/prefs.ts` | Settings: defaults, validation, migration, presets |
| `mod/nexus/hooks/council.ts`, `testrunner.ts`, `routing.ts` | The safety rules: Council reviewer limits, the Test agent's command gate, Jev routing |
| `mod/nexus/tests/` | Tests, one file per area |
| `mod/nexus/docs/` | User docs |
| `skills/nexus/agents/` | The Haiku agent definitions (search, grep, audit, test) |

## Conventions

- Pure functions in their own files; `register.tsx` only wires. A helper that takes `$` is a top-level `function`, not an arrow inside `register()`.
- **Never invent a number.** A figure Claude Code did not report is `null` in state and `N/A` on screen, never `0`. Hiding a number is a display choice; it must not stop NEXUS collecting it.
- Settings: a display setting never changes what an agent may do. Anything that does is under **Agents** and says so.
- Only single-cell characters in the dashboard (box drawing, braille, geometric shapes). No emoji.
- Keep Classic's look unless the change is about Classic.
- Code comments say why, not what. Match the file's existing style; there is no formatter to run.

## Tests

Every behaviour change needs a test, and a bug fix needs a test that fails without the fix. Tests import from `claude-code/testing`; copy a neighbour in `mod/nexus/tests/`. Tests that describe Classic start from `CLASSIC` in `tests/classic.ts`; a fresh store opens Orbit.

Say in your pull request what you ran and what it printed. "Should pass" is not a result.

## Pull requests

1. Open an issue first for anything bigger than a fix, so we agree on the shape.
2. Branch from `main` (`feat/…`, `fix/…`, `docs/…`), keep commits focused, and describe *why* in the message.
3. Fill in the pull request template. Add a line to `CHANGELOG.md` under **Unreleased**.
4. CI must be green. A review may ask for changes; that is normal.

## Reporting bugs and asking for features

Use the issue forms. For a bug, `/nexus doctor` output and your Claude Code version (`claude --version`) answer most questions. **Do not paste API keys, tokens or private code.**

**Security problems go to a private report, not a public issue:** see [SECURITY.md](SECURITY.md).

## Security-sensitive changes

Changes to `council.ts`, `testrunner.ts`, `routing.ts`, tool gates or anything that handles keys or file paths get extra care: add tests for the bypass you considered, say what you checked, and expect a closer review. The Test agent's gate is a deterministic check on top of Claude Code's permissions, not isolation; do not describe it as a sandbox.

## Documentation

Docs live in `mod/nexus/docs/` and the README. Fixes to wording, broken links and missing steps are welcome and need no issue. Command names and settings must match the code: check with `/nexus help` and `/nexus settings`.

## Good first issues

Look for the [`good first issue`](https://github.com/muhzain05/Nexus/labels/good%20first%20issue) label. Each one names the files and says how to test it. If you want one, comment so nobody doubles up.

## Conduct

Be kind and be specific. Assume good faith. Maintainers may close issues or pull requests that are abusive or off-topic.
