# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's private reporting:

**[Report a vulnerability](https://github.com/muhzain05/Nexus/security/advisories/new)** (repository → Security → Report a vulnerability).

Include what you found, how to reproduce it, and the Claude Code version (`claude --version`). Never include real credentials.

You can expect an acknowledgement within a few days. This is a one-person project, so there is no guaranteed response time, and fixes are released as soon as they are verified.

## What counts

NEXUS draws a dashboard and applies a few safety rules to agents it watches. In scope:

- the Council reviewers reading files they should not (secrets, outside the repository) or writing anything;
- the Test agent running a command the allowlist should refuse;
- Jev routing changing anything beyond its documented, read-only actions;
- NEXUS writing, logging or sending a key, token or file path it should not.

Out of scope: what a project's own tests do once the Test agent starts them (they run with the lead's permissions, by design), and Claude Code itself.

## Supported versions

The latest release. Older ones are not patched.
