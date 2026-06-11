---
name: setup
description: Bootstrap a WordPress plugin or theme from a natural-language description. Detects project type, applies tooling (EditorConfig, PSR-4, PHPCS, PHPStan, ESLint, Stylelint, PHPUnit, Jest, pa11y), and chains feature scaffolds (CLI commands, blocks, REST, etc.) in one session. Asks for clarification whenever intent is ambiguous — never assumes.
---

# setup

Configure a WordPress plugin or theme from a natural-language request. Understand exactly what the developer wants, turn it into a sequenced plan of scaffold invocations, confirm the plan, and execute it. Never assume anything you cannot verify by reading the project directory.

This skill is meant to be **copied verbatim** into the user's repo at `.claude/commands/setup.md` or `.claude/skills/setup.md`. It assumes `@rtcamp/wp-tooling` is on the `PATH` (via `npx`) or installed as a project dev dependency.

## When to use this skill

- "Set up my plugin/theme" or "scaffold this as a [description]."
- Bootstrap a new empty project directory.
- Add rtCamp standard tooling to an existing project.
- Create a feature scaffold as part of a setup session.

Do not use for: isolated bug fixes, one-off file edits, or anything outside the `@rtcamp/wp-tooling` scaffold catalogue.

## Workflow

### 0. Parse the request

Extract: project type (plugin vs theme), standards (VIP / non-VIP / WordPress.org / plain), languages (PHP / JS / CSS), features wanted, tests wanted, names and namespaces.

If the request is vague, **stop and ask before reading the project directory**. Ask all clarifying questions at once — never drip:

```
Before I start, I need a few details:

1. Is this a WordPress plugin or a theme?
2. Will this be deployed on WordPress VIP?
3. What PHP root namespace? (e.g. Acme\\Plugin)
4. What directory holds the PHP source? (e.g. includes/ or src/)
5. Do you want tests? PHPUnit / Jest / pa11y — any or all?
6. [For each feature] What should it do?
```

### 1. Detect what already exists

Read `references/detection-commands.md` for the shell commands to run.

Flag any contradiction between what the developer described and what's on disk. Never silently override stated intent.

### 2. Build the scaffold plan

Two phases: **project setup** (Phase A) and **feature scaffolds** (Phase B).

Read `references/phase-a-setup.md` for the Phase A scaffold selection table.
Read `references/phase-b-features.md` for the Phase B feature-to-scaffold mapping.

Run `npx wp-tooling list --json` to confirm available scaffold IDs. Note explicitly any feature with no matching scaffold — it becomes a manual task in the final report.

### 3. Confirm the full plan before doing anything

Show the complete two-phase plan: scaffold ID, file(s) written, inputs used.

```
Phase A — Project setup:
  1. setup/editorconfig    → .editorconfig
  2. setup/psr4            → composer.json  (namespace: Acme\Plugin, path: includes/)
  3. lint/phpcs/full       → phpcs.xml.dist
  ...

Phase B — Feature scaffolds:
  N. wp/cli                → includes/Cli/CommandName.php

Skipped (already present): ...
Not in catalogue (manual tasks): ...

Confirm? Or adjust?
```

Do not start scaffolding until the developer confirms.

### 4. Execute Phase A

Read `references/phase-a-setup.md` for the exact `npx wp-tooling add` commands per scaffold.

Process each result before running the next. Accumulate `developer.install.*` and `developer.scripts.*` across all scaffolds.

For `setup/psr4` wiring: read `references/psr4-wiring.md` and follow the consent flow exactly.

### 5. Execute Phase B

For each feature scaffold, follow the full workflow from the `scaffold` skill: introspect conventions, invoke engine, apply wiring with consent, expand test stubs, implement to green, refactor.

Do not batch feature scaffolds — run one at a time, complete its TDD loop, then move to the next.

If Phase A skipped a test framework the developer now needs:
```
You asked for a CLI command, but Phase A skipped setup/phpunit.
Options:
  1. Add setup/phpunit now (recommended).
  2. Proceed without tests (stub written but not run; noted as manual follow-up).
```
Default to (1). Only proceed without tests on explicit choice of (2).

### 6. Consolidated final report

Read `references/report-template.md` for the full report structure and formatting rules.

## Rules: never assume, always ask

These facts require explicit confirmation or project-file verification — never infer silently:

- Plugin vs theme.
- VIP vs non-VIP.
- PHP root namespace and base directory.
- CLI command slug and class name.
- Block slug and vendor prefix.
- REST route and controller name.
- pa11y base URL.

If readable unambiguously from the project, cite the source in the confirmation plan instead of asking.

## Hard prohibitions

- Never run `composer require`, `npm install`, `composer dump-autoload`, or any package manager command without explicit approval.
- Never edit `composer.json` scripts or `package.json` scripts — show them, let the developer apply.
- Never apply wiring without showing the diff and getting consent.
- Never apply more scaffolds than the confirmed plan.
- Never silently skip a scaffold — always report skips with a reason.
- Never set up CI/CD during `setup` — that requires a separate `scaffold` invocation targeting `ci/` scaffolds.
- Never commit, push, or open PRs without explicit approval.

## Error handling

| Code | Response |
|---|---|
| `ENOSCAFFOLD` | Surface `available` list, show closest match, ask. |
| `EMISSINGINPUT` | Read `missingDetails`, collect values from project or ask, retry. |
| `EWRITEFAIL` | Surface path + OS error. Ask to retry or skip. |
| `EBADSCAFFOLD` | Scaffold author bug. Surface verbatim. Do not retry. |

## Reference

- One-off scaffold additions after setup: use the companion `scaffold` skill.
- Worked examples: `node_modules/@rtcamp/wp-tooling/docs/examples.md`
