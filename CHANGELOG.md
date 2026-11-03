# Changelog (NEXUS)

## Unreleased: Haiku agents, benchmarked
- **`nexus-audit` redesigned on benchmark evidence**, keeping its name:
  - It now checks the lead's own checkout read-only (Read, Glob, Grep, Bash). It has no Write, no `acceptEdits` and no isolated worktree.
  - The old design applied a pasted diff in a worktree. In one run it rebuilt the patch four times before `git apply` took it.
  - Results for the shipped definition, forced-delegation runs, n=2:
    - "Review the uncommitted change": 51 s vs 91 s, 42% fewer Haiku input tokens, the agent's own Haiku cost 54% lower, and the session cost 22% lower.
    - "Find why the type-check fails and confirm it": 1.0 vs 0.5. The old audit stepped out of its worktree and its `tsc` never ran.
  - It runs checks in the foreground, takes commands from the task, README, package files or CI config, and stays inside the repository. In a live auto-mode smoke test, an earlier draft searched the whole disk for `tsc`.
- **No new roles.** The proposed Explorer / Tracer / Auditor set was benchmarked against Search / Grep / Audit and against no Haiku agents, and wasn't adopted under the rule fixed before the runs:
  - In 42 natural runs the Sonnet lead delegated 0 times, with equal correctness (1.000 in all three setups).
  - Under forced delegation, Explorer tied Grep and Tracer was 4% cheaper than Grep.
  - The lead never picked `nexus-search`; with the current set it chose `nexus-grep` for every lookup and trace.

  See [docs/haiku-agents-benchmark.md](mod/nexus/docs/haiku-agents-benchmark.md).
- Dashboard: no change. The audit card shows "in a worktree" only for an old definition that still declares `isolation: worktree`, and tests cover both.

## Unreleased: Council reliability, security and performance audit
- **Security:** reviewers are confined to the session's directories (symlinks followed), and a Grep `glob` that could select a secret file is refused; before, `glob: ".env*"` and a symlink with an innocent name returned a gitignored `.env`'s contents. `git_read` refuses pathspec magic (`:(glob)…`) and a bare `show` leaves secret files out of the patch. More credential files count as secrets. Reviewer-supplied finding paths are no longer opened by NEXUS to count lines unless they pass the same check; findings outside the repository are marked `outside-repo` and their evidence withheld.
- **Verdict integrity:** finding text is one bounded line, so a reviewer (steered by the code it read) cannot start a forged `CRITICAL · …` line in the verdict. Text is cut before redaction (redaction was quadratic: 80k characters took 3–5 s of the plugin's event loop).
- **State:** the snapshot hash now includes the content of untracked files, so editing a new file after a review is a new diff and shows STALE during a review (before, it was skipped as "already reviewed"). A reviewer launch the engine throws on no longer leaves Council saying "already running" for the rest of the session. The repository is the session's current directory, not where it started. A settings store that cannot be read at start no longer has its saved settings overwritten with defaults; the `NEXUS_COUNCIL_ACTIVATION` override is no longer saved by a later settings change.
- **Performance:** the diff is parsed once per snapshot (it was re-parsed per untracked file); line counts run in parallel and are bounded; session bookkeeping (reviewer ends, roles, hand-backs, grants) is capped.
- **Jev hints:** a read under `/workspace/../…` is no longer treated as inside the workspace.
- **Found by the Council reviewing this diff (checkpoint #1, all three Opus specialists), verified, then fixed:**
  - A backslash-escaped glob (`\.env`) and globs reaching `credentials.json`, `secrets/`, `.aws/`, `.ssh/` or `*.json` still made ripgrep search gitignored credential files (reproduced against ripgrep). Backslash globs are now refused and the glob check covers every class `isSecretPath` refuses; `*.json` is refused, `package.json` is not.
  - Path confinement is no longer opt-in: a path-bearing reviewer call with no directories to confine it to is refused. A file system that cannot say where a path leads is refused (only a missing file counts as "not there yet").
  - The reviewer-role map is not capped (the tool gate keys on it, so an evicted running reviewer would have gone unchecked).
  - A checkpoint keeps the repository root it was authorized in (finalize, line counts, `git_read`, confinement), so a `/cd` during a review no longer mixes repositories.
  - New files whose content cannot be hashed (timeout, a file vanished) are reported as "could not re-check", never STALE, and never match an earlier "already reviewed" snapshot.
  - A partial checkpoint (some authorized reviewers never launched, or one launch threw) delivers its verdict on the lead's next prompt; before, it was computed and dropped.
  - A peer hand-back with no `<result>` wrapper falls back to the report in the message body when the reviewer's `SubagentHandback` call was not seen.
  - Cheaper: one `session.cwd` per reviewer call; line counts read at most 8 files at once.
- **Found by the final Full Council review (checkpoint #1 of a fresh session, all three Opus specialists completed), verified, then fixed:**
  - High: a Grep `glob` holding several globs (`*.ts .env`, `*.ts,.env`, `!x .env`) got past the secret-glob check. Claude Code's Grep splits `glob` on whitespace and on commas outside braces, and each of these searched a gitignored `.env` (probed on Claude Code 2.1.317). Each piece is now checked; negations alone stay allowed (probed: `!*.ts` alone still honours `.gitignore`).
  - Medium: a Grep or Glob with no `path` searches the session's directory and was not confined; after a `/cd` mid-review it could search another repository. It is now checked against the checkpoint's repository, and refused when there is none.
  - Medium: one failed `stat` of the repository root was cached for the session and refused every later reviewer read. Only a resolved root is cached now.
  - Glob's `pattern` is confined (no absolute, `~` or `..` patterns). A bare `git_read show` leaves secret files out case-insensitively (a committed `.ENV` was printed) and also leaves out `.claude.json` and `.docker/config.json`. A finding's file path is kept as written (it was redacted and had its spaces collapsed) and dropped if it holds a line break. Line counts no longer ask for the session's directory per file. The outside-the-repository rule for finding paths is one helper.
  - Rejected with evidence: "negative globs may search gitignored files" (probed: they do not).
- **Found by a targeted follow-up Council checkpoint on those fixes (all three completed), verified, then fixed:**
  - High: checking a Grep glob's spelling cannot be complete. `*.staging` searched a gitignored `.env.staging`, and even `*.ts` searched a gitignored `.env.ts` (probed). Every reviewer Grep now has negations for every secret class appended after its own glob, case-insensitive. In ripgrep the later glob wins (probed: `*.ts`, `**/*` and no glob, each with the negations, found no secret). The spelling check stays as a first layer that refuses with a reason.
  - High: `git_read show` with a path printed secrets: git reads `*env` as a wildcard, and `.` or a directory took in a committed `.env` (checked against git). Paths with `*`, `?`, `[` or `\` are refused, and the secret exclusions now follow any path.
  - High: when both the repository root and a path failed to resolve, the two "could not tell" markers matched each other and confinement passed. An unresolved path or root is now refused outright.
  - Medium: outside any repository, the reviewer gate fell back to "the session's directory is the repository", so its "no repository" refusals could not fire. With no checkpoint open and no git repository, reviewer reads and `git_read` are refused. One `reviewRoot` decides which repository a reviewer is bound to.
  - ESC, C1 controls and U+2028/U+2029 are stripped from finding text and refuse a finding path. Glob patterns cannot climb out through braces (`{../..,x}/**`). `git show` also leaves out `*.keychain` and `*.keychain-db`.
- **Found by a second targeted checkpoint (all three completed; no high findings), verified, then fixed:**
  - Medium: a changed **tracked** secret (`.env`, `*.pem`, a file named `credentials`) had its full diff pasted into every reviewer's prompt; this predates the audit (checked against git). The reviewers' diff now leaves secret files out, they are told how many were left out, and the secret files' own diff is hashed, so editing one is still a new snapshot.
  - Medium: the secret lists had drifted apart (the git exclusions and Grep negations missed a file named `credentials` or `secrets`). One `SECRET_GLOBS` table now feeds the diff and `show` exclusions, the secret pathspecs and the Grep negations.
  - `git_read show` peels its ref to a commit (`<ref>^{commit}`), so a blob id cannot print a file whole (checked against git). An unhashed snapshot is not kept in the "already reviewed" list, where it could only push a real one out.
  - Rejected with evidence: "a crafted glob can stall the plugin's event loop" (timed: a 919-character, many-wildcard glob took 1 ms; the names it is tested against are at most 21 characters).
- **Final targeted checkpoint (all three completed): no high or medium findings.** From its lows: the snapshot diffs pass `--no-textconv` (as `git_read show` does), a secret-file diff cut at the output cap counts as "could not re-check", and a table-driven test now fails if a secret class is missing from the Grep negations.
- Accepted, low: hashing very large untracked files can time out (then a review is not matched against earlier ones, so it can be re-authorized; never a false "already reviewed"). The ~37 icase exclude pathspecs on each snapshot diff are not timed on very large repositories. A repository inside a secret-looking folder refuses every reviewer read (fails safe).
- After the last checkpoint, a regression in an earlier round's fix was found and fixed (flow test): a session spelled through a symlink (`/tmp/repo`, with git naming `/private/tmp/repo`) had relative reads and path-less searches refused. Where a path really leads decides again, and a path-less search accepts the session directory's resolved location.
- Tests: 163 → 202.

## 0.7.0 (2026-11-02): NEXUS Council and reviewer tool routing
- **NEXUS Council:** read-only Opus Security, Architecture and Performance reviewers at a review checkpoint (`mcp__nexus__council_review`). The setting is `council.activation`, saved in the plugin store:
  - Adaptive (the default): the advisor picks at most one;
  - On: all three, concurrently, with a yellow token warning;
  - Off: the single advisor, unchanged.
- **How a checkpoint runs:** NEXUS authorizes, then the lead launches the reviewers with its own Agent tool. NEXUS gates each launch, gives every reviewer the same fixed git snapshot, checks file and line references, merges duplicates, redacts emails and tokens, marks stale or incomplete runs, and returns the verdict to the lead.
- **Reviewer tool routing:** reviewers start with Read, Grep and Glob. Writes, shell, network and agents are withheld by the agent definition and refused again by a hook that fails closed, which also blocks secret paths. `git_read` (fixed argv, no shell) is granted on request by a deterministic router, and every request is logged (`/nexus council ledger`).
- **Dashboard:** the left Opus panel splits into the three reviewers, each with an event-driven link to the lead. Compact and list layouts show a one-line strip.
- **Commands:** `/nexus council [adaptive|on|off|status|findings|ledger]`.
- **Background reviewers:** when Claude Code runs reviewers in the background (interactive sessions), their hand-back reports are allowed and read. Each checked result, and the merged verdict, arrive with the reviewer's report (its hand-back message or completion notification). An advisor call in the same response as `council_review` is now seen. A reviewer stopped from the task list, or a plugin reload mid-review, is reported INCOMPLETE; the checkpoint never stays running.
- **Benchmark** against the single advisor, in the Council guide: on three small tasks, Off found 14 of 15 planted issues, Adaptive and On 15, with no false positives, at about +35% and +97% API-priced cost.
- **Preferences:** stored preferences move to v3 and keep every earlier value. Saved pane widths from v2 are kept (0.6.0 also read v2 only).
- **Privacy:** NEXUS redacts its own verdict, dashboard and log. Reviewers' raw reports, delivered to the lead by Claude Code, aren't redacted, and secret blocking covers named paths only. See the Privacy section of the Council guide.
- **Credits:** Karpathy's LLM Council and Dr. Tian Tian's routing ideas are acknowledged (no code reused).

## 0.6.0 (2026-11-02): NEXUS everywhere
- The plugin is now `nexus` and its marketplace `muhzain05`: `claude plugin marketplace add muhzain05/Nexus`, then `claude plugin install nexus@muhzain05 --scope user`. If you installed `swarm-ui@claude-swarm`, uninstall it and install `nexus@muhzain05`; preferences start fresh.
- The deprecated `/swarm`, `/swarm-mode` and `/swarm-jev` aliases are removed. Use `/nexus`, `/nexus-mode` and `/nexus-jev`.
- The NEXUS agents are `nexus-search`, `nexus-grep` and `nexus-audit` (formerly `swarm-*`); other agent types still show as fallback agents.
- The Jev key's Keychain item is now `nexus-typesafe`.
- The source moves to `mod/nexus`.

## 0.5.0 (2026-11-02): NEXUS commands, help and onboarding
- Commands move to the NEXUS namespace: `/nexus` (open, close, agents, inspect, usage, settings, layout, width, cache, doctor), `/nexus-mode`, `/nexus-jev`, `/nexus-help`, `/nexus-about`. `/swarm`, `/swarm-mode` and `/swarm-jev` still work as deprecated aliases and say where each moved.
- `/nexus-help` and `/nexus-about` draw in the transcript with the NEXUS mark; plain text where nothing draws. `/nexus doctor` checks the install, read-only.
- The NEXUS mark beside the wordmark moves through a whole turn (agents included) and settles when it ends.
- A ⚙ in the header (click, or `s` with the pane focused) opens settings, which now fill the pane and show preferences only. `advisorOrbit` is renamed `orbitStyle`; stored values carry over.
- The advisor orbit is redesigned: two satellites turning opposite ways on their own orbits, with trails, dispersal and reformation.
- The lead box centres its orbit and text; Jev bars are green (sharp bright, split muted) in fixed, centred columns.

## 0.4.1 (2026-11-02): NEXUS polish
- NEXUS branding in the pane: a centred spaced wordmark with its subtitle beneath, and room above it. Command and plugin ids are unchanged.
- The running models form a vertical legend at the bottom of the left column, ending with `Mode: Balanced` and the resize keys (ctrl+x ←/→ while the pane has focus; dragging works too, up to Claude Code's 45% limit).
- Every full-width element in the diagram (advisor link, JEV, Cache Guard, USAGE) shares the card grid's edges.
- The NEXUS emblem (a hub linked to four role-coloured nodes) appears at the right of the header and as the plugin icon.
- Haiku cards are fixed-size (7 rows). The orbit sits in the top-right corner as a one-row edge-on orbit, the status row is always last, and text is cut with `…`. The floating orbit row above the cards is gone.
- The advisor panel is grouped into bands (model and status, orbit, stats with placeholders, pair check and recent calls) and ends with its content. At rest, the orbit shows a dim constellation instead of a single glyph.
- The lead orbit is narrower; the Jev header's decision arc is one row.

## 0.4.0 (2026-11-02)
- Advisor sidebar shows data only: model, last consultation, calls, context, duration, short history; "Awaiting consultation." when empty.
- Agent inspection: each instance has its own label (`search#2`), fallback agents are marked, and an agent's lifecycle, tokens, files, recent activity and result can be opened. Use `/swarm agents`, `/swarm inspect`, or hotkeys 1–9 in the focused pane.
- Layouts auto/full/compact/minimal and `/swarm settings`, kept in the plugin's own store.
- Telemetry: main-thread context from Claude Code, session cost labelled "API est.", tokens per model counted once.
- USAGE monitor: only the rate-limit windows Claude Code reports; a Fable row only when Claude Code names one.
- Swarm Orbit animations: lead, Haiku, advisor (Dual-Orbit, wide and tight), Jev and Cache Guard.
- Cache Guard (off by default): idle-time cache warming through model forks, inspired by Cachebeat.
- MIT licence; GitHub marketplace manifest at the repository root.

## 0.3.0
- Active Jev routing for the lead's read-only calls, gated by calibration (`/swarm-jev`).

## 0.2.x
- Session-scoped model modes (`/swarm-mode`), escalation dialog, event animations, Jev Keychain key.

## 0.1.0
- Native pane, band and spinner in Claude Code's own terminal.
