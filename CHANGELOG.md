# Changelog

All notable changes to `@rtcamp/wp-tooling` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Added

- TTY UI kit (`src/ui/`) with nine public exports: `Wizard`, `text`, `confirm`, `password`, `checkbox`, `radio`, `checkboxTree`, `spinner`, and `CancelledError`.
- `Wizard` class -- runs steps in order, sharing a mutable context object; supports `skip(ctx)` predicate. Validates that `steps` is an array. Omits ANSI formatting in non-TTY mode.
- `spinner` -- async progress feedback with ASCII animation in TTY and plain text fallback. Guards against multiple intervals when `start()` called twice.
- `text`, `confirm`, `password` prompts with validation support and non-TTY fallback. Each accepts either a string message shortcut (`text('Name?')`) or a full options object.
- `checkbox` (multi-select) and `radio` (single-select) flat list selects with input validation (`TypeError` on missing or invalid `choices`).
- `checkboxTree` -- grouped tree multi-select with group-level toggling. Returns selections in display order. Input validation for `groups`. Returns empty array for empty groups without prompting.
- `CancelledError` -- thrown on Ctrl+C in any TTY-interactive prompt or select (including `text` and `confirm`, which surface cancellation through the underlying `readLine` SIGINT handler). Callers decide exit behaviour.
- Low-level terminal helpers (`src/ui/core/terminal.js`) -- ANSI codes, cursor control, keypress events.
- Jest test suite for all UI primitives (75 tests, including dedicated coverage for `src/ui/core/terminal.js`).
- `@rtcamp/wp-tooling/ci` — `detectChanges` library function. Buckets changed files into css / js / php / gha counts against the diff base (auto-detected from `GITHUB_BASE_REF` for PRs, push event `before` SHA from `$GITHUB_EVENT_PATH` for pushes, `HEAD~1` as a last resort). Opt into per-bucket file lists with `{ includeFiles: true }`. Zero runtime dependencies.
- `wp-tooling` CLI (`bin/wp-tooling.js`) — top-level dispatcher with subcommand registry, `--help`, and `--version`.
- `wp-tooling detect-changes` subcommand. Supports `--output text|json|github`, `--ignore <regex>`, `--base <ref>`, `--files <path|->`, `--include-files`, and `--dry-run`. `--include-files` adds `<bucket>-files` arrays alongside counts (newline heredoc under `--output github`, space-joined under `--output text`, native arrays under `--output json`) so workflows can lint or test only the changed paths. With `--dry-run` and `--output github`, the would-be `$GITHUB_OUTPUT` lines are printed to stdout (prefixed with `[dry-run]`) instead of being appended to the file.
- `@rtcamp/wp-tooling/scaffolds` — `ScaffoldRegistry` class and `validate` function. The registry scans a directory recursively for `scaffold.json` files, validates each against a hand-rolled schema (zero runtime deps; no ajv), and exposes them via `all()`, `filter(predicate)` (object shorthand or function), and `collectDependencies(slugs)` which merges the five dependency maps (`npm`, `npmDev`, `composer`, `composerDev`, `composerSuggest`) across the named scaffolds. Each dependency map entry is enforced to be a non-empty string version range — numbers, nulls, arrays, and empty strings are rejected with `<map>["<pkg>"] must be a non-empty version range string, got <value>`. Missing directory returns an empty array; malformed or invalid scaffolds throw an `Error` whose message includes the offending file path. `scan()` updates state atomically: on parse/validation failure the prior good state is preserved; on missing dir the registry is cleared. Duplicate slugs (within a single scan) and dependency version conflicts log a warning to stderr (last write wins).
- `wp-tooling scaffolds-validate <dir>` subcommand. Validates every `scaffold.json` under `<dir>`. Exits 0 when every scaffold is valid (including the case where the directory has no scaffolds), 1 on validation/IO failure with the offending file path on stderr, 2 on usage error. Read-only — no `--dry-run` flag.
- CLI dispatcher refactor. `main(argv)` is now `async` and always returns `Promise<number>`. The `bin/wp-tooling.js` shim awaits via `.then(process.exit, errorHandler)` with no sync/async branching. Subcommands continue to return either `number` (sync) or `Promise<number>` (async) — both work transparently. Existing sync subcommands (`detect-changes`) are unaffected. Side-benefit: any unhandled error from a subcommand now surfaces as `wp-tooling: unexpected failure (<detail>)` instead of a raw Node stack trace.
