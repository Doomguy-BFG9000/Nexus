# The Test agent

[← Back to the README](../../../README.md)

`nexus-test` is the fourth Haiku role, next to Search, Grep and Audit. It runs the project's **existing** tests and reports what actually ran.

## What it is for

- Find the project's test command (the task, README, `package.json` scripts, `Makefile`, CI config).
- Run the narrowest run that covers the change, then the suite if asked.
- Report in a fixed shape: `ran:` (exact commands), `result:` (`passed`, `failed` or `not run`), counts only when the output showed them, `failures:` (path, line, first error), and `not run:` (tests it *recommends* but did not execute, labelled as a recommendation).

NEXUS reads that report for the activity tape. A line like `test#1 failed · 2 failed, 40 passed` appears only if the agent printed those numbers; with no `result:` line the tape says `finished · no result line in its report`. A recommendation is never shown as a result.

## What NEXUS checks

NEXUS checks every tool call the Test agent makes, **on top of** Claude Code's own permissions (the engine still asks you as it always does; NEXUS never grants more than the lead already has):

| Rule | Detail |
| :--- | :--- |
| Only four tools | Read, Glob, Grep and Bash. Anything else (Write, Edit, web tools, MCP tools, Skill…) is refused. |
| Known test commands only | `npm`/`pnpm`/`yarn test` and `run test[:name]`, `bun test`, `deno test`, `pytest`, `python -m pytest`/`unittest`, `go test`, `cargo test`/`nextest`, `swift test`, `dotnet test`, `mvn test`/`verify`, `gradle test`, `rspec`, `rake test`, `phpunit`, `jest`, `vitest run`, `mocha`, `ava`, `tap`, `make test`/`check`, `ctest`, `claude plugin test`, and `npx --no-install <runner>`. |
| One plain command | No `&&`, `;`, pipes, redirects, substitution, globs, brackets or variables, and no `NAME=value` words. |
| An allowlist of flags per runner | A flag the runner is not listed as accepting is refused, because runners have flags that run code (`go test -toolexec`), write files (`-coverprofile`), load plugins or set the environment (`npm --node-options`). Values are type-checked: a number, a name from a short list, a plain test filter, or a path inside the repository. |
| Named targets only | `make`, `rake`, `gradle` and `mvn` accept only their test target; `make test install` is refused. |
| No silent installs | No `install`, `add`, `ci`, `pip install`, or `npx` without `--no-install`. |
| No rewriting | No snapshot-update, `--fix`, `--write` or output-file flags; no watch mode. |
| Inside the repository | No absolute paths, `..`, URLs or package specifiers, and nothing that looks like a secret file. |
| Foreground, with a timeout | Always foreground; the timeout is the agent's own but never over 5 minutes (2 by default). |
| Sandbox switches dropped | Any field of the call that loosens a sandbox or permission is removed before the call reaches the engine. |
| Fails closed | If NEXUS cannot decide, the call is refused. |

**Settings → Agents → Run tests** switches it off (`/nexus settings testRunner off`): every Bash call from the Test agent is then refused, while reads still work. The default is *known test commands*. Upgrading never loosens it.

A refusal is shown on the activity tape with the reason, and the agent is told to report it as `not run`.

## What it is not

- **It is not isolation.** A test command runs the project's own test code with your permissions, so that code can do anything you can. The checks above limit what the *agent can ask for*; they do not sandbox what your tests do once started.
- Build tools may fetch the project's own declared dependencies when they run (`cargo test`, `go test`, `mvn test`). NEXUS does not stop that.
- Other agents (including Claude Code's built-in ones) and the lead itself are not checked by this gate; their Bash calls go through your normal permission rules.
- It overlaps `nexus-audit`, which also runs the project's tests, and it has **not been benchmarked**. The [benchmark](haiku-agents-benchmark.md) that picked the other roles did not test it, and Claude Code decides when to delegate to it.

## Install

The agent definition is [`skills/nexus/agents/nexus-test.md`](../../../skills/nexus/agents/nexus-test.md). Copy it next to the others in `~/.claude/agents/` (or `.claude/agents/` for one project), or install the companion skill and let it do that. Without the definition the dashboard works as before, and `/nexus doctor` says `test missing`.

## How it was checked

The command gate was reviewed by the NEXUS Council (security, architecture and performance reviewers) at its first checkpoint. The first version blocked flags one by one and was bypassed (`go test -toolexec`, `npm --node-options`, `mvn exec:exec`, `make test install`, quoted shell syntax, URLs, and more). It was replaced with the per-runner allowlist above, and every reported bypass is now a refusal test (`mod/nexus/tests/testrunner.test.ts`). **The replacement was not re-reviewed by the Council.** If you find a command that passes and should not, please report it privately: see [SECURITY.md](../../../SECURITY.md).
