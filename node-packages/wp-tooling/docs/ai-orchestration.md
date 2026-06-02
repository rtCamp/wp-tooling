# AI orchestration contract for the scaffold engine

> Status: contract for `@rtcamp/wp-tooling` scaffold engine v1.
> Audience: authors of Claude Code skills (or any AI agent) that orchestrate the engine.
> Scope: what the engine guarantees, what a skill must do, and the protocol for the trickier moments (project introspection, adaptive wiring, secrets, the TDD loop, workflow scaffolds).

## 1. Audience and scope

This document is for engineers writing AI skills that drive the scaffold engine. It pins down the surface a skill calls and the behaviours a skill must implement when wrapping the engine's output. It does **not** cover skill prompt design, the Claude Code runtime, or non-AI usage of the engine. For human CLI usage see the README; for the engine's internal architecture see the source under `src/scaffolds/`.

When this doc says "the skill", it means any AI orchestration layer. When it says "the engine", it means `registry.execute()` or its CLI equivalent `npx wp-tooling add ... --non-interactive --json`.

## 2. The engine surface

A skill invokes the engine in one of two equivalent ways:

```bash
npx wp-tooling add <category>/<slug> [--<input>=<value>]... \
    --non-interactive --json [--dry-run] [--cwd <path>]
```

```js
const { ScaffoldRegistry } = require('@rtcamp/wp-tooling/scaffolds');
const registry = new ScaffoldRegistry({
    defaultsDir: '<wp-tooling>/scaffolds',
    projectDir: '<project>/bin/scaffolds',
});
await registry.scan();
const result = await registry.execute(id, inputs, { dryRun, cwd });
```

Both forms return the same four-block JSON result described in §3 of [scaffold-engine-return-syntax.md](https://github.com/rtCamp/wp-tooling) (also reproduced in `src/scaffolds/registry.js` JSDoc).

Result shape, in brief:

```json
{
    "scaffold":  { "id", "slug", "kind", "dryRun" },
    "engine":    { "wrote": [...], "skipped": [...] },
    "developer": { "install": { "composer": {...}, "npm": {...} }, "secrets": [...] },
    "ai":        { "wiring": [...], "tests": [...] },
    "warnings":  [...]
}
```

## 3. Engine guarantees

The engine commits to the following on a successful run. Skills can rely on these without defensive checks:

- Every path in `engine.wrote` exists on disk relative to `--cwd`. Exception: `scaffold.dryRun: true` runs report the plan as if files were written, without writing them.
- Every path in `engine.skipped` was already present and was **not overwritten**.
- Nothing in `ai.wiring` was applied. The engine never edits files outside `engine.wrote`. The whole `ai` block is by definition a plan; applying it is the caller's responsibility (with developer consent, §8).
- `developer.install` (Composer and npm) describes what the developer should install. The engine never runs `composer require` or `npm install`.
- `developer.secrets` is a verbatim passthrough of the scaffold manifest's `secrets[]` block. The engine never accepts secret **values** as inputs, never embeds values in any output field, never reads them from the environment, never logs them. Only `key`, `scope`, `description`, and `required` ever appear in the output.
- The engine is idempotent under `scaffold.dryRun: true`: identical inputs produce identical output across runs.
- The engine never reads or writes any path outside `--cwd`.
- The engine never invokes `gh`, `git`, `composer`, `npm`, or any other external CLI on behalf of the caller.
- `scaffold.kind` is `"package"` for `source: "package"` scaffolds (no files written, only deps and wiring) and `"template"` otherwise. Remote (inventory) scaffolds also report `kind: "template"` — they render Mustache the same way as local ones; where the scaffold lives is an implementation detail the orchestrator does not need to branch on. Callers branch on `kind` rather than checking `engine.wrote.length === 0`.
- `wp-tooling list --json` entries carry an `origin` of `"default"`, `"project"`, or `"remote"`. Remote scaffolds are listed from the inventory without fetching, so their `counts` is `null` (unknown until `add`); local scaffolds carry real `counts`.
- The engine core has zero dependency on the TTY UI kit. AI orchestration mode never loads any terminal-UI primitive. Skills can rely on the engine being usable from any context, including non-TTY containers, CI runners, and headless test harnesses.

## 4. Skill responsibilities

Each item below is phrased as "the skill must" or "the skill must never" so it is enforceable in a skill prompt.

- The skill **must** present each entry in `ai.wiring` to the developer as a diff (canonical or translated per §7). The skill must get explicit consent before editing any `targetFile`.
- The skill **must** apply approved wiring snippets idempotently. Search for the snippet first; do not re-insert if it already exists at the target.
- The skill **must** run the test commands from `ai.tests` only after wiring has been applied.
- The skill **must never** silently edit files outside `engine.wrote` and approved `ai.wiring` entries.
- The skill **must** surface engine `warnings` to the developer.
- The skill **must** provide all required inputs upfront in `--non-interactive` mode. Discovering missing keys by reading the `EMISSINGINPUT` error and retrying is acceptable.
- The skill **must never** read, write, log, or transmit values for any `secrets[]` entry. Skills declare what is needed and ask the developer to set it; they never see the value.
- The skill **must never** run `gh secret set`, `composer require`, `npm install`, or any package-manager command without explicit developer approval.
- The skill **must never** edit branch protection, repository settings, webhooks, or any other GitHub admin surface.
- The skill **must never** commit, push, open PRs, or comment on issues without explicit approval.
- The skill **must never** send code or developer data to remote services.

## 5. Error codes

The engine raises a small, closed set of error codes. Each is emitted as a JSON object on stderr in `--json` mode, or thrown as a `ScaffoldError` with `.code` set when called programmatically.

### `ENOSCAFFOLD`

The requested `<category>/<slug>` is not in the merged catalogue.

```json
{
    "code": "ENOSCAFFOLD",
    "message": "No scaffold registered for slug: wp/clu",
    "requested": "wp/clu",
    "available": ["wp/cpt", "wp/taxonomy", "wp/block-dynamic", "wp/admin-page", "ci/cd-wporg"]
}
```

**Skill response:** surface the `available` list, suggest the closest match (e.g., "Did you mean `wp/cli`?"), retry only with developer confirmation.

### `EMISSINGINPUT`

`--non-interactive` mode and one or more required inputs were not supplied (after the manifest's `default` was applied).

```json
{
    "code": "EMISSINGINPUT",
    "message": "Missing required inputs: name, plugin_slug",
    "scaffold": "ci/cd-wporg",
    "missing": ["name", "plugin_slug"],
    "missingDetails": [
        { "key": "name", "description": "Slug for the new command (kebab-case).", "discover_from": null },
        { "key": "plugin_slug", "description": "WordPress.org plugin slug.", "discover_from": null }
    ]
}
```

**Skill response:** read `missingDetails`, prompt or run discovery via `discover_from` (§6), retry the same `execute()` call with the resolved values added.

### `EBADSCAFFOLD`

A `scaffold.json` in the catalogue is malformed (invalid JSON or fails schema validation). Indicates a scaffold-author bug, not a caller bug.

```json
{
    "code": "EBADSCAFFOLD",
    "message": "Invalid scaffold /path/to/scaffold.json:\n  - wiring[0]: missing required field 'target_file'",
    "file": "/path/to/scaffold.json",
    "errors": ["wiring[0]: missing required field 'target_file'"]
}
```

**Skill response:** surface to the developer. Do not retry. Recommend filing a bug against the scaffold's home repo.

### `EWRITEFAIL`

An OS-level write failed (permissions, disk full, path traversal).

```json
{
    "code": "EWRITEFAIL",
    "message": "Failed to write src/CLI/QmExportCommand.php: EACCES",
    "path": "src/CLI/QmExportCommand.php",
    "errno": "EACCES"
}
```

**Skill response:** surface to the developer with the path and errno. Do not retry automatically.

### `ERENDERFAIL`

A Mustache template referenced a placeholder not in the resolved inputs. Engine treats undefined placeholders as fatal rather than silently rendering empty strings.

```json
{
    "code": "ERENDERFAIL",
    "message": "undefined placeholder 'foo_bar'",
    "placeholder": "foo_bar"
}
```

**Skill response:** surface as a scaffold-author bug.

### `EFETCHFAIL`

A fetch for a remote (inventory) scaffold failed — either its `scaffold.json` manifest or one of its templates: non-2xx HTTP response, timeout, or transport error. The caller's machine has no internet, the inventory's repo/ref/path does not exist, or `raw.githubusercontent.com` rate-limited the request. (`EBADSCAFFOLD` is thrown instead when the fetched manifest is reachable but invalid JSON / fails schema validation.)

```json
{
    "code": "EFETCHFAIL",
    "message": "GET https://raw.githubusercontent.com/rtCamp/wp-shared-workflows/v1/scaffolds/ci/test-php/ci-test-php.yml.mustache returned HTTP 404",
    "url": "https://raw.githubusercontent.com/rtCamp/wp-shared-workflows/v1/scaffolds/ci/test-php/ci-test-php.yml.mustache",
    "statusCode": 404
}
```

When the response looks like a GitHub rate-limit (HTTP 403 with `"rate limit"` in the body), the payload additionally carries `"rateLimited": true` — set `WP_TOOLING_GITHUB_TOKEN` to raise the unauthenticated quota.

**Skill response:** surface to the developer. If `rateLimited` is true, recommend setting `WP_TOOLING_GITHUB_TOKEN` (or waiting). For 404 / wrong-ref errors, recommend re-checking the inventory entry's `repository.{github,ref,path}`. Do not retry automatically.

## 6. Project introspection

Before any `add` call, the skill must learn what the project actually looks like. The engine and the scaffold templates are written against rtCamp skeleton conventions, but real client projects diverge (different namespace, different base path, different bootstrap method). Even projects originally scaffolded from the rtCamp skeleton routinely drop scaffold anchor comments during cleanup, code review, or refactoring.

The skill discovers project shape from existing artifacts. No config file is required of the developer.

- **Read `composer.json`** to extract `autoload.psr-4`. The first entry gives the project's namespace prefix and base path.
- **Read `package.json`** to learn the build pipeline and scripts.
- **Locate the bootstrap class.** Heuristic: open the main plugin file (named in the `Plugin Name:` header), find the first `new X(...)` or `X::get_instance()` call, follow it to the class definition. Note the file path and the method used to register subsystems (`register()`, `setup()`, `boot()`, etc.).
- **Sample existing patterns of the same scaffold type.** **This is the primary signal.** If adding a CLI command, find two or three existing CLI command registrations and note the **registration snippet** (the call shape the project uses) **and the naming conventions** (class suffix, namespace sub-structure). Pattern sampling is more robust than anchor detection because anchors are routinely removed by cleanup; existing code is the ground truth.
- **Sample naming conventions in the target directory.** Naming conventions exist for every scaffold type:
  - **PHP scaffolds:** PSR-4 is assumed (filename matches class name, namespace matches directory). What PSR-4 does not pin down and the skill therefore detects:
    - **Class suffix or prefix.** Common in rtCamp work: `Command`, `Controller`, `Service`, `Handler`, `Repository`, `Provider`, `Factory`, `Job`.
    - **Namespace sub-structure.** `Acme\Blog\CLI\Commands\X` (sub-namespace `Commands`) vs `Acme\Blog\CLI\X`.
  - **Block scaffolds:** vendor-prefixed (`acme/foo`) vs bare slug, source directory (`src/blocks/` vs `assets/blocks/`), JSX vs TSX file extensions, style file split (`style.scss` vs `editor.scss` + `style.scss`).
  - **CI/CD workflow scaffolds:** workflow filename convention (`wp-ci.yml` vs `ci.yml` vs `pr.yml`), trigger conventions.
- **Treat scaffold anchor comments as a supplementary signal, not the primary one.** Anchors are useful for finding the exact insertion line when present, but their absence does not mean the project lacks a registration point. Long-lived rtCamp-skeleton-based projects often have all their anchors stripped by linters or code reviewers.
- **Resolve `inputs[]` per `discover_from` hints** declared in the scaffold manifest. For each input, read the source named in `discover_from` (`composer.json:autoload.psr-4`, `package.json:name`, `code:bootstrap-class`, `code:cli-pattern`, etc.), extract the value, and pass to the engine. If discovery is ambiguous, the skill **must ask the developer** with the discovered options as suggestions rather than guess.

**Confirm with the developer once per session.** Present discovered values as a single block:

```
I found:
- namespace Acme\Blog, base path src/
- bootstrap src/Plugin/Main.php::register()
- CLI commands live in src/CLI/, classes end with "Command" (e.g. ImportCommand, PurgeCommand)
- registration pattern: $this->commandRegistry->add(new \Acme\Blog\CLI\X())
- scaffold anchor // scaffold:cli-commands not found; will insert after the last sampled commandRegistry->add() call
Confirm or correct?
```

Cache the confirmed values for the rest of the conversation. Do not persist them to disk.

## 7. Adaptive wiring

The skill resolves two questions for every wiring entry: **what snippet to write** (canonical or translated) and **where to put it** (anchor, structural location, or developer-pointed). Both axes lead with pattern sampling rather than anchor lookup.

### What snippet to write

- **Apply the canonical snippet unchanged** when the canonical pattern (`$this->boot('slug', X::class)`) matches the snippet shape the project already uses for the same scaffold type. The rtCamp skeleton case lands here.
- **Translate the snippet** when the project's sampled pattern differs from canonical. Take the sampled pattern (e.g., `$this->commandRegistry->add(new \Acme\Blog\CLI\X())`), substitute the new class name into the same shape, present both versions side by side to the developer.
- **Never invent a third pattern.** If the canonical and the sampled patterns both look wrong (no clear convention, no existing implementations, conflicting examples), surface the ambiguity to the developer rather than producing a hybrid the developer cannot recognise.

### Where to put it

Fall through these in order:

1. **Use the scaffold's declared anchor if present in the target file.** Single-line insertion immediately after the anchor.
2. **Anchor missing but pattern sampling found a clear insertion neighbourhood.** Insert immediately after the last sampled occurrence of the same pattern. This is the common case for cleaned-up rtCamp-skeleton projects and for client projects with their own conventions.
3. **No anchor and no clear pattern neighbourhood.** The bootstrap method exists (from §6) but there are no prior examples of this scaffold type. Insert at a sensible position in the bootstrap method (typically just before the closing brace), and explicitly tell the developer this is a best-effort placement.
4. **No bootstrap method either.** Skip wiring, surface the snippet as a manual instruction in the report, let the developer place it.

At every level the skill **shows the developer the snippet, the target file, the chosen line range, and the reason for the choice** before applying. The developer can apply, redirect to a different location, edit the snippet, or skip.

### Anchor restoration (optional, never automatic)

When the skill detects that anchors are missing in a project that otherwise looks like rtCamp skeleton output (PSR-4 `Inc\\` namespace, `includes/` base path, `Plugin.php` bootstrap), it may offer **once per session**: "I notice your project does not have scaffold anchor comments. Restoring them lets future scaffold runs find insertion points instantly. Want me to add the anchors for the categories you have in use? [yes / no / not now]". Never restore anchors without explicit consent.

### Worked example A, canonical pattern with stripped anchor

> Skill: The scaffold's canonical wiring is:
>
> ```php
> $this->boot('qm-export', Cli\QmExport::class);
> ```
>
> Your project's existing CLI registrations in `includes/Plugin.php::boot()` use the same pattern:
>
> ```php
> $this->boot('import', Cli\Import::class);
> $this->boot('purge', Cli\Purge::class);
> ```
>
> The `// scaffold:cli-commands` anchor is not in this file (likely removed by cleanup). I would like to add the new line right after the last existing `$this->boot(...)` call inside `boot()`, at line 47:
>
> ```php
> $this->boot('qm-export', Cli\QmExport::class);
> ```
>
> [apply] [different location] [edit snippet] [skip wiring]

### Worked example B, different pattern, no anchor

> Skill: Your project registers CLI commands using a `commandRegistry`, not the canonical `boot()` pattern. Sampled from `src/Plugin/Main.php`:
>
> ```php
> $this->commandRegistry->add(new \Acme\Blog\CLI\ImportCommand());
> ```
>
> I would like to add this line in the same method, right after the last existing registration at line 78:
>
> ```php
> $this->commandRegistry->add(new \Acme\Blog\CLI\QmExportCommand());
> ```
>
> [apply] [different location] [edit snippet] [skip wiring]

## 8. The wiring permission protocol

Once the snippet has been resolved (canonical or adapted, per §7), the skill presents a single `ai.wiring` entry to the developer:

- Show the `targetFile` and the line range that would be affected.
- Show the `description` from the manifest.
- Show the rendered `snippet` (the version from §7, not necessarily the raw manifest snippet).
- Ask "Apply this change to `<targetFile>`?" with options Apply / Skip / Show full file context / Edit snippet.

A skill that applies wiring without this exchange is non-conformant.

## 9. The TDD-with-AI loop

Concrete sequence for a code scaffold (`wp/cli`, `wp/rest`, etc.):

1. Skill calls the engine.
2. Engine returns `ai.tests` with one or more entries: `{ path, framework, command? }`.
3. Skill reads project config to resolve the test command if `ai.tests[].command` is null:
   - `phpunit`: look up `composer.json` `scripts.test` or fall back to `vendor/bin/phpunit <path>`.
   - `jest`: look up `package.json` `scripts.test` or fall back to `npx jest <path>`.
   - `playwright`, `pa11y`: same pattern, look up scripts then fall back.
4. Skill runs the test, expects failure (the stub typically asserts `markTestIncomplete` or similar).
5. Skill edits the scaffolded production file(s) to make the test pass, using the developer's stated intent and project context from §6.
6. Skill re-runs the test, expects success.
7. Skill presents a short report (file paths, test outcome, what wiring was applied).

The TDD loop applies regardless of whether the scaffold also has `ai.wiring` entries; wiring is applied first, then the test runs against the wired project.

## 10. Workflow scaffolds (CI/CD)

Workflow scaffolds (`category: 'ci'`) follow a different loop because the output is YAML, not code, and they typically declare `secrets[]`.

1. Skill asks the developer the right shape-questions upfront in one block: project type (plugin / theme / package), which deploy targets, whether version monitor is wanted.
2. Skill chains an engine call per workflow scaffold (e.g., `add ci/full-pipeline`, `add ci/cd-github-release`, `add ci/cd-wporg`). Each call is a separate consent moment (per §8).
3. Engine returns `engine.wrote` (the YAML), `ai.tests` (the actionlint task), and `developer.secrets` (the keys the developer must set).
4. Skill validates each YAML file: prefer `actionlint` if available, fall back to `yaml-parse` per the manifest's `tests[]` block.
5. Skill emits a **single consolidated setup checklist** covering secrets from all scaffolded workflows combined:
   - For each secret: `key`, `description`, plus a copy-pasteable `gh secret set <KEY> --repo <owner/repo>` command for the developer to run themselves.
   - Plus a one-line recommendation to enable branch protection on `main` and the active release branch, with a link to the GitHub docs and **no automatic action**.
6. Skill never runs `gh secret set` itself, never asks the developer to paste secret values into the chat, never logs secret values, never edits branch protection.
7. Final report includes the workflow files created, the YAML lint result, and the secrets checklist.

### Worked example, CI/CD chain

Developer: "Set up the full CI/CD stack for a plugin going to GitHub releases and WordPress.org."

1. Skill asks: project type (plugin), deploy targets (releases + wporg + S3? → releases + wporg), version monitor (no).
2. Skill chains:
   - `add ci/full-pipeline --project-type=plugin`
   - `add ci/cd-github-release --project-type=plugin`
   - `add ci/cd-wporg --plugin-slug=acme-blog-exports`
3. Each engine call is a separate consent moment.
4. Skill runs `actionlint` on all three YAML files.
5. Consolidated checklist:

   ```
   This setup needs two secrets in this repo. Run these yourself (I never set secrets):

       gh secret set WPORG_USERNAME --repo Acme/blog-plugin
       # WordPress.org SVN username with commit access to the plugin slug.

       gh secret set WPORG_PASSWORD --repo Acme/blog-plugin
       # Password matching WPORG_USERNAME. Treat as write-only.

   Also recommended: enable branch protection on main. I will not change repo settings.
   Once secrets are set, the next GitHub release triggers a WP.org deploy.
   ```
6. Report: 3 workflow files added, all linted, 2 secrets to set, branch protection recommendation noted.

## 11. What skills must never do

Hard prohibitions, lifted from §4 for visibility:

- Modify `composer.json`, `package.json`, or lockfiles without explicit developer approval.
- Run `composer require`, `npm install`, or any package manager command without explicit approval.
- Read, write, log, or transmit values for any `secrets[]` entry. Skills declare what is needed and ask the developer to set it; they never see the value.
- Run `gh secret set`, edit branch protection, edit repository settings, or change webhooks. These are explicit out-of-scope actions for the skill.
- Commit, push, open PRs, or comment on issues without explicit approval.
- Send any code or developer data to remote services.

## 12. Versioning and stability

The JSON shape is part of `@rtcamp/wp-tooling`'s public API and follows semver:

- **Adding fields** to the result blocks is a **minor** bump. Skills should ignore unknown fields rather than fail.
- **Removing or renaming** a field is a **major** bump.
- **New error codes** may be added in a minor bump. Skills should handle unknown codes by surfacing the message and exiting non-zero rather than crashing.
- **New `framework` values** (currently `phpunit`, `jest`, `playwright`, `pa11y`, `actionlint`, `yaml-parse`) may be added in a minor bump.
- **New `scope` values** for secrets (currently `github-actions`, `env`, `dotenv`) may be added in a minor bump.

Pinning `@rtcamp/wp-tooling` to a specific major in your skill's package manifest is the supported way to maintain forward compatibility.
