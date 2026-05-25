# Issue #8 — Release scripts (bump, changelog, zip)

**Status:** in-progress
**Branch:** `v1.0.0/task/release-scripts`
**PR:** _(not opened yet)_
**Assignee:** @Adi-ty

---

## Summary

Every consuming skeleton needs the same release flow: bump the version,
move `## Unreleased` notes into a dated section, build assets, run a
`.distignore`-aware zip. These three scripts live in `wp-tooling` and
are exposed as auto-discovered `wp-tooling` subcommands so a release in
any consuming repo is a one-command operation per stage:

```
"scripts": {
    "release:bump":      "wp-tooling release:bump",
    "release:changelog": "wp-tooling release:changelog",
    "release:zip":       "wp-tooling release:zip"
}
```

Zero runtime deps — hand-rolled zip writer using Node's built-in
`zlib`, same trade-off as the ScaffoldRegistry's hand-rolled
validator. Git tagging and GitHub Release publishing are explicitly
out of scope (they live in the CD workflow).

---

## Decisions made

- [2026-05-20] **Branched off `v1.0.0/task/detect-changes`** rather than
  `release/v1.0.0`. The release CLIs need the auto-discovery dispatcher
  established in #7 (`src/cli/index.js` + `src/cli/commands/<name>.js`).
  Stacking on detect-changes follows the established pattern that
  `scaffold-registry` and `git-hooks` use; once #7 merges, a rebase
  onto `release/v1.0.0` is conflict-free.
- [2026-05-20] **Subcommand naming: kebab-case, not colon-prefixed.**
  Initial decision was `release-bump` / `release-changelog` /
  `release-zip` for consistency with `detect-changes` and
  `install-hooks`. The skeleton's `package.json` would keep the
  human-facing `release:bump` colon style via npm-script aliases.
- [2026-05-22] **Reversed the above: colon-prefixed family names.**
  Renamed to `release:bump` / `release:changelog` / `release:zip`.
  The dispatcher matches on `mod.name`, not the filename, so the
  switch only touches the exported `name:` field plus docstrings,
  usage text, error prefixes and tests. Filenames stay
  `release-bump.js` etc. because NTFS reserves `:` in paths.
  Rationale: the family is genuinely a namespace (more siblings
  likely later such as `release:tag` / `release:publish`); colon-
  namespaced commands match the WordPress audience's expectations
  from Composer scripts, Symfony Console, Laravel Artisan and rake;
  and the skeleton's npm-script aliases now map 1:1 instead of
  translating hyphens to colons. `detect-changes` and
  `install-hooks` stay hyphenated because they are one-offs, not
  families.
- [2026-05-20] **No new `bin/wp-tooling-release.js` dispatcher.** The
  spec text predates the auto-discovery dispatcher; the equivalent
  today is three files under `src/cli/commands/`. The single
  `bin/wp-tooling.js` shim continues to be the only `bin/` entry.
- [2026-05-20] **All three CLIs implement `--dry-run`** per the
  CLAUDE.md non-negotiable. The issue spec doesn't mention it. For
  bump it prints the would-be changes without touching files; for
  changelog it prints the new headings without rewriting the file;
  for zip it lists the file plan without writing to disk.

---

## Files changed so far

- `.claude/issues/8-release-scripts.md` — new
- `src/release/context.js` — new (shared loader: package.json, composer.json, plugin entry detection)
- `src/release/bump.js` — new (version bump library + helpers)
- `src/release/changelog.js` — new (CHANGELOG finaliser library + helpers)
- `src/release/zip.js` — new (`.distignore`-aware packager with hand-rolled zip writer, CRC-32 and DOS time/date encoding)
- `src/release/index.js` — edited (barrel exports for the three libraries plus context helpers)
- `src/cli/commands/release-bump.js` — new (dispatcher entry; argv parsing, spinner, exit codes)
- `src/cli/commands/release-changelog.js` — new (dispatcher entry)
- `src/cli/commands/release-zip.js` — new (dispatcher entry)
- `tests/release/_helpers.js` — new (copyFixture / cleanup helpers)
- `tests/release/context.test.js` — new (9 tests)
- `tests/release/bump.test.js` — new (19 tests: helpers + integration)
- `tests/release/changelog.test.js` — new (13 tests)
- `tests/release/zip.test.js` — new (21 tests: helpers, walkProject, integration, determinism)
- `tests/release/cli.test.js` — new (18 tests: dispatcher registration, parseArgs, runCli)
- `tests/release/fixtures/plugin-a/...` — new (sample plugin tree: entry PHP, package.json, composer.json, CHANGELOG, .distignore, src/, tests-dir/, node_modules/, webpack.config.js)
- `CHANGELOG.md` — edited (Unreleased entry covering the three subcommands and the hand-rolled zip writer)

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

 PASS  tests/release/cli.test.js
  release CLIs - dispatcher registration
    ✓ release-bump is registered (1 ms)
    ✓ release-changelog is registered
    ✓ release-zip is registered (1 ms)
  release CLIs - parseArgs
    ✓ release-bump parses --type, --to, --dry-run, --help (1 ms)
    ✓ release-bump rejects unknown args (4 ms)
    ✓ release-changelog parses --to, --dry-run, --help
    ✓ release-zip parses --force, --dry-run, --help
  release CLIs - runCli help
    ✓ release-bump --help prints usage and returns 0
    ✓ release-changelog --help prints usage and returns 0
    ✓ release-zip --help prints usage and returns 0
    ✓ release-bump unknown arg returns 2
  release CLIs - runCli end-to-end against fixture
    ✓ release-bump --type patch updates files and returns 0 (5 ms)
    ✓ release-bump --dry-run does not modify files (4 ms)
    ✓ release-bump exits 1 when plugin entry missing (2 ms)
    ✓ release-changelog rewrites CHANGELOG and returns 0 (3 ms)
    ✓ release-changelog exits 1 on empty Unreleased (3 ms)
    ✓ release-zip writes dist/<slug>-<version>.zip and returns 0 (17 ms)
    ✓ release-zip refuses to overwrite without --force (20 ms)

 PASS  tests/cli/index.test.js
  cli main()
    ✓ no args prints top-level usage and exits 0 (1 ms)
    ✓ --help prints top-level usage
    ✓ -h prints top-level usage
    ✓ --version prints package version and exits 0 (1 ms)
    ✓ -v prints package version
    ✓ unknown top-level flag exits 2 with stderr message
    ✓ unknown subcommand exits 2 with stderr message
    ✓ routes detect-changes --help to its runCli (2 ms)
    ✓ routes detect-changes through to its runCli with args (1 ms)
    ✓ detect-changes propagates a usage-error exit code
  cli COMMANDS registry
    ✓ detect-changes is registered with a summary and run handler
  cli loadCommands()
    ✓ discovers a valid command module and indexes it by name (37 ms)
    ✓ ignores non-.js files in the commands directory (3 ms)
    ✓ throws a clear error when a module is missing required fields (5 ms)
    ✓ throws when two modules register the same name (4 ms)
    ✓ returns entries in deterministic (sorted) order (6 ms)

 PASS  tests/release/bump.test.js
  release/bump - pure helpers
    ✓ nextVersion patch
    ✓ nextVersion minor zeros patch
    ✓ nextVersion major zeros minor + patch
    ✓ nextVersion explicit override wins
    ✓ nextVersion rejects malformed current (5 ms)
    ✓ nextVersion rejects malformed explicit
    ✓ nextVersion rejects unknown type
    ✓ slugToConstantPrefix converts kebab to UPPER_SNAKE (1 ms)
    ✓ rewritePluginEntry rewrites Version header and constant value
    ✓ rewritePluginEntry also rewrites const-style constants
    ✓ rewriteJsonVersion preserves a 2-space indent (1 ms)
    ✓ rewriteJsonVersion returns null when version key absent
  release/bump - integration against fixture
    ✓ patch bump updates package.json, composer.json, plugin entry, constant (4 ms)
    ✓ --to overrides --type (4 ms)
    ✓ dry-run does not write any file (5 ms)
    ✓ composer.json without version is left untouched (3 ms)
    ✓ throws when plugin entry has no Version header (3 ms)
    ✓ exits non-zero (via thrown error) when plugin entry is missing (3 ms)
    ✓ rejects a malformed config.constantPrefix (3 ms)
    ✓ config.constantPrefix overrides the slug-derived constant name (6 ms)

 PASS  tests/release/zip.test.js
  release/zip - helpers
    ✓ crc32 matches known vectors
    ✓ dosTimeDate encodes a known epoch (1 ms)
    ✓ dosTimeDate clamps year >= 1980
    ✓ compileIgnorePattern returns null for comments and blanks
    ✓ compileIgnorePattern matches a simple filename
    ✓ compileIgnorePattern with trailing / matches directories only
    ✓ compileIgnorePattern with single * does not cross /
    ✓ compileIgnorePattern with ** crosses /
    ✓ loadIgnorePatterns falls back to defaults when no .distignore (1 ms)
    ✓ resolveEpoch honours SOURCE_DATE_EPOCH env var
    ✓ resolveEpoch honours explicit option over env
    ✓ FALLBACK_EPOCH is exposed and stable
  release/zip - walkProject
    ✓ honours .distignore and skips .git / dist always (3 ms)
  release/zip - integration
    ✓ builds dist/<slug>-<version>.zip and excludes per .distignore (4 ms)
    ✓ two runs against the same tree produce byte-identical zips (3 ms)
    ✓ refuses to overwrite existing zip without --force (9 ms)
    ✓ overwrites existing zip when --force is set (3 ms)
    ✓ dryRun does not write dist/ (3 ms)
    ✓ default ignore list excludes node_modules when .distignore absent (3 ms)
    ✓ zipPack round-trips a single entry through DEFLATE (1 ms)

 PASS  tests/release/context.test.js
  release/context
    ✓ findPluginEntry returns the *.php with Plugin Name header (3 ms)
    ✓ findPluginEntry throws when no entry file is present (5 ms)
    ✓ findPluginEntry throws when multiple entry files exist at root (2 ms)
    ✓ findPluginEntry ignores nested *.php with Plugin Name header (3 ms)
    ✓ loadContext returns the full project shape (3 ms)
    ✓ loadContext sets composerJson to null when composer.json is absent (2 ms)
    ✓ loadContext throws when package.json is missing (3 ms)
    ✓ loadContext throws when package.json has no version field (3 ms)
    ✓ loadContext propagates a malformed package.json error (2 ms)

 PASS  tests/release/changelog.test.js
  release/changelog - pure helpers
    ✓ isoDate formats UTC date as YYYY-MM-DD (1 ms)
    ✓ unreleasedHasContent detects bullets
    ✓ unreleasedHasContent detects plain paragraph content
    ✓ unreleasedHasContent rejects empty Unreleased
    ✓ unreleasedHasContent rejects subheadings without bullets
    ✓ rewriteChangelog renames heading + prepends fresh Unreleased
    ✓ rewriteChangelog throws when Unreleased missing (4 ms)
    ✓ rewriteChangelog throws when Unreleased is empty
  release/changelog - integration against fixture
    ✓ reads version from package.json by default (3 ms)
    ✓ --to overrides package.json version (2 ms)
    ✓ dryRun leaves CHANGELOG unchanged (3 ms)
    ✓ refuses to run when Unreleased is empty (3 ms)
    ✓ throws when CHANGELOG.md is missing (3 ms)
    ✓ throws on malformed semver passed via --to (2 ms)

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
    ✓ tolerates Windows line endings in file list (1 ms)
    ✓ invalid files type throws TypeError
    ✓ returns zero counts for an empty list
    ✓ gha bucket excludes nested-directory yml files outside workflows/actions
    ✓ includeFiles adds <bucket>-files arrays alongside counts
    ✓ includeFiles omitted leaves the result counts-only (1 ms)
    ✓ includeFiles preserves the same file in multiple buckets
  exports
    ✓ DEFAULT_PATTERNS has the four expected buckets
    ✓ DEFAULT_IGNORE matches docs/, .wordpress-org/, and .github/ non-workflow paths
  runCli
    ✓ --help prints usage and exits 0
    ✓ unknown flag exits 2 with stderr message
    ✓ invalid --output exits 2
    ✓ --files <path> with --output json prints valid JSON (1 ms)
    ✓ --output github appends key=value lines to $GITHUB_OUTPUT (1 ms)
    ✓ --output github warns to stderr when GITHUB_OUTPUT is unset (3 ms)
    ✓ --dry-run parses cleanly and exits 0
    ✓ --dry-run + --output github does not touch $GITHUB_OUTPUT and previews to stdout (1 ms)
    ✓ --dry-run + --output github previews even when $GITHUB_OUTPUT is unset
    ✓ text mode prints key: value lines (1 ms)
    ✓ --ignore overrides default
    ✓ missing --files path exits 1 with stderr message
    ✓ --files followed by another flag exits 2 (does not swallow the flag)
    ✓ --files at end of argv exits 2 (1 ms)
    ✓ --ignore followed by another flag exits 2
    ✓ --files - is accepted as the stdin sentinel (parser does not reject lone dash)
    ✓ --include-files in json mode emits <bucket>-files arrays
    ✓ --include-files in text mode prints space-joined paths (1 ms)
    ✓ --include-files in github mode writes heredoc multi-line outputs
    ✓ --include-files dry-run previews heredoc blocks without writing (1 ms)
    ✓ invalid --ignore regex exits 2 with a clean usage error (1 ms)

 PASS  tests/ui/selects.test.js
  checkbox (non-TTY)
    ✓ should return selected items by number
    ✓ should return unique selections in display order
    ✓ should handle empty input gracefully
  radio (non-TTY)
    ✓ should return a single selected item
    ✓ should default to first choice on invalid input
  flat select validation
    ✓ should throw when checkbox choices is missing (5 ms)
    ✓ should throw when radio choices is empty
  flat select (TTY) -- Ctrl+C
    ✓ should reject with CancelledError on Ctrl+C (1 ms)
  checkboxTree (non-TTY)
    ✓ should return selected items from groups by number
    ✓ should return unique selections in display order
    ✓ should handle empty selection
    ✓ should throw when groups is missing (2 ms)
    ✓ should throw when groups is null
    ✓ should throw when a group items is not an array
    ✓ should return an empty array for empty groups without prompting
  checkboxTree (TTY)
    ✓ should resolve selections in display order, not toggle order (1 ms)
    ✓ should reject with CancelledError on Ctrl+C

 PASS  tests/ui/terminal.test.js
  ANSI
    ✓ should expose the expected escape sequences
  isTTY
    ✓ should return true when stdout is a TTY (1 ms)
    ✓ should return false when stdout is not a TTY
  write / writeLine
    ✓ should write text without appending a newline
    ✓ should append a newline when writeLine is called (3 ms)
    ✓ should default writeLine to an empty line
  clearLine
    ✓ should write clear-line + carriage return when stdout is a TTY
    ✓ should write nothing when stdout is not a TTY
  moveCursorUp
    ✓ should emit the move-up escape when n > 0 in a TTY
    ✓ should not write anything when n is 0
    ✓ should not write anything in non-TTY
  hideCursor / showCursor
    ✓ should write the hide/show sequences in a TTY (1 ms)
    ✓ should write nothing in non-TTY
  readLine -- TTY mode
    ✓ should resolve with the typed answer
    ✓ should reject with CancelledError on SIGINT
    ✓ should resolve empty when closed without an answer or cancellation (1 ms)
  readLine -- non-TTY mode
    ✓ should buffer lines from stdin and resolve in order
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
    ✓ should accept a string message shortcut (1 ms)
    ✓ should reject with CancelledError on Ctrl+C (1 ms)

 PASS  tests/ui/wizard.test.js
  Wizard
    ✓ should run all steps in order
    ✓ should honour the skip() predicate
    ✓ should pass context to skip()
    ✓ should default context to empty object
    ✓ should default steps to empty array
    ✓ should handle an empty steps array
    ✓ should throw a clear error when steps is not an array (2 ms)
    ✓ should omit ANSI formatting in non-TTY mode
    ✓ should propagate step errors

 PASS  tests/ui/spinner.test.js
  spinner
    ✓ should return an object with start, succeed, fail, update methods (1 ms)
    ✓ should default to current text when succeed is called without args
    non-TTY mode
      ✓ should print plain text on start in non-TTY
      ✓ should print succeed message in non-TTY
      ✓ should print fail message in non-TTY (1 ms)
    TTY mode
      ✓ should animate frames on an interval
      ✓ should not create multiple intervals when start is called twice
      ✓ should stop animation on succeed (1 ms)
      ✓ should stop animation on fail
      ✓ should update text while running

Test Suites: 12 passed, 12 total
Tests:       214 passed, 214 total
Snapshots:   0 total
Time:        0.545 s, estimated 1 s
Ran all test suites.
```

---

## Open questions

- _(none yet)_

---

## Notes for the reviewer

- The hand-rolled zip writer is ~100 lines using `zlib.deflateRawSync` +
  CRC32 + standard local file headers and central directory records.
  This is the same trade-off documented for the ScaffoldRegistry's
  hand-rolled validator — keeps the dependency-free guarantee, costs
  a small amount of complexity in one isolated module.
- Determinism for the zip: entries are sorted lexicographically,
  mtimes pinned (either to `git log -1 --format=%ct` of the current
  commit, or a fixed epoch when not in a git checkout). Verified via
  `sha256sum` matching across two consecutive runs in the tests.

---

## Handoff log

_(no rotations yet — delete this line when the first entry is added)_
