#!/usr/bin/env python3
"""Repository checks that need no Claude Code: manifests parse, versions agree, relative links resolve."""
import json, re, sys
from pathlib import Path

root = Path(__file__).resolve().parents[2]
errors: list[str] = []

def load(p: str):
    try:
        return json.loads((root / p).read_text())
    except Exception as e:  # noqa: BLE001
        errors.append(f"{p}: {e}")
        return {}

plugin = load("mod/nexus/.claude-plugin/plugin.json")
top = load(".claude-plugin/marketplace.json")
mod = load("mod/.claude-plugin/marketplace.json")
version = plugin.get("version")

def versions(m: dict) -> list[str]:
    out = []
    for p in m.get("plugins", []):
        if "version" in p:
            out.append(p["version"])
    return out

for name, m in (("marketplace.json", top), ("mod/marketplace.json", mod)):
    for v in versions(m):
        if v != version:
            errors.append(f"{name} says {v}, plugin.json says {version}")

changelog = (root / "CHANGELOG.md").read_text()
if version and not re.search(rf"^## {re.escape(version)}\b", changelog, re.M):
    errors.append(f"CHANGELOG.md has no '## {version}' section")
m = re.search(r"NEXUS_VERSION\s*=\s*'([^']+)'", (root / "mod/nexus/hooks/docs.tsx").read_text())
if not m:
    errors.append("NEXUS_VERSION not found in hooks/docs.tsx")
if m and m.group(1) != version:
    errors.append(f"NEXUS_VERSION is {m.group(1)}, plugin.json says {version}")

# Relative links in the markdown that ships.
link = re.compile(r"\]\((?!https?:|#|mailto:)([^)\s#]+)(?:#[^)]*)?\)")
for md in list(root.glob("*.md")) + list((root / "mod/nexus").glob("**/*.md")) + list((root / "skills").glob("**/*.md")) + list((root / ".github").glob("**/*.md")):
    for target in link.findall(md.read_text()):
        if not (md.parent / target).exists():
            errors.append(f"{md.relative_to(root)}: broken link {target}")

if errors:
    print("\n".join(errors))
    sys.exit(1)
print(f"ok: version {version}, manifests parse, links resolve")
