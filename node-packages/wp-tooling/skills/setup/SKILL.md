---
name: setup
description: Bootstrap a WordPress plugin or theme from a natural-language description. Detects project type, applies tooling (EditorConfig, PSR-4, PHPCS, PHPStan, ESLint, Stylelint, PHPUnit, Jest, pa11y), and chains feature scaffolds (CLI commands, blocks, REST, etc.) in one session. Asks for clarification whenever intent is ambiguous — never assumes.
---

# setup

You are configuring a WordPress plugin or theme from a natural-language request. Your job is to understand exactly what the developer wants, turn that into a sequenced plan of scaffold invocations, confirm the plan, and execute it. You never assume anything you cannot verify by reading the project directory.

This skill is meant to be **copied verbatim** into the user's repo at `.claude/commands/setup.md` or `.claude/skills/setup.md`. It assumes `@rtcamp/wp-tooling` is on the `PATH` (via `npx`) or installed as a project dev dependency.

## When to use this skill

Use when the developer asks to:

- "Set up my plugin/theme" or "scaffold this as a [description]."
- Bootstrap a new empty project directory.
- Add rtCamp standard tooling to an existing project.
- Create a feature scaffold (CLI command, block, REST controller, etc.) as part of a setup session.

Do not use this skill for: isolated bug fixes, one-off file edits, or anything outside the `@rtcamp/wp-tooling` scaffold catalogue.

## Workflow

### 0. Parse the request

Read the developer's message carefully. Extract:

- **Project type**: plugin vs theme.
- **Standards**: VIP vs non-VIP vs WordPress.org plugin vs plain WordPress.
- **Languages needed**: PHP, JS (blocks, scripts), CSS/SCSS.
- **Features wanted**: CLI command, REST endpoint, cron job, block, post type, integrations, etc.
- **Tests wanted**: PHPUnit (PHP unit/integration), Jest (JS), pa11y (a11y), or none.
- **Any specific names, namespaces, or requirements** mentioned by the developer.

If the request is vague or any of the above is unclear, **stop and ask before reading the project directory**. Do not try to infer project type from the directory if the developer's message already says it. Do not proceed with gaps.

Example clarifying questions (ask all at once, never drip):

```
Before I start, I need a few details:

1. Is this a WordPress plugin or a theme?
2. Will this be deployed on WordPress VIP? (Determines the PHPCS standard.)
3. What is the PHP root namespace you want to use? (e.g. Acme\\ImageOptimizer)
4. What directory holds the PHP source? (e.g. includes/ or src/)
5. Do you want tests set up? If so: PHPUnit for PHP, Jest for JS, pa11y for a11y — any or all?
6. You mentioned a CLI command — what should it do? (I need a command name or slug.)
```

### 1. Detect what already exists

After the request is clear, read the project directory to avoid duplicating work.

Read and run:
- `references/detection-commands.md` — detection commands for project type, VIP indicators, languages present, PSR-4 autoload, existing tooling configs, existing namespace.

If detection contradicts what the developer said, flag it and ask. Never silently override the developer's stated intent with what you find on disk.

### 2. Build the scaffold plan

Construct the plan in two phases: **project setup** and **feature scaffolds**.

#### Phase A: Project setup

Read:
- `references/phase-a-setup.md` — the condition → scaffold → skip-if selection table, the PHPCS standard reference, and the test scaffolds reference.

#### Phase B: Feature scaffolds

Map each feature the developer mentioned to one or more scaffold IDs from the catalogue.

Read:
- `references/phase-b-features.md` — the feature → scaffold ID mapping.

Run `npx wp-tooling list --json` to see exactly what is available. If a feature the developer wants has no matching scaffold, note it explicitly as a manual task in the final report.

For each feature scaffold, you need the same project-convention information as the `scaffold` skill requires (namespace, base path, class suffix, registration pattern). Collect this once from the project and cache it.

### 3. Confirm the full plan before doing anything

Show the complete two-phase plan. Be specific: include the scaffold ID, what file(s) it writes, and any inputs it will use.

```
Here is what I will do. Please confirm or adjust before I start.

Phase A — Project setup:
  1. setup/editorconfig    → .editorconfig
  2. setup/psr4            → wiring in composer.json  (namespace: Acme\ImageOptimizer, path: includes/)
  3. lint/phpcs/vip        → phpcs.xml.dist           (WordPress-VIP-Minimum + WordPress-Docs)
  4. lint/phpstan          → phpstan.neon.dist         (extends rtCamp wp-phpstan baseline)
  5. lint/eslint           → eslint.config.js
  6. setup/phpunit         → phpunit.xml.dist, tests/bootstrap.php

Phase B — Feature scaffolds:
  7. wp/cli                → includes/Cli/OptimizeImagesCommand.php
                             (namespace: Acme\ImageOptimizer\Cli, class suffix: Command,
                              registers via $this->boot(...) in includes/Plugin.php)

Skipped (already present): none.

Not in catalogue (manual tasks): none.

Confirm? Or adjust (e.g. "remove phpunit", "use full phpcs instead of vip", "add jest")?
```

Do not start running scaffolds until the developer confirms. If they adjust, update the plan and confirm once more before starting.

### 4. Execute Phase A

Run each setup scaffold in order. Use `--non-interactive --json --cwd .`.

Read:
- `references/phase-a-setup.md` — the exact command per scaffold.

Process each result before running the next:

- Report files written and skipped.
- Apply `setup/psr4` wiring to `composer.json` with explicit consent. Read and apply: `references/psr4-wiring.md` (also covers the create-if-missing `composer.json` flow and feature-scaffold wiring).
- Accumulate `developer.install.*` and `developer.scripts.*` across all scaffolds.

### 5. Execute Phase B

For each feature scaffold, follow the full workflow from the companion `scaffold` skill — installed as a sibling of this skill. Before the first feature scaffold, read:

- `../scaffold/SKILL.md`
- `../scaffold/references/tdd-loop.md`
- `../scaffold/references/test-checklist.md`

— introspect conventions, apply naming, invoke the engine, adaptive wiring, **expand test stubs into a real suite, then drive implementation from those tests** (red → green → refactor).

Do not batch feature scaffolds. Run one at a time, apply its wiring, complete the TDD loop (`../scaffold/references/tdd-loop.md`), then move to the next.

Read:
- `references/phase-b-features.md` — the per-feature command shape (conventions to pass, `wp/cli` example).

The engine emits `ai.wiring` (where to register the command) and a thin test stub at `tests/<Kind>/<Class>Test.php`. Show the wiring snippet, get consent, apply. Then turn the stub into a real test suite (happy path, dry-run flag, edge cases, error handling) and implement test-by-test until the suite is green. Never leave `markTestIncomplete` in the final state.

**Phase B feature scaffolds require the matching test framework from Phase A.** If Phase A skipped `setup/phpunit` because the developer did not ask for tests, surface this before running Phase B feature scaffolds:

```
You asked for a CLI command, but Phase A skipped setup/phpunit.
The wp/cli scaffold ships a PHPUnit stub I cannot run without it.

Options:
  1. Add setup/phpunit now (recommended — I drive feature development from tests).
  2. Proceed without tests (stub will be written but not executed; I will note this as a manual follow-up).

Which?
```

Default to (1). Only proceed without tests if the developer explicitly chooses (2).

### 6. Consolidated final report

Read:
- `references/report-template.md` — the full report template and its formatting rules (dedupe packages, sort alphabetically, pinned vs range versions).

## Rules: never assume, always ask

Before running any scaffold, every required input must be confirmed by the developer or verified from the project files. The following facts require explicit confirmation or verification — never infer them silently:

- Plugin vs theme.
- VIP vs non-VIP.
- PHP root namespace and base directory.
- CLI command slug and class name.
- Block slug and vendor prefix.
- REST route and controller name.
- pa11y base URL.

If the developer's request is clear enough that a fact can be read unambiguously from the project (e.g. namespace from `composer.json` autoload, VIP from existing `phpcs.xml.dist`), no need to ask — cite the source in the confirmation plan instead.

## Hard prohibitions

You **must never**:

- Run `composer require`, `npm install`, `composer dump-autoload`, or any package manager command without explicit user approval.
- Edit `composer.json` scripts or `package.json` scripts — show them, let the developer apply.
- Apply wiring to any file without showing the diff and receiving consent.
- Apply more scaffolds than the confirmed plan.
- Silently skip a scaffold; always report skips with a reason.
- Set up CI/CD — that requires a separate `scaffold` skill invocation targeting `ci/` scaffolds.
- Commit, push, or open PRs without explicit approval.

## Error handling

For `ENOSCAFFOLD`: The requested scaffold id does not exist. Surface the `available` list, show the closest match, and ask the developer what to do.

For `EMISSINGINPUT`: Read `missingDetails`, collect the values from the project or ask the developer, and retry with the resolved values.

For `EWRITEFAIL`: Surface the path and OS error. Ask whether to retry (e.g. after the developer fixes permissions) or skip the file.

For `EBADSCAFFOLD`: Scaffold author bug. Surface verbatim. Do not retry.

## Reference

- Worked conversation examples: `node_modules/@rtcamp/wp-tooling/docs/examples.md` (greenfield plugin, VIP image-optimizer setup, all phases in one prompt).
- One-off scaffold additions are handled by the companion `scaffold` skill.
