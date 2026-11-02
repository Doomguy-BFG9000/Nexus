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

## Council and tool-routing design influences

The proposed [NEXUS Council](mod/nexus/docs/council-and-tool-routing.md) takes inspiration from [Andrej Karpathy's LLM Council](https://github.com/karpathy/llm-council), particularly independent model reviews and synthesis. NEXUS proposes its own Security, Architecture and Performance code-review specialists and Off / Adaptive / On activation. **No LLM Council code has been copied.** The upstream repository's reuse terms must be checked before porting code.

Dr. [Tian Tian](https://www.ualberta.ca/en/engineering/faculty-staff/academic-staff/tian-tian.html) contributed ideas in discussions about minimal initial agent tools, dynamic tool/model routing, small fine-tuned decision models, and longer-running autonomous metadynamics workflows. He also shared the [pi-pocket](https://github.com/alchem0x2A/pi-pocket) harness as a reference. These discussions informed the proposed tool-routing research direction; they do not imply his endorsement of NEXUS or that these features are implemented.
