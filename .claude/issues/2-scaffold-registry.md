# Issue #2 — ScaffoldRegistry framework

**Status:** in-progress
**Branch:** `v1.0.0/task/scaffold-registry`
**PR:** #12
**Assignee:** @Adi-ty

---

## Summary

Add the generic scaffold engine to `wp-tooling`: a `ScaffoldRegistry` class that recursively discovers `scaffold.json` files inside a consuming skeleton's `bin/scaffolds/` directory, validates them against a hand-rolled schema, and exposes them via `all()`, `filter()`, and `collectDependencies()`. Ships with a `wp-tooling scaffolds-validate <dir>` CLI for CI / local validation. Unblocks the wizard's module-selection step in Sprint 4 and the `npm run add:module` flow in every consuming skeleton.

---

## Decisions made

- [2026-05-18] Branched off `v1.0.0/task/detect-changes` (not from `release/v1.0.0` and not from `tty-ui-kit`). Reason: the dispatcher infrastructure (`bin/wp-tooling.js` + `src/cli/index.js`) already exists on detect-changes; branching off it gives zero merge conflict on rebase. TTY UI kit primitives are deliberately deferred — the spec asks for `spinner` + `CancelledError` in the validate CLI but we will add them in a follow-up commit after `tty-ui-kit` merges to `release/v1.0.0`, alongside parallel UI-kit retrofits for `detect-changes` and `install-hooks`.
- [2026-05-18] CLI subcommand name `scaffolds-validate` (hyphen), not `scaffolds:validate` (colon) from the spec. Reason: matches the existing dispatcher convention (`detect-changes`, `install-hooks`). The `COMMANDS` map is flat — colons add no namespacing today.
- [2026-05-18] No `ajv`. Hand-rolled validator returning `string[]`. Required by the zero-runtime-dep policy in CLAUDE.md.
- [2026-05-18] `async scan()` per the issue spec. `fs.promises.readdir` is the natural fit.
- [2026-05-18] Duplicate slug across files → last-write-wins with a stderr warning (not a throw). Issue spec says "may want to throw in v1.x; for v1.0.0 last-wins is fine."
- [2026-05-18] Dependency version conflict in `collectDependencies` → last-write-wins with a stderr warning. Issue spec says "warn via stderr if conflicts detected."
- [2026-05-18] Validate CLI does not consume `spinner` or `CancelledError` on this branch — plain `process.stdout.write` / `process.stderr.write`. The CLI shape is structured to make later UI-kit integration a localised diff in `runCli` (wrap the `await registry.scan()` call in spinner.start/succeed/fail; add a CancelledError catch above the generic catch).
- [2026-05-18] `wizard_step` accepts `undefined` (treated as absent / null-equivalent) in addition to the four spec values. Spec says "or null" but allowing undefined matches "wizard_step is optional" behaviour without breaking valid omissions.
- [2026-05-18] CLI dispatcher refactored: `main(argv)` is now `async` and always returns `Promise<number>`. The shim awaits via `.then(process.exit, errorHandler)` with no branching. Subcommands may return either `number` or `Promise<number>` — `async` awaits both transparently. Reason: this branch added the first async subcommand (`scaffolds-validate`); the original sync-only contract leaked a `number | Promise<number>` union into the shim and every test. Forwards-compatible — existing sync subcommands (`detect-changes`, `install-hooks`) need no changes. Side-benefit: sync throws from any subcommand now surface as `wp-tooling: unexpected failure (...)` instead of raw Node stack traces.
- [2026-05-18] No `--dry-run` flag on `scaffolds-validate`. The command is read-only — it scans and reports, never writes. A degenerate "skip the work" dry-run let invalid scaffolds pass CI silently (bug in the first implementation). The flag is rejected as an unknown argument so CI scripts that pass it blindly fail loudly (exit 2) rather than silently passing. CLAUDE.md's "every CLI supports `--dry-run`" rule is taken to apply to commands with side effects.
- [2026-05-18] `scan()` updates `this.scaffolds` atomically. Build into a local `nextScaffolds`; assign on success. On parse or validation failure, `this.scaffolds` is unchanged (callers can inspect prior good state). On ENOENT (missing dir), `this.scaffolds` is cleared so `all()` matches the empty array `scan()` returns. Original implementation mutated incrementally, leaving stale entries from prior scans when a re-scan failed, found fewer files, or hit a now-missing dir. Three regression tests added (registry.test.js): re-scan-removes-stale, re-scan-against-missing-dir-clears, re-scan-throws-preserves-prior-state.
- [2026-05-18] Dependency-map value validation tightened. The five dependency maps (`npm_dependencies`, `npm_dev_dependencies`, `composer_dependencies`, `composer_dev_dependencies`, `composer_suggest`) now require each value to be a non-empty string version range. Numbers, nulls, arrays, and empty strings produce a clear per-entry error: `<map>["<pkg>"] must be a non-empty version range string, got <value>`. The validator does not semantically check the version range itself (that is npm/composer's job) — only that it is a non-empty string. Five test.each cases for non-string values across all five maps; one happy-path test for `@dev` (composer's branch marker, valid).
- [2026-05-20] Rebased onto the dispatcher auto-discovery refactor on `v1.0.0/task/detect-changes`. The `scaffolds-validate` registration moved from an edit on `src/cli/index.js` (old hardcoded `COMMANDS` map) into a new `src/cli/commands/scaffolds-validate.js` exporting `{ name, summary, run }`. The async upgrade to `main()` and the bin shim's `.then(process.exit, errorHandler)` carry over unchanged. The auto-discovery loader happily registers sync and async subcommand modules side-by-side. Final tree: 118 tests, lint clean.
- [2026-05-20] Rebased again onto the current `v1.0.0/task/detect-changes` tip (post-TTY-UI-Kit merge + perf refactor). Used `git rebase --onto v1.0.0/task/detect-changes f79aa73 v1.0.0/task/scaffold-registry` to drop the 5 stale pre-rebase detect-changes commits the previous rebase had left behind. Only the 4 scaffold-specific commits replay on the new base. Single conflict resolved by hand. Final tree on the new base: 193 tests, lint clean, base tree byte-identical to detect-changes tip.
- [2026-05-20] Layered the TTY UI Kit integration into `scaffolds-validate` now that the UI kit lives on the parent branch (per the deferred decision logged on 2026-05-18). Localised diff inside `runCli`: import `spinner` and `CancelledError` from `'../ui'`, wrap `await registry.scan()` in `spinner.start()` / `succeed()` / `fail()`, and catch `CancelledError` separately to return 130. The success line is now emitted by `spinner.succeed("<count> scaffolds valid")` instead of a bare `process.stdout.write`. Non-TTY behaviour is preserved automatically by the spinner's `isTTY()` branch (plain text fallback). The existing CLI tests passed unchanged — their regex assertions (`/3 scaffolds valid/`, `/0 scaffolds valid/`, `/scaffolds-validate:/`) all match the new spinner output (`+ 3 scaffolds valid`, `x Validation failed` on stdout + the existing stderr error line) without modification. `CancelledError` is defensive: no current code path in the validate flow surfaces it (we use only `spinner`, not any prompt), but catching here makes the CLI compliant with the project-wide Ctrl+C → exit 130 contract should a future prompt be added.

---

## Files changed so far

- `.claude/issues/2-scaffold-registry.md` — new
- `src/scaffolds/schema.js` — new
- `src/scaffolds/validate.js` — new
- `src/scaffolds/registry.js` — new
- `src/scaffolds/cli.js` — new (now wraps `await registry.scan()` in `spinner` from `'../ui'`; catches `CancelledError` → return 130)
- `src/scaffolds/index.js` — edited (replace stub)
- `src/cli/commands/scaffolds-validate.js` — new (dispatcher auto-discovery registration; no edit to `src/cli/index.js`)
- `src/cli/index.js` — edited (async `main`; auto-discovery already in place from detect-changes refactor)
- `bin/wp-tooling.js` — edited (await `main()` and surface unhandled rejections cleanly)
- `tests/scaffolds/fixtures/modules/cache/scaffold.json` — new
- `tests/scaffolds/fixtures/blocks/dynamic/scaffold.json` — new
- `tests/scaffolds/fixtures/integrations/algolia/scaffold.json` — new
- `tests/scaffolds/fixtures-malformed/scaffold.json` — new
- `tests/scaffolds/validate.test.js` — new
- `tests/scaffolds/registry.test.js` — new
- `tests/scaffolds/cli.test.js` — new
- `tests/cli/index.test.js` — edited (await every `main()` call after async upgrade)
- `CHANGELOG.md` — edited

---

## Verification run

```bash
❯ npm run check

> @rtcamp/wp-tooling@0.1.0 check
> npm run lint && npm test


> @rtcamp/wp-tooling@0.1.0 lint
> eslint src tests


> @rtcamp/wp-tooling@0.1.0 test
> jest

 PASS  tests/cli/index.test.js
  cli main()
    ✓ no args prints top-level usage and exits 0 (1 ms)
    ✓ --help prints top-level usage
    ✓ -h prints top-level usage
    ✓ --version prints package version and exits 0
    ✓ -v prints package version
    ✓ unknown top-level flag exits 2 with stderr message
    ✓ unknown subcommand exits 2 with stderr message
    ✓ routes detect-changes --help to its runCli (2 ms)
    ✓ routes detect-changes through to its runCli with args (1 ms)
    ✓ detect-changes propagates a usage-error exit code
  cli COMMANDS registry
    ✓ detect-changes is registered with a summary and run handler
  cli loadCommands()
    ✓ discovers a valid command module and indexes it by name (39 ms)
    ✓ ignores non-.js files in the commands directory (2 ms)
    ✓ throws a clear error when a module is missing required fields (7 ms)
    ✓ throws when two modules register the same name (4 ms)
    ✓ returns entries in deterministic (sorted) order (6 ms)

 PASS  tests/scaffolds/registry.test.js
  ScaffoldRegistry.scan()
    ✓ discovers scaffolds at any depth and populates by slug (5 ms)
    ✓ returns an empty array for a missing directory (1 ms)
    ✓ returns an empty array for a directory with no scaffold.json
    ✓ throws with file path on validation failure (4 ms)
    ✓ throws with file path on JSON parse failure (1 ms)
    ✓ duplicate slug warns to stderr and last write wins (1 ms)
    ✓ re-scan replaces state -- removed files are no longer present (1 ms)
    ✓ re-scan against now-missing dir clears prior state (1 ms)
    ✓ re-scan that throws leaves prior state intact (atomic) (1 ms)
  ScaffoldRegistry.filter()
    ✓ object shorthand matches by strict equality
    ✓ object shorthand with multiple keys must all match
    ✓ function predicate works (1 ms)
    ✓ throws TypeError on invalid predicate
  ScaffoldRegistry.collectDependencies()
    ✓ merges the five dependency maps across the selected scaffolds
    ✓ ignores unknown slugs silently
    ✓ returns the empty shape for no slugs
    ✓ version conflict warns to stderr; last write wins

 PASS  tests/ci/detect-changes.test.js
  detectChanges
    ✓ counts files into the right buckets
    ✓ default ignore excludes docs and .wordpress-org
    ✓ default ignore preserves .github/workflows and .github/actions
    ✓ lockfile changes count under both css and js buckets
    ✓ phpstan.neon and phpstan.neon.dist count as php
    ✓ composer.json and composer.lock count as php
    ✓ string --ignore overrides the default
    ✓ RegExp --ignore is accepted directly
    ✓ null ignore disables filtering
    ✓ empty-string ignore disables filtering
    ✓ invalid ignore type throws TypeError (6 ms)
    ✓ accepts a newline-delimited string for files
    ✓ tolerates Windows line endings in file list
    ✓ invalid files type throws TypeError
    ✓ returns zero counts for an empty list
    ✓ gha bucket excludes nested-directory yml files outside workflows/actions
    ✓ includeFiles adds <bucket>-files arrays alongside counts (1 ms)
    ✓ includeFiles omitted leaves the result counts-only
    ✓ includeFiles preserves the same file in multiple buckets
  exports
    ✓ DEFAULT_PATTERNS has the four expected buckets (1 ms)
    ✓ DEFAULT_IGNORE matches docs/, .wordpress-org/, and .github/ non-workflow paths
  runCli
    ✓ --help prints usage and exits 0
    ✓ unknown flag exits 2 with stderr message
    ✓ invalid --output exits 2
    ✓ --files <path> with --output json prints valid JSON (1 ms)
    ✓ --output github appends key=value lines to $GITHUB_OUTPUT (1 ms)
    ✓ --output github warns to stderr when GITHUB_OUTPUT is unset
    ✓ --dry-run parses cleanly and exits 0
    ✓ --dry-run + --output github does not touch $GITHUB_OUTPUT and previews to stdout (1 ms)
    ✓ --dry-run + --output github previews even when $GITHUB_OUTPUT is unset
    ✓ text mode prints key: value lines (1 ms)
    ✓ --ignore overrides default
    ✓ missing --files path exits 1 with stderr message
    ✓ --files followed by another flag exits 2 (does not swallow the flag) (1 ms)
    ✓ --files at end of argv exits 2
    ✓ --ignore followed by another flag exits 2
    ✓ --files - is accepted as the stdin sentinel (parser does not reject lone dash)
    ✓ --include-files in json mode emits <bucket>-files arrays
    ✓ --include-files in text mode prints space-joined paths (1 ms)
    ✓ --include-files in github mode writes heredoc multi-line outputs
    ✓ --include-files dry-run previews heredoc blocks without writing (1 ms)
    ✓ invalid --ignore regex exits 2 with a clean usage error

 PASS  tests/ui/selects.test.js
  checkbox (non-TTY)
    ✓ should return selected items by number (1 ms)
    ✓ should return unique selections in display order
    ✓ should handle empty input gracefully
  radio (non-TTY)
    ✓ should return a single selected item
    ✓ should default to first choice on invalid input
  flat select validation
    ✓ should throw when checkbox choices is missing (4 ms)
    ✓ should throw when radio choices is empty
  flat select (TTY) -- Ctrl+C
    ✓ should reject with CancelledError on Ctrl+C (1 ms)
  checkboxTree (non-TTY)
    ✓ should return selected items from groups by number (1 ms)
    ✓ should return unique selections in display order
    ✓ should handle empty selection
    ✓ should throw when groups is missing (1 ms)
    ✓ should throw when groups is null
    ✓ should throw when a group items is not an array
    ✓ should return an empty array for empty groups without prompting (1 ms)
  checkboxTree (TTY)
    ✓ should resolve selections in display order, not toggle order
    ✓ should reject with CancelledError on Ctrl+C

 PASS  tests/scaffolds/cli.test.js
  scaffolds-validate parseArgs()
    ✓ parses --help (1 ms)
    ✓ parses a positional dir
    ✓ throws on unknown flag (3 ms)
    ✓ rejects --dry-run as unknown (read-only command)
    ✓ throws on a second positional
  scaffolds-validate runCli()
    ✓ --help prints usage and returns 0
    ✓ missing <dir> returns 2 with stderr usage hint
    ✓ unknown flag returns 2 (1 ms)
    ✓ --dry-run returns 2 (read-only command, flag not supported)
    ✓ valid fixtures return 0 with count line (2 ms)
    ✓ missing directory returns 0 with zero count
    ✓ malformed fixture returns 1 with file path in stderr (1 ms)
  cli dispatcher routes scaffolds-validate
    ✓ COMMANDS map contains scaffolds-validate
    ✓ main() routes scaffolds-validate --help and resolves 0

 PASS  tests/ui/terminal.test.js
  ANSI
    ✓ should expose the expected escape sequences
  isTTY
    ✓ should return true when stdout is a TTY
    ✓ should return false when stdout is not a TTY (1 ms)
  write / writeLine
    ✓ should write text without appending a newline
    ✓ should append a newline when writeLine is called
    ✓ should default writeLine to an empty line (1 ms)
  clearLine
    ✓ should write clear-line + carriage return when stdout is a TTY
    ✓ should write nothing when stdout is not a TTY
  moveCursorUp
    ✓ should emit the move-up escape when n > 0 in a TTY
    ✓ should not write anything when n is 0
    ✓ should not write anything in non-TTY
  hideCursor / showCursor
    ✓ should write the hide/show sequences in a TTY
    ✓ should write nothing in non-TTY
  readLine -- TTY mode
    ✓ should resolve with the typed answer
    ✓ should reject with CancelledError on SIGINT
    ✓ should resolve empty when closed without an answer or cancellation
  readLine -- non-TTY mode
    ✓ should buffer lines from stdin and resolve in order (1 ms)
    ✓ should resolve queued waiters with an empty string when stdin closes
    ✓ should resolve immediately with an empty string after stdin has closed
    ✓ should buffer lines that arrive before a reader is waiting
  onKeypress
    ✓ should return a no-op cleanup in non-TTY
    ✓ should wire up keypress events on stdin in a TTY and clean them up (1 ms)
    ✓ should skip setRawMode when stdin does not support it

 PASS  tests/ui/prompts.test.js
  text
    ✓ should return the user input (1 ms)
    ✓ should return defaultValue when input is empty
    ✓ should trim whitespace from input
    ✓ should retry when validation fails
    ✓ should accept a string message shortcut
    ✓ should propagate CancelledError from readLine (3 ms)
  confirm
    ✓ should return true for "y"
    ✓ should return true for "yes"
    ✓ should return false for "n"
    ✓ should return defaultValue on empty input
    ✓ should default to false when no defaultValue
    ✓ should accept a string message shortcut
    ✓ should propagate CancelledError from readLine
  password
    ✓ should fall back to readLine in non-TTY
    ✓ should accept a string message shortcut
    ✓ should reject with CancelledError on Ctrl+C (1 ms)

 PASS  tests/scaffolds/validate.test.js
  validate()
    ✓ returns [] for a fully valid scaffold
    ✓ returns [] for a valid source:package scaffold with empty files
    ✓ returns [] when wizard_step is omitted (1 ms)
    ✓ returns [] when wizard_step is explicit null
    ✓ rejects non-object input
    ✓ flags missing required field "slug"
    ✓ flags missing required field "name"
    ✓ flags missing required field "description"
    ✓ flags missing required field "source"
    ✓ flags missing required field "files" (1 ms)
    ✓ rejects non-kebab slug
    ✓ rejects unknown source
    ✓ rejects unknown wizard_step
    ✓ rejects non-array files
    ✓ rejects file entries missing src
    ✓ rejects file entries missing dest
    ✓ rejects non-string slug
    ✓ rejects non-string module_class
    ✓ rejects non-object dependency map
    ✓ rejects non-string version range in npm_dependencies
    ✓ rejects non-string version range in npm_dev_dependencies
    ✓ rejects non-string version range in composer_dependencies
    ✓ rejects non-string version range in composer_dev_dependencies (1 ms)
    ✓ rejects non-string version range in composer_suggest
    ✓ rejects empty-string version range
    ✓ rejects null version range
    ✓ rejects array version range
    ✓ accepts valid composer @dev marker
    ✓ every error message is prefixed with the source path

 PASS  tests/ui/wizard.test.js
  Wizard
    ✓ should run all steps in order
    ✓ should honour the skip() predicate
    ✓ should pass context to skip()
    ✓ should default context to empty object
    ✓ should default steps to empty array
    ✓ should handle an empty steps array
    ✓ should throw a clear error when steps is not an array (3 ms)
    ✓ should omit ANSI formatting in non-TTY mode
    ✓ should propagate step errors

 PASS  tests/ui/spinner.test.js
  spinner
    ✓ should return an object with start, succeed, fail, update methods
    ✓ should default to current text when succeed is called without args (1 ms)
    non-TTY mode
      ✓ should print plain text on start in non-TTY (1 ms)
      ✓ should print succeed message in non-TTY
      ✓ should print fail message in non-TTY
    TTY mode
      ✓ should animate frames on an interval (1 ms)
      ✓ should not create multiple intervals when start is called twice
      ✓ should stop animation on succeed
      ✓ should stop animation on fail
      ✓ should update text while running

Test Suites: 10 passed, 10 total
Tests:       193 passed, 193 total
Snapshots:   0 total
Time:        0.352 s, estimated 1 s
Ran all test suites.

❯ node -e "
const { ScaffoldRegistry } = require('./src/scaffolds');
const r = new ScaffoldRegistry('./tests/scaffolds/fixtures');
r.scan().then(() => console.log(r.all().length, 'scaffolds found'));
"
3 scaffolds found

❯ node bin/wp-tooling.js scaffolds-validate ./tests/scaffolds/fixtures
+ 3 scaffolds valid

❯ node bin/wp-tooling.js scaffolds-validate ./tests/scaffolds/fixtures-malformed
x Validation failed
scaffolds-validate: tests/scaffolds/fixtures-malformed/scaffold.json: missing required field "source"
tests/scaffolds/fixtures-malformed/scaffold.json: slug must be kebab-case, got "Broken_Slug"
tests/scaffolds/fixtures-malformed/scaffold.json: files must be an array (use [] for source: package)

❯ node bin/wp-tooling.js scaffolds-validate /does/not/exist
+ 0 scaffolds valid
```

---

## Open questions

- _(none yet)_

---

## Notes for the reviewer

- TTY UI kit integration landed in this same PR. `runCli` wraps `await registry.scan()` with `spinner.start()` / `succeed()` / `fail()` and catches `CancelledError` separately (returns 130). The earlier "deliberately deferred" decision (2026-05-18) is superseded by the 2026-05-20 entry — kept in the log for the design-evolution trail, not because the deferral still applies.
- `wizard_step` undefined vs null vs missing — all three resolve to "not a wizard step." The filter helpers in consumer wizards will use `wizard_step: 'modules'` etc., which matches the explicit-string case only. Confirm this matches the wizard-step contract before next sprint locks it in.

---

## Handoff log

_(no rotations yet — delete this line when the first entry is added)_
