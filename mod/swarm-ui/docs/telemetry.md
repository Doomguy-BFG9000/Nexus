# Telemetry: what the numbers mean

[← Back to the README](../../../README.md)

> **Honest by design.** Every number comes from Claude Code. Anything it doesn't report reads `N/A`, and estimates are labelled `API est.`

| On screen | Meaning | Source |
|---|---|---|
| `context 53k / 1.0M · 947k left · 5%` | how full the lead's context window is now | Claude Code's status-line figures |
| `session $0.11 API est.` | this session at API prices; on a subscription, an estimate, not a charge | Claude Code's `/cost` ledger |
| `5h ███░░ 17%` · `7d █░░░ 9%` | your plan's rate-limit windows, with local reset times | the rate-limit windows Claude Code receives |
| tokens by model | each request counted once, lead and agents apart | Claude Code's per-request usage |

Your plan name and a Fable weekly window appear only if Claude Code reports them; nothing is guessed. Plan figures go grey and say **stale** after 15 minutes without a response.

`/nexus usage` prints the same figures in the conversation.

## What isn't reported

- **Advisor:** visible only once the request it ran in ends. Its tokens and cost aren't reported to plugins.
- **Per-agent cost:** shown as N/A, because Claude Code prices only the session as a whole.
