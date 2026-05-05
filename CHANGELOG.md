# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Added

- TTY UI kit (`src/ui/`) with nine public exports: `Wizard`, `text`, `confirm`, `password`, `checkbox`, `radio`, `checkboxTree`, `spinner`, and `CancelledError`.
- `Wizard` class -- runs steps in order, sharing a mutable context object; supports `skip(ctx)` predicate. Validates that `steps` is an array. Omits ANSI formatting in non-TTY mode.
- `spinner` -- async progress feedback with ASCII animation in TTY and plain text fallback. Guards against multiple intervals when `start()` called twice.
- `text`, `confirm`, `password` prompts with validation support and non-TTY fallback.
- `checkbox` (multi-select) and `radio` (single-select) flat list selects with input validation (`TypeError` on missing or invalid `choices`).
- `checkboxTree` -- grouped tree multi-select with group-level toggling. Returns selections in display order. Input validation for `groups`. Returns empty array for empty groups without prompting.
- `CancelledError` -- thrown on Ctrl+C in any TTY-interactive prompt or select; callers decide exit behaviour.
- Low-level terminal helpers (`src/ui/core/terminal.js`) -- ANSI codes, cursor control, keypress events.
- Jest test suite for all UI primitives (46 tests).
