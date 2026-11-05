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

## What is shown, and what is collected

NEXUS keeps *collecting* and *showing* apart. The setting **Usage & Stats → What to show** only changes what is drawn; the figures are still recorded, so hiding a number never loses it and never changes how NEXUS routes, reviews or warns.

| Preset | Shows |
| :--- | :--- |
| **Minimal** | Agent status, the lead's activity, and alerts. |
| **Standard** (default) | Plus context, execution times, Council and Jev status, and plan usage. |
| **Full** | Plus token counts (input, output, cache reads and writes), the cost estimate, and routing detail. |
| **Custom** | Each of: context, costs, plan usage, tokens, execution times, routing, activity log, warnings. |

Choosing one number by hand turns the preset into *Custom*, starting from what was shown, so nothing jumps.

**Always shown, whatever the preset:** a failed agent or Council reviewer, context or a plan window at 90% or more, and Jev down. Only the amber 70% warnings can be turned off.

**Rules the numbers follow**

- A figure Claude Code did not report is `N/A`, never `0`; a total of nothing is `N/A`.
- Tokens are summed once per request (each is counted under its request id), per model and per agent, from what the requests reported. Per-agent *cost* is `N/A` by design: Claude Code prices the session as a whole, and NEXUS does not split it.
- The session cost is an **API-priced estimate** (what `/cost` totals), not necessarily a subscription charge. Plan usage (the 5-hour and weekly windows) is a different thing and comes only with API responses, so it is marked stale after 15 minutes.
- Council reviewer tokens come from the reviewer's own requests; Jev's spend is an estimate from the input tokens the API reported.
