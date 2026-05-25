---
name: scaffold
description: Add a scaffold (PHP class, block, CI workflow, utility wrapper) to the current project using @rtcamp/wp-tooling. Adapts canonical templates to the project's existing namespace, base path, bootstrap method, naming conventions, and CI workflow style. Never writes secret values or runs package-manager commands; surfaces them as developer actions.
---

# scaffold

You are operating the rtCamp scaffold engine (`@rtcamp/wp-tooling`) on the user's behalf. The engine ships templates for PHP code, Gutenberg blocks, CI/CD workflows, and `source: "package"` wrappers around `rtcamp/wp-php-toolkit` utilities. Your job is to map the user's natural-language request to a scaffold, supply project-correct inputs, apply the resulting wiring (with permission), generate tests, and produce a brief report.

This skill is meant to be **copied verbatim** into the user's repo at `.claude/commands/scaffold.md` or `.claude/skills/scaffold.md`. It assumes `@rtcamp/wp-tooling` is on the `PATH` (via `npx`) or installed as a project dev dependency.

## When to use this skill

Use this skill when the user asks to **add, scaffold, generate, or create** any of:

- WP-CLI commands, REST controllers, cron jobs, custom post types, taxonomies, admin pages, modules, integrations.
- Gutenberg blocks (static, dynamic, interactivity).
- CI/CD workflows (full pipeline, release deploys to GitHub / WP.org / S3, version monitor).
- `wp-php-toolkit` utility wrappers (Cache, Transients, Logger, Timer, Feature_Selector).

Don't use this skill for: arbitrary file creation, refactors, bug fixes, or hand-written feature work. Don't use it for anything the engine has no scaffold for.

## Workflow

### 1. Discover what's available

Always start with `list`:

```bash
npx @rtcamp/wp-tooling list --json
```

The result is `{ "scaffolds": [{ id, slug, category, name, description, kind, origin, counts: { inputs, wiring, tests, secrets } }, ...] }`.

Match the user's request to one scaffold id (`category/slug`). If multiple candidates match or none match well, **ask the user to pick** with the candidates as suggestions. Never silently guess.

### 2. Introspect the project once per session

Before invoking `add`, learn what the project actually looks like. Read these in order; cache the result for the rest of the session.

- **`composer.json`**: extract `autoload.psr-4` for the namespace prefix and PHP base path. Example: `"Acme\\Blog\\": "src/"` means namespace `Acme\Blog`, base `src`.
- **`package.json`**: extract `name`, `scripts`, and any `@wordpress/scripts` config to learn the JS build pipeline.
- **The main plugin/theme file** (header `Plugin Name:` or `Theme Name:`): find the first `new X(...)` or `X::get_instance()` and follow it to the bootstrap class. Note the class file path and the method used to register subsystems (`register()`, `setup()`, `boot()`, etc.).
- **Two or three existing implementations of the same scaffold type** in the project. If adding a CLI command, find existing CLI classes and note:
  - The **registration pattern** (the snippet the project uses to wire them).
  - The **class-name suffix** (e.g., `Command`, `Controller`, `Service`).
  - The **namespace sub-structure** (e.g., `Acme\Blog\CLI\Commands\X` vs `Acme\Blog\CLI\X`).
- **For block scaffolds**: sample one existing `block.json` for the vendor-prefix (`acme/foo` vs `foo`) and source directory (`src/blocks/` vs `assets/blocks/`).
- **For CI scaffolds**: sample one existing file under `.github/workflows/` for the filename convention (`wp-ci.yml` vs `ci.yml`) and trigger style.

**Treat scaffold anchor comments (`// scaffold:cli-commands` etc.) as a supplementary hint, not a primary signal.** Anchors are routinely removed by cleanup; pattern sampling is the ground truth.

Confirm the discovered facts with the user **once**, e.g.:

```
I found:
- namespace Acme\Blog, base path src/
- bootstrap src/Plugin/Main.php::register()
- CLI commands in src/CLI/, classes end with "Command" (e.g. ImportCommand, PurgeCommand)
- registration pattern: $this->commandRegistry->add(new \Acme\Blog\CLI\X())
- scaffold anchor // scaffold:cli-commands not found; will insert after the last sampled commandRegistry->add() call
Confirm or correct?
```

Cache the response. Do not persist to disk.

### 3. Apply naming conventions before calling the engine

The engine accepts whatever inputs you supply. **You** are responsible for applying project-detected conventions:

- Class suffix: if the project uses `Command` (sampled in step 2), compute `--class=QmExportCommand` rather than the canonical `QmExport`.
- Namespace sub-structure: pass the full sub-namespace as `--namespace=Acme\Blog\CLI\Commands` if that's the project pattern.
- Block slug: pass `--vendor=acme` if the project uses vendor-prefixed slugs.

PSR-4 is assumed for PHP; once you supply the right `class` value, filenames follow automatically.

### 4. Invoke the engine

Always use `--non-interactive --json`. Never use the interactive Wizard from inside a skill (the user is talking to you, not the CLI).

```bash
npx @rtcamp/wp-tooling add <category>/<slug> \
    --non-interactive --json \
    --<input>=<value> ...
```

For a dry preview before writing files:

```bash
npx @rtcamp/wp-tooling add <category>/<slug> \
    --non-interactive --json --dry-run \
    --<input>=<value> ...
```

The result is a four-block JSON object: `{ scaffold, engine, developer, ai, warnings }`. See §5 for what to do with each block.

### 5. Process the result

The four blocks split responsibility:

#### `engine.wrote` and `engine.skipped`

Already on disk. Just report.

#### `developer.install.composer` and `developer.install.npm`

Maps of `{ package: version }` the user must install themselves. **Never run `composer require` or `npm install`.** Surface as a copy-pasteable command:

```
This scaffold needs a Composer dependency. Run yourself:

    composer require rtcamp/wp-php-toolkit:^1.0
```

#### `developer.secrets`

Array of `{ key, scope, description, required }`. **Never read, write, log, or transmit secret values.** Surface as a `gh secret set` checklist:

```
This scaffold needs two secrets in this repo. Run these yourself (I never set secrets):

    gh secret set WPORG_USERNAME --repo <owner/repo>
    # WordPress.org SVN username with commit access to the plugin slug.

    gh secret set WPORG_PASSWORD --repo <owner/repo>
    # Password matching WPORG_USERNAME. Treat as write-only.
```

#### `ai.wiring`

Array of `{ targetFile, anchor, snippet, description }`. For each entry, run **adaptive wiring**:

**A. Decide what snippet to write.**

- If the canonical `snippet` matches the project's sampled registration pattern (step 2), use it unchanged.
- If the project uses a different pattern, translate: take the sampled shape (e.g., `$this->commandRegistry->add(new \Ns\X())`) and substitute the new class. Present both versions side by side.
- If the patterns conflict or no examples exist, ask the user.

**B. Decide where to insert.** Fall through in order:

1. If the `anchor` comment is present in `targetFile`, insert immediately after it.
2. If not, insert immediately after the last sampled occurrence of the same registration pattern.
3. If no pattern exists either, place at a sensible spot in the bootstrap method (typically just before the closing brace) and tell the user this is best-effort.
4. If no bootstrap method exists, skip wiring; print the snippet as a manual instruction.

**C. Get explicit permission.** Show:

- The `targetFile` and the line range that would be affected.
- The `description` from the manifest.
- The rendered snippet (canonical or translated).

Ask: `Apply this change to <targetFile>? [apply / different location / edit snippet / skip wiring]`. Never apply wiring without this exchange.

**D. Apply idempotently.** Search for the snippet first; do not re-insert if it's already there.

#### `ai.tests`

Array of `{ path, framework, command? }`. The engine writes only a thin starter stub — usually one `markTestIncomplete` placeholder per scenario the scaffold could not anticipate. **You are responsible for expanding this into a real test suite and driving development from those tests.** See [Test-driven implementation loop](#5b-test-driven-implementation-loop) below.

#### `warnings`

Print to the user. Don't let them silently drown.

### 5b. Test-driven implementation loop

After the wiring step is applied, drive the production code from tests. The scaffold engine only writes thin stubs; turn them into a comprehensive suite, then iterate red → green → refactor.

**A. Expand the test stub.** Translate the developer's stated feature into explicit assertions. Cover:

- **Happy path**: the central behaviour described by the developer.
- **Edge cases**: empty input, missing optional fields, boundary values, large input.
- **Error paths**: invalid input rejected with the right exception or HTTP code; permission failures handled.
- **Integration points**: for `wp/cpt` assert `post_type_exists()` after `register()`; for `wp/rest` assert the route appears in `rest_get_server()->get_routes()` and a sample request returns the expected schema; for `wp/cron` assert `wp_next_scheduled()` returns a timestamp; for `wp/cli` assert `WP_CLI::add_command` was called or exercise `__invoke` directly with stubbed args.

Pick the framework that fits each test:

| Scaffold kind | Framework | What to test |
|---|---|---|
| `wp/cli` | PHPUnit | command behaviour, dry-run flag, output |
| `wp/rest` | PHPUnit (integration over `WP_REST_Request`) | route registration, response shape, permissions |
| `wp/cpt` | PHPUnit | post type registration, supports, REST exposure |
| `wp/taxonomy` | PHPUnit | taxonomy registration, attached object types, term creation |
| `wp/cron` | PHPUnit | hook scheduled, callback fires, unschedule works |
| `block/dynamic` | Jest (edit.js) + PHPUnit (render.php) | renders without crashing, render callback returns expected markup |
| `block/interactive` | Jest + Playwright | interactivity directives, store actions |
| `utility/*` (PHP) | PHPUnit | unit-level behaviour |
| `ci/*` workflows | actionlint + yaml-parse | syntactically valid; no runtime test |

Strip every `markTestIncomplete` you reach — leaving even one in the final state is a failure.

**B. Run the suite.** Resolve the command:

- `phpunit`: prefer `composer test` or `composer test:unit`; fall back to `vendor/bin/phpunit <path>`.
- `jest`: prefer `npm run test:js`; fall back to `npx jest <path>`.

Expect failure on the first run. If the suite errors before running (missing dependency, missing test framework setup), invoke the relevant `setup/*` scaffold first and re-run.

**C. Minimum implementation to flip one test green.** Edit the scaffolded production file to make one failing test pass. Do not implement multiple cases in one pass.

**D. Re-run.** Confirm the one targeted test now passes; others may still fail.

**E. Iterate B → D for each remaining failing test.** Keep loops tight (one test at a time). If you go three rounds without making progress on a test, stop and ask the developer for clarification rather than guessing — a stuck loop usually signals the feature requirements are ambiguous.

**F. Refactor.** Once everything is green, clean up duplication, extract helpers, improve names. Re-run after each refactor.

**G. Final gates before declaring done.** Run, in this order:

1. The full PHPUnit suite (`composer test`) — not just the new file.
2. The full Jest suite (`npm run test:js`) if JS was touched.
3. Lint: `composer lint:php` and `npm run lint:js` as applicable.

All four must be green. Surface any failures verbatim to the developer; do not "fix" pre-existing failures from outside the scaffold's scope without asking.

**Hard rules for TDD:**

- Never write production code before the corresponding test exists.
- Never silently lower assertion strength to make a test pass (no `assertTrue(true)`, no widened type assertions).
- Never delete or skip a test the developer would expect to pass. If a test is genuinely wrong, fix it and explain why in the final report.
- Never leave `markTestIncomplete`, `markTestSkipped`, or `@todo` markers in the final committed state.
- Stop and ask if the feature requirements are ambiguous after one round of guessing.

### 6. Report

End with a brief summary:

- Files written (from `engine.wrote`).
- Files skipped and why (from `engine.skipped`).
- Wiring applied (where, what pattern).
- Tests authored and final pass count (e.g. `tests/Cli/QmExportCommandTest.php — 7 tests, 7 passing`). Mention the lint result.
- Developer actions outstanding (composer / npm installs, secrets to set, branch protection recommendation if it's a CI scaffold).

Keep it scannable, not a novel.

## Hard prohibitions

You **must never**:

- Modify `composer.json`, `package.json`, or any lockfile beyond what the engine wrote.
- Run `composer require`, `npm install`, `gh secret set`, `gh repo edit`, or any other write-side CLI without explicit user approval.
- Read, log, or transmit secret values. The `developer.secrets` block carries declarations only; the engine never includes values.
- Edit branch protection, repository settings, webhooks, or any GitHub admin surface.
- Commit, push, open PRs, or comment on issues without explicit approval.
- Send code or developer data to remote services.
- Apply wiring without showing the user the diff and getting consent.
- Invent a third registration pattern when canonical and project-sampled disagree. Ask instead.
- Restore scaffold anchor comments (`// scaffold:cli-commands`) without explicit consent. Offer once per session; never on your own.

## Error handling

The engine emits structured errors as a single JSON object on stderr. Common codes:

| Code | Meaning | Your response |
|---|---|---|
| `ENOSCAFFOLD` | Unknown scaffold id | Surface the `available` list, suggest the closest match, ask. |
| `EMISSINGINPUT` | Required inputs missing in `--non-interactive` mode | Read `missingDetails`, run discovery via `discover_from` (step 2), retry the same call with the resolved values added. |
| `EBADSCAFFOLD` | Scaffold author bug (invalid `scaffold.json`) | Surface the error message verbatim. Do not retry. |
| `EWRITEFAIL` | OS write failed (permissions, disk full) | Surface path and errno. Do not retry. |
| `ERENDERFAIL` | Template references an undefined placeholder | Scaffold author bug. Surface. |

For unknown error codes: surface the message and exit non-zero. Do not crash.

## Worked example, end to end

User: "Add a WP-CLI command to export Query Monitor data as JSON."

```bash
# 1. Discover
npx @rtcamp/wp-tooling list --json --category=wp
```

You see `wp/cli` matches. Confirm with user.

```bash
# 2. Introspect (this session's first scaffold)
cat composer.json | grep -A 5 autoload   # → Acme\Blog\ -> src/
# find bootstrap class, sample existing CLI registrations
```

You discover: project uses `Acme\Blog\CLI` namespace, `src/CLI/` directory, classes end with `Command`, registration via `$this->commandRegistry->add(...)` in `src/Plugin/Main.php::register()`, no scaffold anchor. Confirm with user.

```bash
# 3 + 4. Apply naming, invoke engine
npx @rtcamp/wp-tooling add wp/cli \
    --non-interactive --json \
    --namespace='Acme\Blog\CLI' --base-path='src/CLI' \
    --name=qm-export --class=QmExportCommand
```

You receive a result with `engine.wrote: ["src/CLI/QmExportCommand.php"]`, `ai.wiring: [...]`, `ai.tests: [...]`.

5. The wiring snippet is the canonical `$this->boot(...)` but the project uses `commandRegistry->add(...)`. Show both versions, ask:

   ```
   Canonical wiring (does not match your project):
       $this->boot('qm-export', \Acme\Blog\CLI\QmExportCommand::class);

   Your project pattern, sampled from src/Plugin/Main.php::register():
       $this->commandRegistry->add(new \Acme\Blog\CLI\ImportCommand());

   I'd add this line right after the last existing registration at line 78:
       $this->commandRegistry->add(new \Acme\Blog\CLI\QmExportCommand());

   [apply] [different location] [edit snippet] [skip wiring]
   ```

   User: "apply". Insert the line.

6. Run `vendor/bin/phpunit tests/CLI/QmExportCommandTest.php`. Red. Fill the production class. Re-run. Green.

7. Report:

   ```
   Added src/CLI/QmExportCommand.php (followed your Command suffix convention).
   Wired into src/Plugin/Main.php:79 using your commandRegistry pattern.
   Test tests/CLI/QmExportCommandTest.php passing.

   No outstanding developer actions.
   ```

## CI/CD scaffold variant

The flow is the same except:

- `ai.wiring` is usually empty (workflows stand alone).
- `developer.secrets` is usually populated.
- `ai.tests` is `framework: actionlint` (or `yaml-parse` fallback), not a unit-test framework.
- You don't "fill" the YAML; the engine renders it complete. Just validate with actionlint and report.
- Always end with the consolidated secrets checklist.

For a multi-workflow setup ("set up CI + CD to WP.org"), chain `add` calls, one consent per scaffold, and emit **one consolidated** secrets checklist at the end (deduplicate any overlap).

## Reference

- Full engine contract: `node_modules/@rtcamp/wp-tooling/docs/ai-orchestration.md` (12-section contract this skill is built from).
- Worked conversation examples: `node_modules/@rtcamp/wp-tooling/docs/examples.md` (CLI command, block, REST + CPT + taxonomy, CI/CD to WP.org, singleton conversion).
- Engine source: `node_modules/@rtcamp/wp-tooling/src/scaffolds/`.
- Engine commits to: zero TTY UI dependency in non-interactive mode, four-block JSON shape (`scaffold`, `engine`, `developer`, `ai`, `warnings`), no auto-overwrite, no secret values, no package-manager commands.
