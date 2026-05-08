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
- `@rtcamp/wp-tooling/ci` — `detectChanges` library function. Buckets changed files into css / js / php / gha counts against the diff base (auto-detected from `GITHUB_BASE_REF` for PRs, `HEAD~1` for pushes). Zero runtime dependencies.
- `wp-tooling` CLI (`bin/wp-tooling.js`) — top-level dispatcher with subcommand registry, `--help`, and `--version`.
- `wp-tooling detect-changes` subcommand. Supports `--output text|json|github`, `--ignore <regex>`, `--base <ref>`, `--files <path|->`, and `--dry-run`. With `--dry-run` and `--output github`, the would-be `$GITHUB_OUTPUT` lines are printed to stdout (prefixed with `[dry-run]`) instead of being appended to the file.
