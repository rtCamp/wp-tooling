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

Files group by **kind**, never by feature. `<Root>` = project's autoload root (e.g. `Inc`, `Acme\Blog`). Honour these unless the project shows >=3 consistent samples justifying a deviation.

| Scaffold | Source dir | Source ns | Test dir | Test ns | Module |
|---|---|---|---|---|---|
| `wp/cpt` | `includes/PostTypes/` | `<Root>\PostTypes` | `tests/PostTypes/` | `<Root>\Tests\PostTypes` | `<Root>\Modules\PostTypes` |
| `wp/taxonomy` | `includes/Taxonomies/` | `<Root>\Taxonomies` | `tests/Taxonomies/` | `<Root>\Tests\Taxonomies` | `<Root>\Modules\Taxonomies` |
| `wp/block-dynamic` | `includes/Blocks/` + `src/blocks/<slug>/` + `build/blocks/<slug>/` | `<Root>\Blocks` | `tests/Blocks/` | `<Root>\Tests\Blocks` | `<Root>\Modules\Blocks` |
| `wp/rest` | `includes/Rest/` | `<Root>\Rest` | `tests/Rest/` | `<Root>\Tests\Rest` | `<Root>\Modules\Rest` |
| `wp/shortcode` | `includes/Shortcodes/` | `<Root>\Shortcodes` | `tests/Shortcodes/` | `<Root>\Tests\Shortcodes` | `<Root>\Modules\Shortcodes` |
| `wp/admin-page` | `includes/Admin/` | `<Root>\Admin` | `tests/Admin/` | `<Root>\Tests\Admin` | `<Root>\Modules\Admin` |
| `wp/settings-page` | `includes/Settings/` | `<Root>\Settings` | `tests/Settings/` | `<Root>\Tests\Settings` | `<Root>\Modules\Settings` |
| `wp/user-role` | `includes/Roles/` | `<Root>\Roles` | `tests/Roles/` | `<Root>\Tests\Roles` | `<Root>\Modules\Roles` |
| `wp/cli` | `includes/Cli/` | `<Root>\Cli` | `tests/Cli/` | `<Root>\Tests\Cli` | `<Root>\Modules\Cli` |
| `wp/cron` | `includes/Cron/` | `<Root>\Cron` | `tests/Cron/` | `<Root>\Tests\Cron` | `<Root>\Modules\Cron` |
| `wp/registrable` | `includes/Services/` | `<Root>\Services` | `tests/Services/` | `<Root>\Tests\Services` | `<Root>\Modules\Services` |

**Modules host one kind each. No `Modules/<Feature>/...`.** A multi-kind feature (e.g. Testimonials = CPT + taxonomy + block + REST) spans the per-kind directories and wires into each kind's module.

If the project already has a per-feature module folder, flag as anti-pattern. Offer migration before adding new artifacts. Do not scaffold into it.

### 4. Derive test cases from the developer brief - BEFORE any scaffold call

Write a test-case checklist covering:

- **Happy path** - central behaviour the developer stated.
- **Edge cases** - empty/missing/boundary inputs, large input.
- **Error paths** - invalid input, missing auth, wrong capability.
- **Integration** - kind-specific:
  - `wp/cpt`: `post_type_exists()`, supports, REST exposure, attached taxonomies.
  - `wp/taxonomy`: `taxonomy_exists()`, attached object types, term assignment.
  - `wp/rest`: route appears in `rest_get_server()->get_routes()`, permission check, request/response schema, dedupe behaviour.
  - `wp/block-dynamic`: block name, `register_hooks` action, `render()` markup with `WP_Query` fixture, empty state, count cap, attribute filters.
  - `wp/cron`: `wp_next_scheduled()`, callback fires, unschedule works.
  - `wp/cli`: `WP_CLI::add_command` registered, `__invoke` behaviour, dry-run flag.

The engine's shipped test file already covers **Integration** for a plain instance of the kind (e.g. `post_type_exists()` for `wp/cpt` ships written and passing, not as a stub) — list it to confirm coverage, not to write it. Your effort in §7 goes to **Happy path / Edge cases / Error paths**: brief-specific behaviour the engine can't know.

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
| `ai.tests` | Shipped complete + passing for the generic pattern; add brief-specific methods under the TDD loop (see 7). |
| `warnings` | Print to developer. |

#### 6a. Adaptive wiring

For each `{ targetFile, anchor, snippet, description }`:

1. **Snippet** - use canonical if it matches the sampled project pattern; else translate using the sampled shape with the new class substituted. Show both. If patterns conflict or no samples exist, ask.
2. **Location** - anchor present → after it; else after the last sampled occurrence of the pattern; else best-effort in bootstrap method (say so); else skip and print as manual instruction.
3. **Consent** - show targetFile + line range + description + rendered snippet. Ask `[apply / different location / edit snippet / skip]`. Never apply without consent.
4. **Idempotent** - search first, do not re-insert.

### 7. TDD loop (mandatory for every scaffolded artifact)

Tests come before implementation. No exceptions. If the developer says "skip tests", explain the policy and decline.

For block scaffolds, surface a developer action before testing: "run `npm run build` so the editor can read the compiled block." Do not run it yourself.

| Step | Action |
|---|---|
| A | Confirm the engine's shipped tests pass as-is (they cover §4's Integration row already, complete and green — not a step you perform). Write one new test method per remaining §4 row: the brief-specific behaviour the engine couldn't know. |
| B | Run: `composer test` / `composer test:unit` (PHP), `npm run test:js` / `npx jest` (JS). Expect red only for the methods just added — the shipped tests stay green throughout; one going red means you broke the generic pattern, so stop and investigate. Confirm each red is an assertion failure, not a bootstrap/fatal error (env or wiring trouble isn't a valid TDD red). Runner errors before running → invoke the relevant `setup/*` scaffold and retry. |
| C | Implement just enough production code to flip **one** failing test green. |
| D | Re-run. Confirm that one test passes. |
| E | Loop B-D one test at a time. |
| F | Once green, refactor; re-run. |
| G | Final gates - all must pass: full PHPUnit suite, full Jest suite if JS touched, `composer lint:php`, `npm run lint:js`. |

Frameworks per kind:

| Kind | Framework |
|---|---|
| `wp/cpt`, `wp/taxonomy`, `wp/cron`, `wp/cli`, `wp/rest`, `wp/shortcode`, `wp/admin-page`, `wp/settings-page`, `wp/user-role`, `wp/registrable` | PHPUnit |
| `wp/block-dynamic` | Jest (edit.js) + PHPUnit (render method) |
| `block/interactive` | Jest + Playwright |
| `ci/*` | actionlint + yaml-parse |

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

- Never hand-write behaviour code before its test exists on disk. (The engine's scaffolded class + test ship together, already passing, for the generic pattern — you didn't author it, so it's not a violation. The rule governs the brief-specific behaviour you add: test first, confirm red, then extend. Consented §6a wiring is likewise sanctioned, not authored behaviour.)
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

| Code | Response |
|---|---|
| `ENOSCAFFOLD` | Surface `available` list, suggest closest, ask. |
| `EMISSINGINPUT` | Read `missingDetails`, run §2 discovery, retry with resolved values. |
| `EBADSCAFFOLD` | Invalid manifest. Surface verbatim, do not retry. For an `origin: "remote"` scaffold this means the fetched manifest at its pinned ref is broken — surface it; do not try to repair another repo's scaffold. |
| `EWRITEFAIL` | Surface path + errno. Do not retry. |
| `ERENDERFAIL` | Scaffold author bug. Surface. |
| `EFETCHFAIL` | Network/HTTP failure fetching an `origin: "remote"` scaffold's manifest or a template. Surface `url` + `statusCode`. If the payload sets `rateLimited`, tell the developer to set `WP_TOOLING_GITHUB_TOKEN` and stop. A timeout is transient — one retry is reasonable; a 404 means the source pin (`sources.json` repo/ref/path) or the owning repo's index is wrong — surface, do not retry. Never hand-write the artifact to work around a failed fetch (the engine owns it). |
| Unknown | Surface, exit non-zero, do not crash. |

## CI/CD variant

- `ai.wiring` usually empty.
- `developer.secrets` usually populated. For multi-workflow setups, emit one consolidated `gh secret set` checklist at the end (dedupe).
- `ai.tests` framework is `actionlint` or `yaml-parse`. Validate; do not fill the YAML.

## Reference

- Engine contract: `node_modules/@rtcamp/wp-tooling/docs/ai-orchestration.md`
- Examples: `node_modules/@rtcamp/wp-tooling/docs/examples.md`
- Engine source: `node_modules/@rtcamp/wp-tooling/src/scaffolds/`
- Test templates: `scaffolds/wp/<kind>/templates/test.php.mustache`
