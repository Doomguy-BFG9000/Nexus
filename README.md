<div align="center">

<img src="mod/nexus/docs/media/nexus-mark.gif" alt="NEXUS" width="460">

### Your agents were always working. Now you can see them.

**A live command center inside Claude Code.**

[Install](#install) · [Demo](#demo) · [Docs](#more-information)

</div>

## Demo

<div align="center">

<img src="mod/nexus/docs/media/nexus-demo.gif" alt="Real NEXUS session with parallel agents and an advisor consultation" width="100%">

<sub>[Watch in 1080p](mod/nexus/docs/media/nexus-demo-1080p.mp4) · Real session footage</sub>

</div>

## Install

```bash
claude plugin marketplace add muhzain05/Nexus
claude plugin install nexus@muhzain05 --scope user
```

Start a fresh Claude Code session, then run **`/nexus`**. Use the fullscreen TUI for the docked dashboard.

**Optional companion skill:**

```bash
npx skills add muhzain05/Nexus --skill nexus -g -a claude-code
```

<sub>The skill helps with setup and troubleshooting; the native dashboard requires the plugin above.</sub>

## One terminal. Four roles.

<table>
<tr>
<td width="50%" valign="top">
<img src="mod/nexus/docs/media/role-sonnet.png" width="100" align="right" alt="Sonnet orbit">

**SONNET · Lead**

Plans, writes code, and coordinates the team.
</td>
<td width="50%" valign="top">
<img src="mod/nexus/docs/media/role-haiku.png" width="100" align="right" alt="Haiku orbit">

**HAIKU · Agents**

Searches, explores, and audits in parallel.
</td>
</tr>
<tr>
<td valign="top">
<img src="mod/nexus/docs/media/role-opus.png" width="100" align="right" alt="Opus orbit">

**OPUS · Advisor**

Reviews difficult decisions when consulted.
</td>
<td valign="top">
<img src="mod/nexus/docs/media/role-jev.png" width="100" align="right" alt="Jev orbit">

**JEV · Router**

Optional assistance with read-only next steps.
</td>
</tr>
</table>

<sub>Shown in Balanced mode. Other modes can change the lead and advisor. [Explore model modes](mod/nexus/docs/dashboard.md#model-modes-in-detail).</sub>

<div align="center">

<img src="mod/nexus/docs/screenshots/nexus-dashboard.png" alt="NEXUS terminal dashboard" width="100%">

</div>

**See agent activity, inspect work, and track context, usage and API-priced estimates.** No terminal wrapper or patched binary.

## Get started

| Command | What it opens |
| :--- | :--- |
| **`/nexus`** | Live dashboard |
| **`/nexus-mode`** | Model selection |
| **`/nexus-help`** | Commands & shortcuts |
| **`/nexus-about`** | Quick introduction |

## More information

<details>
<summary><b>Guides & reference</b></summary>

- [Dashboard, agents & model modes](mod/nexus/docs/dashboard.md)
- [Commands, shortcuts & inspection](mod/nexus/docs/dashboard.md#every-command)
- [Telemetry & cost estimates](mod/nexus/docs/telemetry.md)
- [Jev routing](mod/nexus/docs/jev.md)
- [Cache Guard](mod/nexus/docs/cache-guard.md)
- [Compatibility](mod/nexus/docs/compatibility.md)
- [Troubleshooting & uninstall](mod/nexus/docs/troubleshooting.md)
- [Companion Agent Skill](skills/nexus/SKILL.md)
- [Changelog](CHANGELOG.md) · [Acknowledgments](ACKNOWLEDGMENTS.md)

</details>

<details>
<summary><b>Important notes</b></summary>

NEXUS shows only telemetry Claude Code reports; unavailable values display `N/A`. Session costs are **API-priced estimates**, not necessarily charges to subscribers. Advisor activity is reported after consultations complete. Jev and Cache Guard are optional; Cache Guard is off by default. Fable availability and credit usage depend on your plan.

</details>

---

<div align="center">

<img src="mod/nexus/docs/screenshots/nexus-icon.png" width="56" alt="NEXUS icon">

**Made by Muhammad Zain** · [MIT License](LICENSE)

</div>
