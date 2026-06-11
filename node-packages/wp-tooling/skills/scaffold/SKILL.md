---
name: scaffold
description: Add a scaffold (PHP class, block, CI workflow) to the current project using @rtcamp/wp-tooling. TDD-first - derive test cases from the developer brief, scaffold via the engine, write tests, then implement to green under a red-green-refactor loop. Never runs package-manager commands or writes secret values; surfaces them as developer actions.
---

# scaffold

Drive `@rtcamp/wp-tooling`. Map the developer's request to a scaffold, derive test cases first, invoke the engine, expand tests, implement to green, report.

## Use for

CPT, taxonomy, REST controller, dynamic block, shortcode, cron, CLI command, admin/settings page, user role, plain Registrable service, framework module, CI/CD workflow.

## Do not use for

Refactors, bug fixes, hand-written features, anything no scaffold covers.

## Workflow

### 0. Plan and announce — before any other work

Write a TODO list covering every step below and show it to the developer (`TodoWrite` in Claude Code). Mark each entry `in_progress` before starting it and `completed` the moment it is done. Add entries as the work reveals them. Exactly one entry `in_progress` at any time.

Break the TDD work (§7) into its own entries — *expand tests → red*, *implement to green*, *refactor + final gates* — rather than one "TDD loop" item. The point is to make the red-green-refactor progression visible to the developer as it happens; a single opaque entry hides whether tests were written before the implementation.

### 1. Discover

```bash
npx wp-tooling list --json
```

Result: `{ scaffolds: [{ id, slug, category, kind, origin, counts }, ...] }`. Pick one `category/slug`. If ambiguous, ask the developer. Never guess. Entries with `origin: "remote"` live in another repo; their manifest is fetched on first `add` and can fail with `EFETCHFAIL` — treat exactly like local once resolved.

### 2. Introspect once per session (cache result)

Read:
- `composer.json` → `autoload.psr-4` (root namespace + base path). `autoload-dev.psr-4` for tests namespace; if missing, surface: add `"<Root>\\Tests\\": "tests/"`.
- `package.json` → scripts. For block scaffolds, parse `build` for `--output-path=<DIR>`.
- Main plugin/theme file → bootstrap class + register method.
- 2-3 existing implementations of the same kind: registration pattern, class-name suffix, sub-namespace.
- Block scaffolds: sample one `block.json` for vendor prefix and source dir.
- CI scaffolds: sample one `.github/workflows/*.yml` for filename and trigger style.

Anchors (`// scaffold:<kind>:classes`) are hints, not ground truth. Sampled patterns win.

Confirm findings with the developer in one short message. Proceed on confirmation.

### 3. Confirm canonical layout

Read `references/canonical-layout.md` to resolve the target directory, namespace, test dir, and module for the chosen kind.

If the project already has a per-feature module folder, flag as anti-pattern and offer migration before adding new artifacts.

### 4. Derive test cases — BEFORE any scaffold call

Write a test-case checklist covering happy path, edge cases, and error paths.

Read `references/test-checklist.md` for the kind-specific integration assertions to include.

Show the checklist to the developer. Ask: confirm, add, remove? Resolve before scaffolding. This is the cheapest place to catch a misread requirement.

### 5. Apply conventions, invoke the engine

Always invoke the engine — never hand-write an artifact it covers. Apply project-sampled conventions.

```bash
npx wp-tooling add <category>/<slug> --non-interactive --json \
    --<input>=<value> ...
```

Dry-run preview: append `--dry-run`. Never use the interactive wizard.

**Multi-kind run order:** `wp/module` first for any missing kind-module, then artifacts in dependency order (CPT before taxonomy, CPT before block/REST).

Result shape: `{ scaffold, engine, developer, ai, warnings }`.

### 6. Process the result

| Block | Action |
|---|---|
| `engine.wrote` / `engine.skipped` | Already on disk. Report. |
| `developer.install.composer` / `developer.install.npm` | Print as copy-paste command. **Never run.** |
| `developer.secrets` | Print as `gh secret set` checklist. **Never read/write/log/transmit values.** |
| `ai.wiring` | Adaptive wiring with consent. Read `references/adaptive-wiring.md` for snippet reconciliation, location resolution, the consent prompt, and idempotency. |
| `ai.tests` | Expand under TDD loop (§7). |
| `warnings` | Print to developer. |

### 7. TDD loop (mandatory)

Tests come before implementation. If the developer says "skip tests", explain the policy and decline.

Read `references/tdd-loop.md` for the step-by-step table and per-kind test framework.

Block scaffolds: surface "run `npm run build`" as a developer action before testing.

### 8. Escalate when stuck

Stop and report when any of these holds. Wait for a response before continuing.

- 3 consecutive iterations on the same test without progress.
- A test result contradicts your model of the code (re-read the file on disk before guessing again).
- Sampled patterns conflict and you cannot resolve which to follow.
- A `ai.wiring` snippet's anchor and project pattern both differ from canonical.
- Requirements remain ambiguous after one round of clarification.

Report format: **what you tried, what you observed, what's blocking, 1-3 resolution options.**

### 9. Final report

- Files written, grouped by top-level directory.
- Wiring applied: file, line, pattern used.
- Tests authored and pass count per file.
- Lint result.
- Outstanding developer actions: composer / npm installs, `npm run build` (blocks), secrets to set.

For engine errors: read `references/engine-errors.md`.

## Hard rules — never violate

- Never write production code before its test exists on disk.
- Never hand-write an artifact the engine can scaffold.
- Never group multiple kinds under a per-feature folder (`Modules/<Feature>/...`).
- Never declare an artifact done without its test file passing.
- Never lower assertion strength to make a test pass (`assertTrue(true)`, widened types).
- Never delete or skip a test the developer would expect to pass.
- Never leave `markTestIncomplete`, `markTestSkipped`, or `@todo` in committed state.
- Never run `composer require`, `npm install`, `npm run build`, `gh secret set`, or any write-side CLI without explicit consent.
- Never read, write, log, or transmit secret values.
- Never edit branch protection, repo settings, webhooks, or any GitHub admin surface.
- Never commit, push, or open PRs without explicit consent.
- Never apply wiring without showing the diff and getting consent.
- Never invent a third registration pattern when canonical and sampled disagree — ask.
- Never restore scaffold anchor comments without explicit consent.
- Never modify `composer.json`, `package.json`, or any lockfile beyond what the engine wrote.

**Detect-and-correct:** if an earlier artifact is in the wrong directory or missing its test file, stop new work, migrate to the canonical layout, add the missing tests, then resume.
