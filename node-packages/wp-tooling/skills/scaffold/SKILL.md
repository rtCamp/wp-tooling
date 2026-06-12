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

### 0. Plan and announce - before any other work

Before discovery, scaffolding, or coding, write a TODO list covering every step you intend to run for this task and show it to the developer. Use the host's task-tracking surface (`TodoWrite` in Claude Code; the host equivalent elsewhere).

Minimum entries:

1. Introspect project (§2).
2. Derive test-case checklist (§4) and confirm with developer.
3. Scaffold call(s) - one entry per kind for multi-kind features.
4. Apply wiring (§6a) - one entry per `ai.wiring` snippet, with consent.
5. Expand tests, run red (§7 A-B).
6. Implement to green (§7 C-E), one test at a time.
7. Refactor + final gates (§7 F-G).
8. Report (§9).

Update the list in real time. Mark each entry `in_progress` before starting it and `completed` the moment it is done. Exactly one entry `in_progress` at any time. Add new entries when the work reveals them (e.g. a missing kind-module, a stuck-loop escalation).

This makes progress legible to the developer and gives them a stable surface to interrupt or re-prioritise.

### 1. Discover

```bash
npx wp-tooling list --json
```

Result: `{ scaffolds: [{ id, slug, category, kind, origin, counts }, ...] }`. Pick one `category/slug`. If ambiguous, ask the developer with candidates. Never guess. Entries with `origin: "remote"` live in another repo: their manifest is fetched on the first `add`, so `counts` is `null` here and the kind is always `template`. That first `add` does network I/O and can fail with `EFETCHFAIL` (see Engine errors) — treat a remote scaffold exactly like a local one once it resolves; the only difference is the fetch.

### 2. Introspect once per session (cache result)

Read, in order:

- `composer.json` → `autoload.psr-4` (root namespace + base path). `autoload-dev.psr-4` for tests namespace; if missing, surface a developer action: add `"<Root>\\Tests\\": "tests/"`.
- `package.json` → scripts. For block scaffolds, parse `build` for `--output-path=<DIR>` and pass as `--build_dir`. Default `build/blocks`.
- Main plugin/theme file → bootstrap class + register method.
- 2-3 existing implementations of the same kind: registration pattern, class-name suffix, sub-namespace.
- Block scaffolds: sample one `block.json` for vendor prefix and source dir.
- CI scaffolds: sample one `.github/workflows/*.yml` for filename and trigger style.

Anchors (`// scaffold:<kind>:classes`) are hints, not ground truth. Sampled patterns win.

Confirm findings with the developer in one short message. Proceed on confirmation.

### 3. Canonical layout

Resolve the target source dir, namespace, test dir, test namespace, and module for the chosen kind before any scaffold call — including the modules-host-one-kind rule and the per-feature-folder anti-pattern check.

Read:
- `references/canonical-layout.md`

### 4. Derive test cases from the developer brief - BEFORE any scaffold call

Write a test-case checklist covering:

- **Happy path** - central behaviour the developer stated.
- **Edge cases** - empty/missing/boundary inputs, large input.
- **Error paths** - invalid input, missing auth, wrong capability.
- **Integration** - kind-specific assertions per kind.

For the kind-specific integration assertions, read:
- `references/test-checklist.md`

Show the checklist to the developer. Ask: confirm, add, remove? Resolve before scaffolding. This is the cheapest place to catch a misread requirement.

### 5. Apply conventions, invoke the engine

Always invoke the engine for any kind it covers. Hand-writing is not a substitute.

Apply project-sampled conventions to inputs (class suffix, sub-namespace, vendor prefix, build dir).

```bash
npx wp-tooling add <category>/<slug> --non-interactive --json \
    --<input>=<value> ...
```

Dry-run preview: append `--dry-run`. Never use the interactive wizard.

**Multi-kind feature run order:**

1. `wp/module` for any missing kind-module (e.g. `--name=PostTypes --kind=cpt`).
2. Artifacts in dependency order: CPT before any taxonomy attaching to it; CPT before any block/REST controller querying it.
3. Re-read `ai.wiring` after each call.

Result shape: `{ scaffold, engine, developer, ai, warnings }`.

### 6. Process the result

| Block | Action |
|---|---|
| `engine.wrote` / `engine.skipped` | Already on disk. Report. |
| `developer.install.composer` / `developer.install.npm` | Print as copy-paste command. **Never run `composer require` / `npm install`.** |
| `developer.secrets` | Print as `gh secret set` checklist. **Never read/write/log/transmit values.** |
| `ai.wiring` | Adaptive wiring with consent (see 6a). |
| `ai.tests` | Mandatory expansion under TDD loop (see 7). |
| `warnings` | Print to developer. |

#### 6a. Adaptive wiring

Follow the four-step procedure (snippet, location, consent, idempotency) for every `ai.wiring` entry.

Read and apply:
- `references/adaptive-wiring.md`

### 7. TDD loop (mandatory for every scaffolded artifact)

Tests come before implementation. No exceptions. If the developer says "skip tests", explain the policy and decline.

For block scaffolds, surface a developer action before testing: "run `npm run build` so the editor can read the compiled block." Do not run it yourself.

For the A-G step table and the test framework per kind — expand the stub, run red, then implement one test at a time to green — read and apply:
- `references/tdd-loop.md`

### 8. Escalate when stuck - do not guess

Stop and report findings to the developer when any of the following holds. Wait for response before continuing.

- 3 consecutive iterations of step C-D on the same test without progress.
- A test result contradicts your model of the code (likely hallucination - re-read the file on disk before guessing again).
- Sampled project patterns conflict and you cannot resolve which to follow.
- A `ai.wiring` snippet's anchor and project pattern both differ from canonical.
- Developer requirements remain ambiguous after one round of clarification.

Escalation report format: **what you tried, what you observed, what's blocking, 1-3 specific resolution options.** Do not keep iterating in silence.

### 9. Final report

- Files written, grouped by top-level directory.
- Wiring applied: file, line, pattern used.
- Tests authored and pass count per file.
- Lint result.
- Outstanding developer actions: composer / npm installs, `npm run build` (blocks), secrets to set, branch-protection note (CI).

## Hard rules - never violate

- Never write production code before its test exists on disk.
- Never hand-write an artifact the engine can scaffold.
- Never group multiple kinds under a per-feature folder (`Modules/<Feature>/...`).
- Never declare an artifact done without its test file passing.
- Never lower assertion strength to make a test pass (`assertTrue(true)`, widened types).
- Never delete or skip a test the developer would expect to pass.
- Never leave `markTestIncomplete`, `markTestSkipped`, or `@todo` in committed state.
- Never run `composer require`, `npm install`, `npm run build`, `gh secret set`, `gh repo edit`, or any write-side CLI without explicit consent.
- Never read, write, log, or transmit secret values.
- Never edit branch protection, repo settings, webhooks, or any GitHub admin surface.
- Never commit, push, open PRs, or comment on issues without explicit consent.
- Never apply wiring without showing the diff and getting consent.
- Never invent a third registration pattern when canonical and sampled disagree - ask.
- Never restore scaffold anchor comments without explicit consent.
- Never modify `composer.json`, `package.json`, or any lockfile beyond what the engine wrote.

**Detect-and-correct:** if you notice an earlier artifact in the wrong directory or missing its test file, stop new work, migrate to the canonical layout, add the missing tests, then resume.

## Engine errors

On any non-zero exit from the engine, read:
- `references/engine-errors.md` — the response to each error code (`ENOSCAFFOLD`, `EMISSINGINPUT`, `EBADSCAFFOLD`, `EWRITEFAIL`, `ERENDERFAIL`, `EFETCHFAIL`).

## CI/CD variant

- `ai.wiring` usually empty.
- `developer.secrets` usually populated. For multi-workflow setups, emit one consolidated `gh secret set` checklist at the end (dedupe).
- `ai.tests` framework is `actionlint` or `yaml-parse`. Validate; do not fill the YAML.

## Reference

- Engine contract: `node_modules/@rtcamp/wp-tooling/docs/ai-orchestration.md`
- Examples: `node_modules/@rtcamp/wp-tooling/docs/examples.md`
- Engine source: `node_modules/@rtcamp/wp-tooling/src/scaffolds/`
- Test templates: `scaffolds/wp/<kind>/templates/test.php.mustache`
