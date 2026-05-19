# `@rtcamp/wp-tooling` AI skills

Copy-pasteable skill files for AI assistants (Claude Code, Cursor, etc.) that drive the scaffold engine.

## What's here

- [`scaffold.md`](scaffold.md) ─ The end-to-end AI skill for `npx @rtcamp/wp-tooling add`. Tells the AI how to discover scaffolds, introspect the project, apply naming conventions, invoke the engine, handle adaptive wiring, surface secrets without writing them, run the TDD loop, and report. Built from the 12-section contract in [`docs/ai-orchestration.md`](../docs/ai-orchestration.md).

## How to use these in your own project

The simplest path, for Claude Code users:

```bash
# from inside any project that has @rtcamp/wp-tooling available (via npm or npx)
mkdir -p .claude/skills
curl -L -o .claude/skills/scaffold.md \
    https://raw.githubusercontent.com/rtCamp/wp-tooling/main/skills/scaffold.md

# OR, if you have the package installed locally:
cp node_modules/@rtcamp/wp-tooling/skills/scaffold.md .claude/skills/scaffold.md
```

Claude Code will pick up the skill on next session start. Invoke it with `/scaffold` or just by describing what you want to add ("add a WP-CLI command to ...").

For other AI orchestrators (Cursor, Continue, Aider, custom agents), drop `scaffold.md` wherever your tool reads skill or command files from. The skill front-matter follows the Claude Code convention (`name:` and `description:`), but the body is plain Markdown and portable.

## Customising

The skill is **opinionated** about safety (no auto-installs, no secret values, explicit consent for cross-file edits). If your team wants different defaults, fork the file in your own repo and adjust. The engine's guarantees (in [`docs/ai-orchestration.md`](../docs/ai-orchestration.md)) do not change with the skill; only the orchestration around them does.

A common customisation: change the project introspection step to match your project's conventions if they differ from the rtCamp skeleton (different bootstrap method name, different namespace style, different anchor convention).

## What this skill never does

Built-in prohibitions (kept in sync with `docs/ai-orchestration.md` section 11):

- Never runs `composer require`, `npm install`, `gh secret set`, or any other write-side CLI without explicit user approval.
- Never reads, logs, or transmits secret values.
- Never edits branch protection, repo settings, or webhooks.
- Never commits, pushes, opens PRs, or comments on issues without explicit approval.
- Never applies cross-file wiring without showing the diff and getting consent.
- Never sends code or developer data to remote services.

If you fork the skill and remove any of these, please be loud about it in your fork's README. They exist for good reasons.
