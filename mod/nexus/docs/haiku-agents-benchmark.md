# Haiku agents: benchmark and decision (November 2026)

NEXUS ships three optional Haiku agent definitions: `nexus-search`, `nexus-grep` and `nexus-audit`. This benchmark tested whether a proposed set (Explorer, Tracer, Auditor) would serve the Sonnet lead better, against the current set and against no Haiku agents. The result decided one change: `nexus-audit` was redesigned, and nothing else.

## What was compared

| Setup | Agents the lead could launch |
|---|---|
| A, current | `nexus-search` (repository map), `nexus-grep` (symbol locator), `nexus-audit` (applied a pasted diff in an isolated worktree and ran checks there; Write and `acceptEdits`) |
| B, proposed | `nexus-explorer` (discovery plus search), `nexus-tracer` (cross-module flow, each hop marked observed or inferred), `nexus-auditor` (read-only check of the lead's own checkout: Read, Glob, Grep, Bash) |
| C, none | no Haiku agent; Sonnet does the work itself |
| D, shipped | A's `nexus-search` and `nexus-grep`, plus B's auditor design under the name `nexus-audit` |

**Overlap found while mapping:**
- Search and Grep had the same tools (Read, Glob, Grep) and the same 25-turn limit; only their prompts differed.
- Audit did not duplicate the Council. It ran checks; the Council reviews a diff read-only with Opus.

## Method

- **Repository:** this one at `8bfbdb5`, one clone per setup.
  - The three tasks marked *planted* each apply a one-line bug before the run.
  - The planted bugs: a `role()` slice off by one, a path-boundary check without the separator, and a removed union member.
- **Sessions:** Claude Code 2.1.317, `claude -p`, with a Sonnet lead and the globally configured Opus advisor (unchanged in every run).
  - NEXUS was loaded with Council off.
  - Other plugins were disabled for the session.
- **Permissions:** the same allowed tools in every setup, including `git diff/status/log/show/apply/checkout/clean` and the `tsc` command.
  - Claude Code's built-in agent types and the Workflow tool were denied in A, B and D, so agent sets were compared on their own.
  - C denied the Agent tool.
- **Grading:**
  - **Answer keys:** written from `grep` at `8bfbdb5` before any run, as required items (file:line references, symbols, hops).
  - **Scoring:** automatic. Every score below 1.0 was checked by hand. Two first-pass misses were grader artifacts (a bare `:1821` or "Line 1825" under a file heading); the grader was fixed and every run re-scored.
- **Adoption rule:** written down before the trials (below).
- **Metrics:**
  - **Measured:** wall time; Claude Code's API-priced `total_cost_usd` (it includes the final turn: the per-turn output tokens add up to its totals in all 28 forced runs); agent launches; tool calls.
  - **Haiku tokens:** from `modelUsage`, which also counts Claude Code's own small Haiku calls (about 2.5k input and 160 output tokens a run with no agent).
  - **Not reported:** lead re-reads of agent-reported files. The detector didn't work with background agent reports, so it measured nothing.

**Pre-registered rules:**
- **Natural arm:** adopt B only if it matches A's correctness per task class, and is at least 15% cheaper or faster, or 0.15 better on trace tasks.
- **Forced arm:** the same correctness bar, plus at least 15% lower cost, 30% fewer lead re-reads, or 0.15 better on trace tasks.

## Results

### Natural prompts (no mention of agents)

| Task | A: Search/Grep/Audit | B: Explorer/Tracer/Auditor | C: no Haiku agents |
|---|---|---|---|
| Locate a function and its references | 1.00 · 8 s · $0.086 · delegated 0/2 | 1.00 · 8 s · $0.086 · delegated 0/2 | 1.00 · 9 s · $0.130 · delegated 0/2 |
| Find the code behind a behaviour | 1.00 · 32 s · $0.208 · delegated 0/2 | 1.00 · 30 s · $0.193 · delegated 0/2 | 1.00 · 30 s · $0.180 · delegated 0/2 |
| Trace an event across modules | 1.00 · 37 s · $0.218 · delegated 0/2 | 1.00 · 38 s · $0.218 · delegated 0/2 | 1.00 · 38 s · $0.207 · delegated 0/2 |
| Diagnose a cross-module state bug (planted) | 1.00 · 20 s · $0.145 · delegated 0/2 | 1.00 · 17 s · $0.150 · delegated 0/2 | 1.00 · 22 s · $0.144 · delegated 0/2 |
| Spot a suspicious pattern in a change (planted) | 1.00 · 14 s · $0.101 · delegated 0/2 | 1.00 · 20 s · $0.115 · delegated 0/2 | 1.00 · 16 s · $0.099 · delegated 0/2 |
| Find missing test coverage | 1.00 · 28 s · $0.155 · delegated 0/2 | 1.00 · 23 s · $0.150 · delegated 0/2 | 1.00 · 24 s · $0.144 · delegated 0/2 |
| Discover and verify: a failing type-check (planted) | 1.00 · 14 s · $0.098 · delegated 0/2 | 1.00 · 15 s · $0.099 · delegated 0/2 | 1.00 · 15 s · $0.097 · delegated 0/2 |
| **Mean of all 14 runs** | 1.000 · 22.0 s · $0.144 · delegated 0/14 | 1.000 · 21.6 s · $0.144 · delegated 0/14 | 1.000 · 21.9 s · $0.143 · delegated 0/14 |

Cells: correctness (0 to 1) · mean wall time · mean API-priced cost · runs in which the lead launched a Haiku agent. Two trials each.

### Forced delegation (same suffix in A and B: delegate to whichever subagent fits best)

| Task | A: agent picked · correctness · wall · Haiku in/out · cost | B: agent picked · correctness · wall · Haiku in/out · cost |
|---|---|---|
| Locate a function and its references | `nexus-grep` · 1.00 · 26 s · 28k/2.8k · $0.104 | `nexus-explorer` · 1.00 · 21 s · 18k/1.6k · $0.099 |
| Find the code behind a behaviour | `nexus-grep` · 1.00 · 81 s · 332k/11.4k · $0.146 | `nexus-explorer` · 1.00 · 125 s · 387k/12.9k · $0.330 |
| Trace an event across modules | `nexus-grep` · 1.00 · 74 s · 190k/9.7k · $0.136 | `nexus-tracer` · 1.00 · 55 s · 109k/6.5k · $0.130 |
| Diagnose a cross-module state bug (planted) | `nexus-grep` · 1.00 · 47 s · 146k/5.2k · $0.122 | `nexus-tracer` · 1.00 · 46 s · 114k/5.8k · $0.122 |
| Spot a suspicious pattern in a change (planted) | `nexus-audit` · 1.00 · 91 s · 276k/12.4k · $0.144 | `nexus-auditor` · 1.00 · 44 s · 100k/5.2k · $0.113 |
| Find missing test coverage | `nexus-grep` · 1.00 · 49 s · 97k/6.9k · $0.111 | `nexus-explorer` · 1.00 · 47 s · 53k/7.7k · $0.112 |
| Discover and verify: a failing type-check (planted) | `nexus-audit` · 0.50 · 47 s · 71k/3.9k · $0.119 | `nexus-auditor` · 1.00 · 46 s · 71k/4.6k · $0.122 |
| **Mean of all 14 runs** | 0.929 · 59.3 s · 163k/7.5k · $0.126 | 1.000 · 54.8 s · 122k/6.3k · $0.147 |

### Confirmation: the shipped `nexus-audit` (D), with Search and Grep unchanged

| Task | Old `nexus-audit` (A) | New `nexus-audit` (D) |
|---|---|---|
| Spot a suspicious pattern in a change (planted) | 1.00 · 91 s · Haiku 276k in · agent Haiku cost $0.0158 · session $0.144 | 1.00 · 48 s · Haiku 127k in · agent Haiku cost $0.0074 · session $0.167 |
| Discover and verify: a failing type-check (planted) | 0.50 · 47 s · Haiku 71k in · agent Haiku cost $0.0046 · session $0.119 | 1.00 · 30 s · Haiku 47k in · agent Haiku cost $0.0030 · session $0.115 |


**Re-confirmed after a prompt fix (D2, 2 trials each):** a live auto-mode smoke test showed the D draft searching the whole disk (`find / -name tsc`) to locate a tool. The shipped prompt adds three rules:
- take commands from the task, README, package files or CI config;
- run each in the foreground;
- never search the disk or home folder: report "not run" instead.

Results with it:

| Task | Old `nexus-audit` (A) | Shipped `nexus-audit` (D2) |
|---|---|---|
| Spot a suspicious pattern in a change (planted) | 1.00 · 91 s · Haiku 276k in · agent Haiku cost $0.0158 · session $0.144 | 1.00 · 51 s · Haiku 161k in · agent Haiku cost $0.0072 · session $0.112 |
| Discover and verify: a failing type-check (planted) | 0.50 · 47 s · Haiku 71k in · agent Haiku cost $0.0046 · session $0.119 | 1.00 · 38 s · Haiku 60k in · agent Haiku cost $0.0046 · session $0.116 |
 (D, 1 run): the lead still picked `nexus-grep`.

### One large discovery task, natural prompt

- A: delegated 0/2 · 112 s · $0.607 · 31 lead tool calls
- B: delegated 0/2 · 102 s · $0.591 · 25 lead tool calls

Total API-priced cost of the 79 graded and confirmation runs: $12.97 (pilots and probes excluded).


## Decision

**B is not adopted.**
- **Natural use:** the lead never delegated in 46 natural runs, the large discovery task included, so the role set made no difference.
- **Forced delegation:** B matched or beat A in every class but met no efficiency threshold. Its mean cost was even higher, because one run consulted the Opus advisor.

**Per role:**
- **Explorer:** ties Grep. It isn't shipped.
- **Tracer:** 26% faster with 43% fewer Haiku tokens on the trace task, but only 4% cheaper and tied on correctness: promising, below the bar. A fourth agent would also break the three-card layout. It isn't shipped.
- **Search:** in A's 14 forced runs (and D's trace run) the lead picked `nexus-grep` for every lookup and trace, 11 runs, and `nexus-search` never. That answers the overlap question. Removing Search would change the dashboard's slot labels for no measured gain, so it stays.
- **Auditor: shipped, as `nexus-audit`.** Confirmed under the old name (D):
  - **Speed:** 51 s against 91 s on reviewing a change (D2, the shipped prompt).
  - **Haiku cost:** 42% fewer Haiku input tokens; the agent's own Haiku cost is 54% lower, and the session cost 22% lower.
  - **Correctness:** 1.0 against 0.5 on finding and confirming a type-check failure.
  - **Privilege:** it drops Write, `acceptEdits` and the worktree.
  - **Why the old one lost:** it had to rebuild a pasted diff four times before `git apply` took it. In the type-check task it left its worktree to look at the real change, and its compound `cd … &&` command was outside the allowed patterns (an interactive session would have asked instead).
- **Session cost of D's first review run:** /bin/zsh.218, caused by a Sonnet prompt-cache miss (same tokens, double price), not by the agent.

**Delegation guidance:** unchanged.
- Forced delegation was about 2.5 times slower than Sonnet working directly (55 to 59 s against 22 s), at equal correctness; A's forced runs were about 12% cheaper than its natural ones ($0.126 against $0.144), because Haiku did the reading.
- Nothing here supports telling the lead to delegate more, so NEXUS adds no delegation instructions.
- Descriptions still say when to use each agent. Only `nexus-audit`'s changed.

## Limitations

- **Sample size:** two trials per cell, one repository, tasks a Sonnet lead can do in about 4 tool calls.
- **Mode:** `claude -p` only. Interactive sessions may delegate differently.
- **Agent set:** built-in agent types were denied, so the real-world choice (including Claude Code's own Explore agent) wasn't measured.
- **Grading:** automatic matching of required items. Extra claims weren't scored for false positives.
- **Live lifecycle:** if a check runs past Bash's time limit, Claude Code moves it to the background. The agent's turn then ends and its card shows done while it waits for that shell. That's the native turn event, not new NEXUS behaviour.
- **New trade-off:** the new `nexus-audit` runs the project's checks in the user's real working tree. Its Bash goes through their normal permission rules, but a test that writes files writes there. The old worktree contained that.
