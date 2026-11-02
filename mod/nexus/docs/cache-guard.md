# Cache Guard

[← Back to the README](../../../README.md)

Claude Code's prompt cache expires after you've been idle a while, and the next message pays to re-read the whole conversation. **Cache Guard** (off by default) sends a small, invisible beat after a set number of idle minutes to keep that cache warm. It only helps if you come back; every beat costs a little.

- **How a beat works:** it's a Claude Code model fork. A fork adds no conversation turn or transcript entry, has every tool denied, and is unseen by NEXUS's own hooks.
- **When it won't beat:** never while the lead works, an agent runs or a permission dialog waits.
- **When it stops itself:** after its hours cap, beat count or budget, or once idle time has passed the cache's lifetime.
- **It doesn't assume the cache lasts an hour:** it waits for evidence, or for your `trustTtl` setting.

| You come back… | without Cache Guard | with Cache Guard |
|---|---|---|
| before the cache expires | ~0.1× (cache read) | ~0.1× (no beat needed) |
| after it expires | ~2× (rebuild) | ~0.1× per beat, then ~0.1× |
| never | 0 | every beat was extra |

<sub>Multiples of the conversation's input price, per Anthropic's cache pricing. NEXUS reports what beats cost and shows savings as N/A, because it can't know whether you'll return.</sub>

## Settings

Turn it on with `/nexus cache on`, or change a setting with `/nexus settings <key> <value>`:

| Setting | Default | Range |
|---|---|---|
| `cacheGuard.enabled` | off | on · off |
| `cacheGuard.idleMin` (idle minutes before a beat) | 50 | 5–55 |
| `cacheGuard.maxHours` (hours before it stops) | 8 | 1–24 |
| `cacheGuard.maxBeats` (beats per session) | 10 | 1–50 |
| `cacheGuard.budgetUsd` (API est. budget per session) | 0.50 | 0–20 |
| `cacheGuard.trustTtl` (arm without 1h TTL evidence) | off | on · off |

## Attribution

Cache Guard draws inspiration from [Cachebeat](https://github.com/ARahim3/cachebeat) by [Abdur Rahim (@ARahim3)](https://github.com/ARahim3). It's written independently; no Cachebeat code is reused and no endorsement is implied. See [ACKNOWLEDGMENTS](../../../ACKNOWLEDGMENTS.md) for which ideas came from where.
