# `@rtcamp/wp-tooling` AI skills

Copy-pasteable skill files for AI assistants (Claude Code, Cursor, etc.) that drive the scaffold engine.

## What's here

- [`scaffold/`](scaffold/SKILL.md) — End-to-end AI skill for `npx @rtcamp/wp-tooling add`. Tells the AI how to discover scaffolds, introspect the project, apply naming conventions, invoke the engine, handle adaptive wiring, surface secrets without writing them, drive the TDD loop, and report.
- [`setup/`](setup/SKILL.md) — Bootstraps a whole plugin or theme from one natural-language request. Detects existing tooling, plans the right sequence of setup + lint + test + feature scaffolds, confirms the plan with the developer, executes it in two phases, then emits one consolidated report of files written + developer actions outstanding.

Each skill is a directory containing a `SKILL.md` file. Same layout as the Claude Code Skills convention.

## How to install in your own project

The simplest path, for Claude Code users:

```bash
# from inside any project that has @rtcamp/wp-tooling available (via npm or npx)
mkdir -p .claude/skills

# Option A — copy from the installed npm package (preferred):
cp -r node_modules/@rtcamp/wp-tooling/skills/scaffold .claude/skills/scaffold
cp -r node_modules/@rtcamp/wp-tooling/skills/setup    .claude/skills/setup

# Option B — download directly from GitHub if you can't install the package locally:
git clone --depth 1 https://github.com/rtCamp/wp-tooling.git /tmp/wp-tooling
cp -r /tmp/wp-tooling/skills/scaffold .claude/skills/scaffold
cp -r /tmp/wp-tooling/skills/setup    .claude/skills/setup
```

Claude Code picks up the skill on next session start. Invoke it with `/scaffold` or `/setup`, or just by describing what you want to add ("add a WP-CLI command to ...", "set up this plugin").

For other AI orchestrators (Cursor, Continue, Aider, custom agents): drop the skill directory wherever your tool reads skill files from. The frontmatter follows the Claude Code convention (`name:`, `description:`); the body is portable Markdown.

## Customising

The skills are **opinionated** about safety (no auto-installs, no secret values, explicit consent for cross-file edits). If your team wants different defaults, fork the directory in your own repo and adjust. The engine's guarantees (in [`docs/ai-orchestration.md`](../docs/ai-orchestration.md)) do not change with the skill; only the orchestration around them does.

A common customisation: change the project introspection step in `SKILL.md` to match your project's conventions if they differ from the rtCamp skeleton (different bootstrap method name, different namespace style, different anchor convention).

## What these skills never do

Built-in prohibitions (kept in sync with `docs/ai-orchestration.md` section 11):

- Never runs `composer require`, `npm install`, `gh secret set`, or any other write-side CLI without explicit user approval.
- Never reads, logs, or transmits secret values.
- Never edits branch protection, repo settings, or webhooks.
- Never commits, pushes, opens PRs, or comments on issues without explicit approval.
- Never applies cross-file wiring without showing the diff and getting consent.
- Never sends code or developer data to remote services.

If you fork the skills and remove any of these, please be loud about it in your fork's README. They exist for good reasons.
