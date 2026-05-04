# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Added

- TTY UI kit (`src/ui/`) with eight public exports: `Wizard`, `text`, `confirm`, `password`, `checkbox`, `radio`, `checkboxTree`, and `spinner`.
- `Wizard` class -- runs steps in order, sharing a mutable context object; supports `skip(ctx)` predicate.
- `spinner` -- async progress feedback with ASCII animation in TTY and plain text fallback.
- `text`, `confirm`, `password` prompts with validation support and non-TTY fallback.
- `checkbox` (multi-select) and `radio` (single-select) flat list selects.
- `checkboxTree` -- grouped tree multi-select with group-level toggling.
- Low-level terminal helpers (`src/ui/core/terminal.js`) -- ANSI codes, cursor control, keypress events.
- Jest test suite for all UI primitives (31 tests).
