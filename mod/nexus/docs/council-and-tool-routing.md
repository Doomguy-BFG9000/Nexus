# NEXUS Council and Tool Routing — implementation design

Status: **design proposal, not implemented**. No UI, subagent, or routing behavior described here is currently shipped.

## Goals

Extend the existing left-hand Opus Advisor panel without moving Sonnet, Haiku, or Jev. Add a selective code-review council inspired by [Andrej Karpathy's LLM Council](https://github.com/karpathy/llm-council), and a separate least-privilege tool-routing direction prompted by discussions with Dr. Tian Tian about Pi harness and autonomous metadynamics.

## Council activation

| Mode | Behavior |
| --- | --- |
| **Off** | Existing single advisor; no specialist council invocations. |
| **Adaptive (default)** | Existing main Opus advisor may choose **none or exactly one** of Security, Architecture, or Performance for a second independent review. Selection must return a short rationale. Do not invoke an extra advisor just to classify a trivial task; make the choice during an already-scheduled main advisory review. |
| **On** | At each eligible advisory checkpoint, request all three specialist reviews. **Not** continuous polling or three models on every turn. |

Selecting **On** must show a yellow notice: **“Higher token usage: Full Council invokes three Opus specialists per eligible review. Adaptive uses fewer additional calls.”** No NEXUS-imposed mid-response token cutoff by default. Provider limits still apply. Interrupted/partial results are labeled **INCOMPLETE**, not successful.

## Left sidebar UX

- **Off**: original Opus panel and connectors unchanged.
- **Adaptive**: left Opus panel expands into three compact vertically stacked rows labeled SECURITY, ARCHITECTURE, PERFORMANCE; only selected row is active, others idle. Primary Opus advisor remains visible as controller, not silently counted as a fourth specialist.
- **On**: same three rows; active lines link each reviewer to the Sonnet lead and to a consolidated verdict. Lines animate **only on real lifecycle events**; no fabricated activity.
- Width constraints: retain current dock proportions; fall back to compact/list presentation in narrow terminals, with reduced-motion support.
- Show per-reviewer states queued/running/done/error/incomplete, reason for selection, actual usage where reported, otherwise N/A. No invented cost figures.

## Review execution

1. Sonnet reaches a genuine advisory checkpoint after producing a meaningful diff.
2. Main Opus performs its existing advice. In Adaptive, it also emits a **structured selection**: `none | security | architecture | performance`, with rationale; a failed parse defaults to none (not three).
3. Capture a fixed diff/commit snapshot and bounded relevant evidence for every selected reviewer. **Do not** share mutable worktrees as a review target; detect changed snapshot and mark stale.
4. Spawn selected specialist(s) through **verified supported Claude Code agent APIs**. If parallel subagent control or read-only tool enforcement is unavailable, do not pretend it is enforced: disable the launch and explain the limitation.
5. Specialists are **read-only** and return structured findings: severity, file, line, evidence, suggested verification, confidence. Their role prompts differ but same-model agreement is not independent validation.
6. Deduplicate and reconcile findings without an extra Opus “chairman” call by default. Validate file/line against the snapshot; Sonnet verifies actionable claims before editing.
7. Record actual start/stop/errors/usage; one council invocation per unchanged snapshot and advisory checkpoint, no recursive councils or infinite debates.

## Tool routing — separate feature track

Following Tian's proposal, agents begin with the smallest **actually enforceable** tool profile. A router can authorize additional capabilities only when needed; **prompt-only restrictions are not security boundaries**. Tool routing (what an agent may call) is separate from model routing (Haiku/Sonnet/Opus) and Council (which reviewer is consulted).

Start with static allowlists and an auditable request/grant/deny ledger. Check supported Claude Code hooks/permissions before promising dynamic grants. Only later evaluate locally fine-tuned decision models (Jev/Qwen) against deterministic routing, including invalid tool calls, task completion, latency and cost. Tian's longer-term research interest is an agent monitoring metadynamics and selecting ML methods or higher-fidelity queries; this is **not** a shipped NEXUS capability.

## Acceptance criteria before calling either feature implemented

- Off never starts council agents; Adaptive starts at most one specialist; On starts at most three per checkpoint.
- No arbitrary NEXUS token cutoff; incomplete responses are visibly incomplete.
- Actual permission boundaries, cancellation and error handling verified in the installed Claude Code runtime.
- UI responds to real events and has correct narrow-terminal and reduced-motion behavior.
- Regression tests for mode transitions, selection parse failures, stale snapshots, duplicate launches, and missing telemetry.
- Compare council vs one Opus on unique valid findings, false positives, latency, and reported token usage.

## Attribution

Council's independent opinions and synthesis pattern is **inspired by** [Karpathy's LLM Council](https://github.com/karpathy/llm-council). NEXUS's code-review specializations, selective activation, and left-pane integration are proposed NEXUS designs, not features of that project. **No upstream code is copied.** Upstream repository license must be verified before any code reuse.

Least-privilege agents, dynamic tool/model switching, and a decision-model/active-learning direction were **suggested in research discussions with Dr. Tian Tian**, who pointed to [pi-pocket](https://github.com/alchem0x2A/pi-pocket) and his own tool-routing experiments. This acknowledgment does not imply endorsement or authorship by Dr. Tian.
