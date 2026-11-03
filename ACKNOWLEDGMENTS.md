# Acknowledgments

## Cache Guard and Cachebeat

Cache Guard draws inspiration from [Cachebeat](https://github.com/ARahim3/cachebeat), created by [Abdur Rahim (@ARahim3)](https://github.com/ARahim3). Cachebeat is MIT-licensed (Copyright (c) 2026 Abdur Rahim).

Cache Guard was written independently for NEXUS. **No Cachebeat code is reused**, so no third-party licence text is bundled. If any Cachebeat code is ever ported, its MIT notice will be added in a `THIRD_PARTY_NOTICES` file.

This acknowledgment does not imply that the Cachebeat author endorses NEXUS.

| | Origin |
|---|---|
| Beat only after N minutes of true inactivity, N under the cache lifetime (default 50) | Cachebeat's design |
| An auto-stop deadline for abandoned sessions (default 8 hours) | Cachebeat's design |
| Stand down when idle time already exceeds the cache lifetime (the cache is cold) | Cachebeat's design |
| Judge a beat by its own usage: cold when it wrote more cache than it read | Cachebeat's design |
| Beats as `$.model.fork` calls (no turn, no transcript entry, tools denied, invisible to plugin hooks) | NEXUS |
| Beat-count and API-estimate budgets, checked before a beat that would pass them | NEXUS |
| Cache-lifetime evidence (subagent 1-hour writes, a cache that held over real idle time, beats) | NEXUS |
| States OFF / ARMED / REFRESHING / WARM / EXPIRED / PAUSED / ERROR and the dashboard module | NEXUS |
| Holding beats while agents run or a permission dialog waits; reload and session-end handling | NEXUS |

Cachebeat runs as a skill with a background `Stop` hook (`asyncRewake`) that wakes the main model. Each beat is a real turn answered with ".". NEXUS uses a model fork instead, so beats don't enter the transcript and never pass through Swarm's own model-routing, escalation, Jev or advisor hooks.

## NEXUS Council and tool routing

[NEXUS Council](mod/nexus/docs/council-and-tool-routing.md) is inspired by [Andrej Karpathy's LLM Council](https://github.com/karpathy/llm-council): independent model reviews, then a synthesis. NEXUS adapts the idea to software-engineering review inside Claude Code. It uses its own Security, Architecture and Performance reviewers, Off / Adaptive / On activation with the advisor choosing in Adaptive, a gated, read-only launch, and a merge with no extra chairman model. **No LLM Council code is used.** Its licence would be checked before any code was ported.

Dr. [Tian Tian](https://www.ualberta.ca/en/engineering/faculty-staff/academic-staff/tian-tian.html) suggested several ideas in research discussions:
- minimal initial agent toolsets;
- dynamic tool and model routing;
- small fine-tuned decision models;
- longer-running autonomous metadynamics workflows.

He also shared the [pi-pocket](https://github.com/alchem0x2A/pi-pocket) harness as a reference. These ideas shaped Council's least-privilege reviewer tools, the deterministic router and its narrow-only extension point for a future decision model. This doesn't imply his endorsement of NEXUS, and no scientific workflow is part of NEXUS.
