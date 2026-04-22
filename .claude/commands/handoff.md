---
name: handoff
description: Generate a Handoff log entry for rotating out of, or into, the current issue. Produces both the log entry for `.claude/issues/<N>-<slug>.md` and a matching GitHub issue comment.
---

# /handoff — log rotation to or from this issue

## What this skill does

Generates a correctly-formatted **Handoff log** entry for `.claude/issues/<N>-<slug>.md` plus a matching **GitHub issue comment** the engineer can post directly on the issue.

Automatically detects which issue is active from the current branch name, and produces the right direction of entry based on the user's input.

## How to invoke

- `/handoff out` — before you step away from the issue (planned or unplanned rotation)
- `/handoff in` — after you pull the branch and confirm you can reproduce state
- `/handoff` — Claude asks which direction

---

## Instructions for Claude

### Step 1 — confirm direction

If the user passed `out` or `in` as an argument, use that. Otherwise ask once:

> Are you handing off **OUT** (leaving the issue) or **IN** (taking over)?

Do not proceed until direction is confirmed.

### Step 2 — locate the issue progress file

1. Run `git branch --show-current` to get the active branch.
2. Parse the pattern `<milestone>/task/<slug>` (e.g. `v1.0.0/task/singleton-trait` → slug is `singleton-trait`).
3. Search `.claude/issues/` for a file matching `*-<slug>.md`.
4. If exactly one match, that's the file.
5. If no match, ask the user: "Couldn't find a progress file for this branch. What's the issue number and slug?"
6. If multiple matches, list them and ask which one.

Read the file — it provides context for what's been done.

### Step 3a — for `out` direction, gather context

Collect these before drafting the entry. Do the investigation first, then ask only the questions you can't answer from the repo state.

1. **Branch state:**
   ```bash
   git log -8 --oneline
   git status
   git rev-parse --short HEAD
   ```
   Flag any uncommitted or untracked changes — they must be either committed (`wip:` prefix OK), stashed, or pushed to a WIP branch before handoff.

2. **What's done / in progress / next:**
   - Read the issue file's `Files changed so far` and `Decisions made` sections — done work is there.
   - Compare against the GitHub issue body's `What you're building → In scope` list — figure out what's still outstanding.
   - Look at `git diff HEAD~1` for the most recent work — that's likely "in progress".

3. **Verification state:**
   - Read the issue file's `Verification run` section — last known-green state.
   - Confirm with the user whether it's still accurate ("Have you run the verification commands since this log?").

4. **Gotchas worth flagging:**
   - Grep for `TODO` / `FIXME` / `XXX` in the diff since the last commit on the base branch:
     ```bash
     git diff release/<milestone>...HEAD | grep -E '(TODO|FIXME|XXX)'
     ```
   - Check for suppression directives added to `phpstan.neon.dist`, `phpcs.xml.dist`, or `.eslintrc.js` — those are non-obvious state the incoming engineer needs to know about.
   - Check if any config files changed (`composer.json`, `package.json`, `phpcs.xml.dist`, etc.).

5. **Blockers / open questions:**
   - Read the issue file's `Open questions` section.
   - If entries are stale (resolved but not cleaned up), flag to the user before generating the log.

### Step 3b — for `in` direction, verify reproducibility first

Before drafting an incoming entry, make sure the engineer can actually reproduce state. Ask:

> Have you run the repo's verification commands on this branch? (`composer check` for PHP repos, `npm run check` for JS repos.)

If not, tell them to run:

```bash
git fetch origin
git checkout <milestone>/task/<slug>
git pull
composer check    # or: npm run check
```

Only proceed with the log entry after they confirm exit code `0`. If the commands fail, help them triage what's changed between the outgoing-handoff commit and HEAD before continuing.

### Step 4 — ask the minimum needed questions

For `out` direction, ask one at a time (don't dump everything at once):

1. **Reason for rotation** — e.g. "Client X escalation", "End of sprint rotation", "Permanent rotation"
2. **Expected return date** — an estimate is fine; "fully off" is fine too
3. **Anything a reviewer or the next engineer needs to know that isn't already in git history or the issue file?**
4. **Contact availability during the rotation** — "Slack DM OK", "Fully off", "Emergency only"

For `in` direction, ask only:

1. **Any deviations from the outgoing plan?** (If they agree with the outgoing engineer's next steps, answer is "none")

### Step 5 — produce two artifacts

Output BOTH clearly separated. Do not combine them.

#### Artifact 1 — Handoff log entry (paste into `.claude/issues/<N>-<slug>.md`)

Use the **exact** template below. Keep bullets tight — this is a log, not a narrative.

**OUT entry template:**

```markdown
### → Handoff OUT · <YYYY-MM-DD> · @<github-handle>

- **Reason for rotation:** <one line>
- **Expected return:** <date or "permanent rotation — someone else taking over">
- **Branch state:** `<branch-name>` pushed to remote, HEAD at commit `<short-sha>`
- **What's done:**
  - <bullet>
  - <bullet>
- **What's in progress:**
  - <bullet — usually 1–2 items>
- **What's next:**
  - <bullet — exactly what the incoming engineer tackles first>
- **Blockers / open questions:**
  - <bullet, or "None currently">
- **Gotchas for the incoming engineer:**
  - <anything non-obvious from the code alone, or "None">
- **Contact:** <availability>
```

**IN entry template:**

```markdown
### ← Handoff IN · <YYYY-MM-DD> · @<github-handle>

- **Confirmed reproducibility:** <what I ran, result>
- **Starting point:** <what I'm picking up first>
- **Deviations from plan above:** <one line, or "None">
```

#### Artifact 2 — GitHub issue comment (paste into the issue)

Short, 3–5 lines. Links back to the log entry. @mentions whoever matters.

```markdown
### 🔄 Handoff <OUT|IN> — @<current-engineer> <→|←> @<other-engineer or "TBD">

<1–2 sentence plain-language summary>

Full details in `.claude/issues/<N>-<slug>.md` → Handoff log.

cc @<next engineer if known, else pod lead>
```

### Step 6 — hand back to the user without taking further action

Do **not** commit, push, or post the comment yourself. Print both artifacts with clear instructions:

**For OUT direction, remind the user to:**

1. Append Artifact 1 to `.claude/issues/<N>-<slug>.md` → `Handoff log` section
2. Commit + push the log update (small commit — just the log is fine: `chore(handoff): log rotation out of #<N>`)
3. Apply `Status: Blocked` label on the GitHub issue with a short note
4. Post Artifact 2 as a GitHub issue comment

**For IN direction, remind the user to:**

1. Append Artifact 1 to `.claude/issues/<N>-<slug>.md` → `Handoff log` section
2. Commit + push the log update (`chore(handoff): log rotation into #<N>`)
3. Remove `Status: Blocked` label from the GitHub issue (if they're actively resuming)
4. Post Artifact 2 as a GitHub issue comment

---

## Why this matters

With 4-hour-per-day senior availability, engineers will rotate in and out of issues regularly. A clean handoff turns a 4-hour window into 4 productive hours. A messy handoff turns it into 2 productive hours plus 2 hours of archaeology. Across a sprint that's the difference between shipping and slipping.

The handoff log is the single source of truth for rotation state — not Slack threads, not DMs, not the PR description. It lives with the code, in the issue file, under git.
