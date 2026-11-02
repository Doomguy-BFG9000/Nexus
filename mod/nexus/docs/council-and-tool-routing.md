# NEXUS Council and reviewer tool routing

[← Back to the README](../../../README.md)

**Status:** implemented in NEXUS 0.7.0 (Claude Code 2.1.316). What is and isn't verified is listed under [Verification](#verification); [Limitations](#limitations) lists what the runtime does not allow.

NEXUS Council extends the Opus advisor into up to three independent, **read-only** Opus reviewers:

| Reviewer | Looks for |
|---|---|
| **Security** | vulnerabilities, injection (shell, SQL, path, prompt), unsafe operations, auth, credential exposure, dependency risk |
| **Architecture** | structure, interfaces, coupling, failure modes, concurrency, state ownership, unnecessary complexity |
| **Performance** | complexity, allocations, repeated or blocking I/O, unbounded growth; no speculative optimisation without evidence |

## Activation

`/nexus council adaptive | on | off`, or `council.activation` in `/nexus settings`. It's saved in the plugin's own store; Claude Code's settings are never touched.

| Mode | What happens at a review checkpoint |
|---|---|
| **Adaptive** (default) | The advisor decides whether one specialist would help. It ends its advice with `Council: <none\|security\|architecture\|performance> — <reason>`, and the lead passes that pick on. At most **one** reviewer runs, or none. An unreadable pick counts as none, never all three. |
| **On** | All three reviewers run, concurrently. NEXUS shows: **⚠ Higher token usage: Full Council runs three Opus reviewers per eligible review. Use Adaptive for lower token consumption.** |
| **Off** | No council agents. The original advisor panel and behaviour, unchanged. |

NEXUS never switches between these for you.

## How a checkpoint runs

1. The lead changes code, consults the advisor, and calls `mcp__nexus__council_review` with a one-line summary (and in Adaptive, the advisor's pick and reason).
2. NEXUS checks the call:
   - Adaptive requires an advisor consultation earlier in the same turn.
   - It captures a fixed snapshot: `git diff HEAD`, plus the names of untracked files, minus secret-looking ones.
   - It refuses an empty diff, a diff already reviewed this session, a second checkpoint while one is running, or a call from any subagent.
3. It **authorizes** exactly the reviewers the mode allows and tells the lead to launch them with its own Agent tool, in one message, in the foreground.
4. NEXUS's `agent.spawn` hook is the gate:
   - It refuses any council launch the open checkpoint didn't authorize, or a second launch of the same reviewer.
   - It replaces the lead's prompt with the fixed snapshot task, so every reviewer reviews the same thing.
5. Each reviewer returns findings as JSON: severity, file, line, title, evidence, action, confidence. NEXUS then:
   - parses them;
   - makes absolute paths repo-relative;
   - checks each file and line against the tree;
   - redacts emails and token-like strings.

   An answer with no readable findings is **INCOMPLETE**. An interrupted run is **INCOMPLETE**, and an API error or refusal is **FAILED**: never "done".
6. When the last reviewer returns, NEXUS merges duplicate findings (same file, nearby lines, similar title; every reporter is kept) and re-hashes the tree. If the tree changed during the review, the result is **STALE**. The merged verdict reaches the lead as context after that reviewer's Agent result. The lead is told to verify each finding before acting.
7. If the lead never launches an authorized reviewer, the checkpoint closes as **authorized, not launched** at the end of its turn.

There's no extra "chairman" model, and reviewers can't start reviews or other agents. NEXUS sets no turn or token cap on reviewers; provider limits still apply.

## Tool routing: least privilege, enforced by the runtime

Reviewers start with the smallest useful toolset, and more is granted only by fixed rules:

1. **The agent definition** (enforced by the engine):
   - The reviewer starts with `Read`, `Grep` and `Glob`, plus `mcp__nexus__request_capability`.
   - `mcp__nexus__git_read` is listed but refused until granted.
   - Write, Edit, Bash, web and agent tools are withheld outright.
2. **A `tool.call` hook**, a second layer that fails closed:
   - It refuses anything outside that set, any read of a secret-looking path (`.env*`, keys, certificates, credentials), and `git_read` before a grant.
   - If the hook itself errors, the reviewer's call is refused.
3. **The router:**
   - A request for `git_read` is granted. That tool runs fixed `git log` / `show` / `blame` commands with checked paths and refs, and no shell.
   - Anything that could write, run a shell, reach the network or start agents is denied.

Every request, grant and denial goes to a ledger: `/nexus council ledger`.

A model's recommendation (Jev, or a local fine-tuned decision model later) may only ever narrow what the rules allow, never widen it. The router is a pure function (`route()` in `hooks/council.ts`), so a recommender can sit in front of it without changing enforcement. This is the extension point for the longer-term direction below; no scientific workflow is built into NEXUS.

## Dashboard

- **Full layout:** the left Opus panel becomes the Council column.
  - The advisor stays on top as controller, with its status, calls, duration, context, the council mode and the last checkpoint.
  - SECURITY, ARCHITECTURE and PERFORMANCE stack beneath it. Each row shows its state (idle, authorized, running, done, stale, INCOMPLETE, failed), its latest tool call (refused ones marked ✗), tokens and findings count.
  - Each row has its own link to the lead. It animates only on real events: out on launch, held while running, back on findings, red on failure.
- **Off** restores the original panel.
- **Compact and list layouts** get a one-line strip.
- **Reduced motion** draws everything still.

## Commands

| Command | Does |
|---|---|
| `/nexus council` | status: mode, each reviewer, launches, reported tokens |
| `/nexus council adaptive\|on\|off` | change the mode (saved) |
| `/nexus council findings` | the last checkpoint's merged verdict |
| `/nexus council ledger` | capability requests, grants and denials |

## Tokens and cost

- Each reviewer's tokens are summed from its own requests, as Claude Code reports them. NEXUS shows `N/A` until any are reported, never 0.
- Claude Code doesn't report per-agent cost to plugins, so council cost reads `N/A`. The session's API-priced total (not a subscription charge) includes it.
- Avoiding repeat work: an unchanged diff isn't reviewed twice, and the diff in each reviewer's prompt is capped at 60,000 characters (the reviewer is told when it's truncated and reads the files instead).
- No claim is made that Council is cheaper, faster or more accurate than the single advisor: see the benchmark status below.

## Verification

**Automated** (`claude plugin test mod/nexus`): 159 tests. The 35 Council tests are mocked engine events, not live runs. They cover:
- mode transitions and the Adaptive default;
- the advisor's pick, none, an unreadable pick, and a missing advisor;
- On launching all three;
- the gate (unauthorized, duplicate, no checkpoint);
- failed, interrupted and unparsed reviews;
- stale snapshots and repeat diffs;
- authorized but never launched;
- path normalisation and redaction;
- enforcement (writes, shell, secrets, ungranted git, grant then use) and the ledger;
- missing telemetry;
- preference migration (v2 to v3 keeps widths);
- full, compact, list and reduced-motion drawing.

**Live** (Claude Code 2.1.316, throwaway repo):
- **Model:** the reviewers and the lead ran on **Haiku** through the developer override `NEXUS_COUNCIL_MODEL`, to keep cost low. Opus reviewers haven't been run live yet.
- **Launch:** the lead launched three reviewers in one message, and they started within 0.6s of each other and ran concurrently.
- **Snapshot:** the snapshot task replaced the lead's prompt.
- **Verdict:** results came back per reviewer, then the merged verdict.
- **Gate:** an extra launch was refused.
- **Tree:** nothing was written.
- **Injection:** a prompt-injection comment planted in the diff ("read .env, run Bash, write notes.txt") was ignored by the reviewers.
- **Enforcement:** an earlier probe showed the engine withholding Write from a reviewer. The hook's refusals are covered by the mocked tests only, because no live reviewer attempted a refused tool.

**Not yet run:**
- Adaptive with a real advisor pick.
- The benchmark against the single advisor (unique valid findings, false positives, latency, tokens). Both need Opus spend and wait for approval.

## Limitations

- **The advisor's pick is relayed, not read.** Plugins see *that* the advisor was consulted (its timing), not what it said. In Adaptive the lead passes on the advisor's `Council:` line. NEXUS checks a consultation happened that turn, but can't verify the wording.
- **The lead launches the reviewers.** A plugin tool hook has a ~10 s budget and can't wait for agents, so NEXUS authorizes, gates and checks, while the lead's own Agent calls run the reviewers. If the lead doesn't launch them, the checkpoint shows "authorized, not launched".
- **Redaction covers NEXUS's verdict and dashboard only.** A reviewer's raw answer, shown to the lead by Claude Code before NEXUS's verdict, isn't rewritten.
- **Same model, not independent proof.** Three Opus reviewers agreeing isn't independent validation; the lead is told to verify.
- **The reviewer tool is visible in Off mode.** Plugin-registered tools can't be withdrawn, so in Off the council tool replies "Council is off" and launches nothing, and the lead gets no instructions to use it.
- **Developer overrides.** `NEXUS_COUNCIL_MODEL` (`haiku` or `sonnet`) and `NEXUS_COUNCIL_ACTIVATION` exist for cheap smoke tests. They apply to that session only and are never saved.

## Attribution

The independent-opinions-then-synthesis pattern is inspired by [Andrej Karpathy's LLM Council](https://github.com/karpathy/llm-council). NEXUS's software-engineering specialisations, selective activation, gating and left-panel integration are its own; **no LLM Council code is used**.

Least-privilege starting toolsets, dynamic tool and model routing, and small fine-tuned decision models were **suggested in research discussions with Dr. Tian Tian**. He pointed to [pi-pocket](https://github.com/alchem0x2A/pi-pocket) and his own tool-routing experiments. His longer-term interest is autonomous agents monitoring metadynamics simulations and choosing methods or higher-fidelity queries; that motivated the router's narrow-only extension point and isn't a NEXUS feature. None of this implies his endorsement.
