# `@rtcamp/wp-tooling` AI skills

Copy-pasteable skill files for AI assistants (Claude Code, Cursor, etc.) that drive the scaffold engine.

## What's here

- [`scaffold/`](scaffold/SKILL.md) — End-to-end AI skill for `npx wp-tooling add`. Tells the AI how to discover scaffolds, introspect the project, apply naming conventions, invoke the engine, handle adaptive wiring, surface secrets without writing them, drive the TDD loop, and report.
- [`setup/`](setup/SKILL.md) — Bootstraps a whole plugin or theme from one natural-language request. Detects existing tooling, plans the right sequence of setup + lint + test + feature scaffolds, confirms the plan with the developer, executes it in two phases, then emits one consolidated report of files written + developer actions outstanding.
- [`accessibility/`](accessibility/SKILL.md) — Find → fix → re-check WCAG violations on the running dev site. Runs `npx wp-tooling a11y` (pa11y-ci), triages violations by criterion and impact, maps each one to the theme/plugin source via the report's `domHints`, proposes minimal fixes with consent, and re-verifies until clean.

Each skill is a directory containing a `SKILL.md` file. Same layout as the Claude Code Skills convention.

## How to install in your own project

The simplest path, for Claude Code users:

```bash
# from inside any project that has @rtcamp/wp-tooling available (via npm or npx)
mkdir -p .claude/skills

# Option A — copy from the installed npm package (preferred):
cp -r node_modules/@rtcamp/wp-tooling/skills/scaffold      .claude/skills/scaffold
cp -r node_modules/@rtcamp/wp-tooling/skills/setup         .claude/skills/setup
cp -r node_modules/@rtcamp/wp-tooling/skills/accessibility .claude/skills/accessibility

# Option B — download directly from GitHub if you can't install the package locally:
git clone --depth 1 https://github.com/rtCamp/wp-tooling.git /tmp/wp-tooling
cp -r /tmp/wp-tooling/skills/scaffold      .claude/skills/scaffold
cp -r /tmp/wp-tooling/skills/setup         .claude/skills/setup
cp -r /tmp/wp-tooling/skills/accessibility .claude/skills/accessibility
```

Claude Code picks up the skill on next session start. Invoke it with `/scaffold`, `/setup` or `/accessibility`, or just by describing what you want ("add a WP-CLI command to ...", "set up this plugin", "fix the a11y failures").

For other AI orchestrators (Cursor, Continue, Aider, custom agents): drop the skill directory wherever your tool reads skill files from. The frontmatter follows the Claude Code convention (`name:`, `description:`); the body is portable Markdown.

## Customising

The skills are **opinionated** about safety (no auto-installs, no secret values, explicit consent for cross-file edits). If your team wants different defaults, fork the directory in your own repo and adjust. The engine's guarantees (in [`docs/ai-orchestration.md`](../docs/ai-orchestration.md)) do not change with the skill; only the orchestration around them does.

A common customisation: change the project introspection step in `SKILL.md` to match your project's conventions if they differ from the rtCamp skeleton (different bootstrap method name, different namespace style, different anchor convention).

## Evals

Each skill carries a behavioural eval set at `skills/<name>/evals/evals.json` per the [skill-creator schema](https://github.com/anthropics/skills/blob/main/skills/skill-creator/references/schemas.md). The shape: `skill_name` plus `evals[]` where each entry has `id`, `prompt`, `expected_output`, `files`, `expectations`.

The schema is validated automatically by `tests/skills/evals-json.test.js` (runs in `npm test`). Edits that break the shape — missing fields, duplicated ids, non-string expectations — fail CI before they reach the upstream skill-creator runner.

### Running the evals

The full lifecycle (spawn → grade → aggregate → viewer → feedback → iterate) is **orchestrated from inside a Claude Code conversation** by the Anthropic skill-creator skill — it spawns subagents, grades outputs against `expectations[]`, then runs the aggregation + viewer scripts. There's no standalone CLI for the whole flow; only aggregate + viewer have CLIs.

One-time setup:

```bash
/plugin install skill-creator@claude-plugins-official
```

Then, in a Claude Code session at the repo root, ask the skill-creator skill to run the evals:

```
/skill-creator:skill-creator run the behavioural evals in skills/scaffold/evals/evals.json against the scaffold skill at skills/scaffold/. Spawn with-skill and without-skill subagents, grade against expectations, aggregate, open the viewer.
```

The skill-creator skill will create `skills/scaffold-workspace/iteration-N/` (gitignored), drop per-eval outputs, grade them, produce `benchmark.json`, and open the HTML reviewer in your browser. Same flow for setup.

For a manual spot-check without the skill-creator plugin: copy a `prompt` from `evals.json` into any AI session with the skill installed at `.claude/skills/<name>/` and compare the response against the `expectations[]` list by hand.

### Not behavioural evals

The skill-creator's `scripts/run_eval.py` and `scripts/run_loop.py` are for **description optimization** — trigger evals in the format `[{"query":"...","should_trigger":true}, ...]`, a different schema. Don't point them at `skills/<name>/evals/evals.json`; the runner expects a different shape and they're solving a different problem.

## What these skills never do

Built-in prohibitions (kept in sync with `docs/ai-orchestration.md` section 11):

- Never runs `composer require`, `npm install`, `gh secret set`, or any other write-side CLI without explicit user approval.
- Never reads, logs, or transmits secret values.
- Never edits branch protection, repo settings, or webhooks.
- Never commits, pushes, opens PRs, or comments on issues without explicit approval.
- Never applies cross-file wiring without showing the diff and getting consent.
- Never sends code or developer data to remote services.

If you fork the skills and remove any of these, please be loud about it in your fork's README. They exist for good reasons.
