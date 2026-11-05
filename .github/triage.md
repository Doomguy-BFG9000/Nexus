# Triage guide (maintainers)

Goal: **a first human reply within 24 hours on a best-effort basis.** This is a goal for a one-person project, not a guarantee, and nothing here sends automatic replies.

## Labels
`needs-triage` (set by the forms; remove when read) · `bug` · `enhancement` · `documentation` · `good first issue` · `help wanted` · `needs-info` · `blocked` · `security` (never public; move to a private advisory)

## Routine
1. Open the `needs-triage` list: `gh issue list -R muhzain05/Nexus -l needs-triage`.
2. Reproduce or ask for what is missing (`/nexus doctor`, versions, terminal width). Add `needs-info`.
3. Label it, remove `needs-triage`, reply with the next step.
4. If it is a vulnerability: do not discuss details publicly; ask the reporter to use the private advisory link.

## Saved replies
**Need more info** — Thanks for the report. To reproduce this I need your NEXUS and Claude Code versions, the pane width, and the output of `/nexus doctor` (it never shows secrets). Could you add them?

**Cannot reproduce** — I could not reproduce this on NEXUS {version} / Claude Code {version}. What differs on your side (theme, layout, terminal)? A screenshot of the pane helps.

**Fixed** — Fixed in {pr}, released in {version}. Please reopen if it still happens.

**Security** — Thanks. Please do not post details here. Use https://github.com/muhzain05/Nexus/security/advisories/new and I will follow up there.

**Good first issue** — This is a good starter task. The files to look at and how to test it are in the description; say here if you would like to take it.

## Notifications
Watch the repository (Custom → Issues, Pull requests, Discussions) and enable GitHub mobile push. A reminder workflow is optional and is not installed.
