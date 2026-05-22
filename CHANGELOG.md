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
- `@rtcamp/wp-tooling/release`: three release-flow libraries plus matching `wp-tooling` subcommands. Shared `loadContext()` reads `package.json`, optional `composer.json`, and locates the WordPress plugin entry file at the package root.
- `wp-tooling release:bump` subcommand. Accepts `--type patch|minor|major` (default `patch`) or an explicit `--to X.Y.Z`. Rewrites `package.json`, `composer.json` (if present), the plugin header `Version:` line and the matching `*_VERSION` constant. Writes are atomic per file. Supports `--dry-run`. Exits 1 when the plugin entry file or its `Version:` header is missing.
- `wp-tooling release:changelog` subcommand. Renames `## Unreleased` to `## <version> - <YYYY-MM-DD>` (UTC) and prepends a fresh `## Unreleased`. Reads the version from `package.json` by default; `--to X.Y.Z` overrides. Refuses to run when `## Unreleased` has no notes. Supports `--dry-run`.
- `wp-tooling release:zip` subcommand. Builds a deterministic `dist/<slug>-<version>.zip` containing the slug-named top-level directory. Reads `.distignore` when present; falls back to a default exclude list (`tests/`, `node_modules/`, `bin/`, `.github/`, `*.config.js`, `package-lock.json`). Entry mtimes pin to `SOURCE_DATE_EPOCH` / `git log -1 --format=%ct` / `2010-01-01` (in that precedence order); entries are sorted lexicographically; two consecutive runs against the same tree produce a byte-identical archive. Supports `--dry-run` and `--force`.
- Hand-rolled zip writer (`src/release/zip.js`) on top of `zlib.deflateRawSync`. Implements the standard ZIP local file header, central directory, and end-of-central-directory record. Roughly 100 lines, keeping the zero-runtime-dep guarantee.
