Package-specific rules for `node-packages/wp-tooling` (`@rtcamp/wp-tooling`). This assumes
you've already read the monorepo root `AGENTS.md` — that file covers install, the
two-ecosystem layout, and release mechanics; this file does not repeat any of it.

## Non-negotiables

- No runtime dependencies in `dependencies` — `dependencies` in `package.json` is `{}` by
  design; dev deps only.
- Banned from `dependencies`: `chalk`, `inquirer`, `@inquirer/prompts`, `clack`,
  `@clack/prompts`, `ora`, `listr2` — each pulls in exactly the runtime weight or TTY
  assumption `src/ui/` exists to avoid.
- `Mustache.escape = (text) => text` — never let Mustache HTML-encode generated code
  (`src/scaffolds/render.js`, `src/init/transform.js`).
- Every UI primitive in `src/ui/` works in a non-TTY environment (CI) — no crash when
  `process.stdout.isTTY` is false.
- Every CLI command under `src/cli/commands/` supports `--dry-run`.

## Directory layout

```
src/
  ci/               detect-changes.js, index.js — CI helper commands (change detection for CI pipelines)
  cli/              index.js (dispatcher) + commands/ (11 files: add, cache, detect-changes,
                    features, install-hooks, list, release-bump, release-changelog,
                    release-zip, validate, version-monitor)
  hooks/            index.js, install.js, templates/ — git hook installer + shell templates
                    (commit-msg, pre-commit)
  init/             cleanup.js, examples.js, features.js, git.js, identity.js, index.js,
                    manage.js, persist.js, transform.js — shared init engine for consumer
                    WP plugin/theme starters
  release/          bump.js, changelog.js, context.js, index.js, zip.js — version
                    bump/changelog/zip for CONSUMER WordPress plugins/themes only
  scaffolds/        add.js, cache.js, cli-support.js, config.js, errors.js, features.js,
                    fetch.js, index.js, list.js, prompt-inputs.js, registry.js, render.js,
                    schema.js, sources.js, validate.js — ScaffoldRegistry, recursive
                    scaffold.json scanner/renderer
  ui/               errors.js, index.js, core/, prompts/, report/, selects/, spinner/,
                    style/, wizard/ — TTY UI toolkit, zero-dep primitives, non-TTY fallback
  version-monitor/  cli.js, config.js, detect.js, http.js, index.js, reporter.js, semver.js,
                    updater.js, util.js, detectors/ — version monitor detectors/updaters/reporters
bin/wp-tooling.js   thin shim requiring ../src/cli/index.js
scaffolds/          top-level categories: ci/, lint/, setup/, wp/
docs/               ai-orchestration.md, authoring-scaffolds.md, editor-setup.md,
                    examples.md, wp-framework-contract.md
skills/             README.md + scaffold/ + setup/ (each with SKILL.md + evals/);
                    *-workspace/ dirs are gitignored eval scratch, not shipped content
tests/              mirrors src/'s 8 dirs, plus fixtures/ and a skills/ test dir (10 total)
```

`src/lint/` no longer exists — it was extracted into the standalone `eslint-config` /
`stylelint-config` packages. Do not recreate it or reference it.

Two distinct `features.js` files — don't confuse them:
- `src/scaffolds/features.js` — exported publicly as `require('@rtcamp/wp-tooling/features')`.
- `src/init/features.js` — internal to the init engine; not deep-importable (no
  wildcard in the exports map). Its `makeFeatureApi` is re-exported through
  `./init` (`require('@rtcamp/wp-tooling/init').makeFeatureApi`) so a consumer
  plugin/theme can unit-test its own scaffold config's feature hooks against
  the real `FeatureApi`. Nothing else from this file is exported.

`package.json` `exports` map (8 entries, all resolve to real files):
```json
"exports": {
  "./ui": "./src/ui/index.js",
  "./init": "./src/init/index.js",
  "./scaffolds": "./src/scaffolds/index.js",
  "./features": "./src/scaffolds/features.js",
  "./release": "./src/release/index.js",
  "./hooks": "./src/hooks/index.js",
  "./ci": "./src/ci/index.js",
  "./version-monitor": "./src/version-monitor/index.js"
}
```
`src/cli/` has no export entry on purpose — it's the CLI's own internal entry point,
required directly by `bin/wp-tooling.js`, not meant for external
`require('@rtcamp/wp-tooling/cli')`.

`src/release/` is for consumers, not this monorepo — `loadContext()` /
`findPluginEntry()` (`src/release/context.js`) requires a `.php` file with a
`Plugin Name:` header at cwd root and throws otherwise. `wp-tooling release:bump` /
`release:changelog` cannot version this monorepo's own six packages; see Testing below
for how this package cuts its own release instead.

## Architecture patterns

- **Wizard step**: class with `name`, `description`, `skip(ctx)`, `run(ctx)`. Extends
  `AbstractStep` (if defined) or exports an object matching that shape.
- **Scaffold**: JSON spec + Mustache templates, discovered by `ScaffoldRegistry.scan()`
  — no hardcoded registration.
- **UI primitive**: function returning a Promise, zero deps, works without TTY.
- **CLI command**: module under `src/cli/commands/*.js` exporting
  `{ name, summary, run(argv) }`. `name` is matched against `argv[0]`; `summary` is
  one-line help text; `run(argv)` receives argv *after* the subcommand name and returns
  an exit code (or `Promise<number>`). Auto-discovered by `src/cli/index.js` — adding a
  command is a new file under `commands/`, no dispatcher edit.

Rule of thumb: prefer small, pure functions with explicit inputs over classes with
internal state.

## Coding standards

- ESLint `@wordpress/eslint-plugin` (via `@rtcamp/eslint-config`) — zero errors before PR.
- Every public function has a JSDoc block with `@param` and `@returns`.
- No `eval`, no `Function(string)`, no dynamic `require` paths.
- All async work uses `async`/`await` — no raw `.then()` chains.
- Error messages include what was expected and what was received.
- PascalCase for class names, camelCase for functions, kebab-case for filenames.

## Testing

- Every UI primitive, wizard, and scaffold gets at least one Jest test.
- Tests live in `tests/<area>/<name>.test.js`, mirroring `src/`.
- Test against mock TTY (never a real terminal) — mock `process.stdout.isTTY`, as the
  existing `tests/ui/*.test.js` suites do.
- `npm run check` — `eslint src tests` + `jest`.
- `npm run lint` / `npm run lint:fix`.
- `npm test` / `npm run test:coverage`.
- `npm run test:watch` — watch mode; this package only (the three config packages don't
  define it).
- Cutting this package's own release (manual — `release:bump`/`release:changelog` don't
  apply here, see Directory layout above): bump `package.json`'s `"version"` and rename
  `CHANGELOG.md`'s `## Unreleased` heading to `## <version> - <YYYY-MM-DD>` (Keep a
  Changelog), in the same commit.
