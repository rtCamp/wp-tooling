# Issue #10 — Add Version Monitor scripts

**Status:** in-progress
**Branch:** `v1.0.0/task/version-monitor-scripts`
**PR:** #<pr-number>
**Assignee:** @Adi-ty

---

## Summary

Composer dependencies are bumped by Dependabot; everything else (npm packages with custom resolvers, GitHub Actions, PHP target, Node target, WP-CLI, container base images) is not. The Version Monitor is a monthly scheduled job that detects updates across those sources and opens a draft PR per repo with the bump applied. The scripts live here in `wp-tooling` and are invoked by the Version Monitor reusable workflow in `wp-shared-workflows`. Splitting scripts (here) from workflow (there) keeps the YAML thin and makes the scripts unit-testable. Deliverable: six detectors + a config loader + an updater + a reporter, all driven through one CLI subcommand.

---

## Decisions made

- [2026-05-26] CLI shipped as a `version-monitor` subcommand under the existing auto-discovering dispatcher (`src/cli/commands/version-monitor.js` → `require('../../version-monitor').runCli`), mirroring `detect-changes`. The issue proposed a standalone `bin/wp-tooling-version-monitor.js`; superseded — the repo has exactly one bin (`bin/wp-tooling.js`) and the convention is single-file command modules.
- [2026-05-26] `.github/version-monitor.yml` is parsed by a hand-rolled, zero-dep parser (`config.js`). The shape is small and fixed (two top-level keys, inline-flow nested maps/lists). `js-yaml` cannot be a runtime dependency under the zero-runtime-dep rule, so hand-rolling is the only compliant option.
- [2026-05-26] All detector HTTP goes through one `http.js` helper; tests `jest.mock` it. No `nock` — the repo has zero deps and every existing test mocks via `jest.mock`.
- [2026-05-26] Major bumps are detected and listed (`is_major: true`) but skipped on `--apply` unless `--allow-major`; the report shows them with a "Major bump skipped" note. Pre-releases (`-beta`/`-rc`) and npm `*`/`latest` pins are skipped at detection.
- [2026-05-26] Only `--detect` reads the config (it drives detection); `--apply` and `--report` operate purely on the JSON piped from `--detect`, so they do not require the config file. The "refuses to run if config missing" criterion applies to the `--detect` entry point.
- [2026-05-26] (Pre-PR self-verification) Issues caught while checking the code before opening the PR, all confirmed and fixed:
    1. `updater.replaceScalar` was non-global, so a workflow pinning the same value in two jobs (`node-version: 22.11.0` ×2) had only the first rewritten. Now `gm`; covered by a duplicate-pin updater test.
    2. Detector/network failures were swallowed, so `--detect` could exit 0 with empty/partial results when an API was down — a silent-failure risk for a scheduled monitor. Now hard failures (transport errors, 5xx, parse errors, a detector throwing) are recorded on a threaded `errors` collector and `--detect` exits 1 (still printing what it found). Expected conditions stay soft: GitHub rate limits and 4xx "nothing published / not found" (common for actions with no GitHub release) do not fail the run.
    3. `http.getJson` had no timeout; a hung endpoint could stall the scheduled job until the job-level timeout. Added a 10s per-request timeout that destroys the socket and rejects with a clear error.
    4. (Edge-case pass) `FROM --platform=$BUILDPLATFORM node:22` captured the flag, not the image, so that base image was silently skipped. `FROM_RE` now skips leading `--flag` tokens; covered by a multi-stage + `--platform` `collectPins` test.

---

## Files changed so far

- `.claude/issues/10-version-monitor-scripts.md` — new
- `src/version-monitor/index.js` — edited (barrel replaces stub)
- `src/version-monitor/config.js` — new
- `src/version-monitor/http.js` — new
- `src/version-monitor/semver.js` — new
- `src/version-monitor/util.js` — new
- `src/version-monitor/detect.js` — new
- `src/version-monitor/updater.js` — new
- `src/version-monitor/reporter.js` — new
- `src/version-monitor/cli.js` — new
- `src/version-monitor/detectors/{npm,actions,php,node,wp-cli,container}.js` — new
- `src/cli/commands/version-monitor.js` — new
- `tests/version-monitor/**` — new
- `CHANGELOG.md` — edited (Unreleased entry)

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

 PASS  tests/release/bump.test.js
  release/bump - pure helpers
    ✓ nextVersion patch (2 ms)
    ✓ nextVersion minor zeros patch
    ✓ nextVersion major zeros minor + patch
    ✓ nextVersion explicit override wins
    ✓ nextVersion rejects malformed current (8 ms)
    ✓ nextVersion rejects malformed explicit (1 ms)
    ✓ nextVersion rejects unknown type
    ✓ slugToConstantPrefix converts kebab to UPPER_SNAKE
    ✓ rewritePluginEntry rewrites Version header and constant value (1 ms)
    ✓ rewritePluginEntry also rewrites const-style constants
    ✓ rewriteJsonVersion preserves a 2-space indent
    ✓ rewriteJsonVersion returns null when version key absent
  release/bump - integration against fixture
    ✓ patch bump updates package.json, composer.json, plugin entry, constant (5 ms)
    ✓ --to overrides --type (5 ms)
    ✓ dry-run does not write any file (8 ms)
    ✓ composer.json without version is left untouched (10 ms)
    ✓ throws when plugin entry has no Version header (4 ms)
    ✓ exits non-zero (via thrown error) when plugin entry is missing (7 ms)
    ✓ rejects a malformed config.constantPrefix (5 ms)
    ✓ config.constantPrefix overrides the slug-derived constant name (4 ms)

 PASS  tests/release/context.test.js
  release/context
    ✓ findPluginEntry returns the *.php with Plugin Name header (9 ms)
    ✓ findPluginEntry throws when no entry file is present (12 ms)
    ✓ findPluginEntry throws when multiple entry files exist at root (7 ms)
    ✓ findPluginEntry ignores nested *.php with Plugin Name header (4 ms)
    ✓ loadContext returns the full project shape (2 ms)
    ✓ loadContext sets composerJson to null when composer.json is absent (5 ms)
    ✓ loadContext throws when package.json is missing (7 ms)
    ✓ loadContext throws when package.json has no version field (7 ms)
    ✓ loadContext propagates a malformed package.json error (7 ms)

 PASS  tests/release/zip.test.js
  release/zip - helpers
    ✓ crc32 matches known vectors (2 ms)
    ✓ dosTimeDate encodes a known epoch
    ✓ dosTimeDate clamps year >= 1980
    ✓ compileIgnorePattern returns null for comments and blanks (1 ms)
    ✓ compileIgnorePattern matches a simple filename
    ✓ compileIgnorePattern with trailing / matches directories only
    ✓ compileIgnorePattern with single * does not cross /
    ✓ compileIgnorePattern with ** crosses /
    ✓ loadIgnorePatterns falls back to defaults when no .distignore (1 ms)
    ✓ resolveEpoch honours SOURCE_DATE_EPOCH env var
    ✓ resolveEpoch honours explicit option over env
    ✓ FALLBACK_EPOCH is exposed and stable
  release/zip - walkProject
    ✓ honours .distignore and skips .git / dist always (14 ms)
  release/zip - integration
    ✓ builds dist/<slug>-<version>.zip and excludes per .distignore (10 ms)
    ✓ two runs against the same tree produce byte-identical zips (10 ms)
    ✓ refuses to overwrite existing zip without --force (23 ms)
    ✓ overwrites existing zip when --force is set (4 ms)
    ✓ dryRun does not write dist/ (4 ms)
    ✓ default ignore list excludes node_modules when .distignore absent (8 ms)
    ✓ zipPack round-trips a single entry through DEFLATE (1 ms)

 PASS  tests/ui/prompts.test.js
  text
    ✓ should return the user input
    ✓ should return defaultValue when input is empty
    ✓ should trim whitespace from input (1 ms)
    ✓ should retry when validation fails
    ✓ should accept a string message shortcut
    ✓ should propagate CancelledError from readLine (6 ms)
  confirm
    ✓ should return true for "y"
    ✓ should return true for "yes" (1 ms)
    ✓ should return false for "n"
    ✓ should return defaultValue on empty input
    ✓ should default to false when no defaultValue
    ✓ should accept a string message shortcut (1 ms)
    ✓ should propagate CancelledError from readLine
  password
    ✓ should fall back to readLine in non-TTY
    ✓ should accept a string message shortcut
    ✓ should reject with CancelledError on Ctrl+C (3 ms)

 PASS  tests/release/changelog.test.js
  release/changelog - pure helpers
    ✓ isoDate formats UTC date as YYYY-MM-DD (4 ms)
    ✓ unreleasedHasContent detects bullets
    ✓ unreleasedHasContent detects plain paragraph content
    ✓ unreleasedHasContent rejects empty Unreleased
    ✓ unreleasedHasContent rejects subheadings without bullets (1 ms)
    ✓ rewriteChangelog renames heading + prepends fresh Unreleased
    ✓ rewriteChangelog throws when Unreleased missing (7 ms)
    ✓ rewriteChangelog throws when Unreleased is empty
  release/changelog - integration against fixture
    ✓ reads version from package.json by default (5 ms)
    ✓ --to overrides package.json version (3 ms)
    ✓ dryRun leaves CHANGELOG unchanged (9 ms)
    ✓ refuses to run when Unreleased is empty (11 ms)
    ✓ throws when CHANGELOG.md is missing (6 ms)
    ✓ throws on malformed semver passed via --to (10 ms)

 PASS  tests/ci/detect-changes.test.js
  detectChanges
    ✓ counts files into the right buckets (1 ms)
    ✓ default ignore excludes docs and .wordpress-org
    ✓ default ignore preserves .github/workflows and .github/actions
    ✓ lockfile changes count under both css and js buckets
    ✓ phpstan.neon and phpstan.neon.dist count as php
    ✓ composer.json and composer.lock count as php
    ✓ string --ignore overrides the default (1 ms)
    ✓ RegExp --ignore is accepted directly
    ✓ null ignore disables filtering (1 ms)
    ✓ empty-string ignore disables filtering
    ✓ invalid ignore type throws TypeError (16 ms)
    ✓ accepts a newline-delimited string for files (1 ms)
    ✓ tolerates Windows line endings in file list
    ✓ invalid files type throws TypeError
    ✓ returns zero counts for an empty list
    ✓ gha bucket excludes nested-directory yml files outside workflows/actions
    ✓ includeFiles adds <bucket>-files arrays alongside counts (1 ms)
    ✓ includeFiles omitted leaves the result counts-only (4 ms)
    ✓ includeFiles preserves the same file in multiple buckets (3 ms)
  exports
    ✓ DEFAULT_PATTERNS has the four expected buckets
    ✓ DEFAULT_IGNORE matches docs/, .wordpress-org/, and .github/ non-workflow paths
  runCli
    ✓ --help prints usage and exits 0 (8 ms)
    ✓ unknown flag exits 2 with stderr message (1 ms)
    ✓ invalid --output exits 2
    ✓ --files <path> with --output json prints valid JSON (4 ms)
    ✓ --output github appends key=value lines to $GITHUB_OUTPUT (3 ms)
    ✓ --output github warns to stderr when GITHUB_OUTPUT is unset (1 ms)
    ✓ --dry-run parses cleanly and exits 0
    ✓ --dry-run + --output github does not touch $GITHUB_OUTPUT and previews to stdout (1 ms)
    ✓ --dry-run + --output github previews even when $GITHUB_OUTPUT is unset (1 ms)
    ✓ text mode prints key: value lines (1 ms)
    ✓ --ignore overrides default (1 ms)
    ✓ missing --files path exits 1 with stderr message (1 ms)
    ✓ --files followed by another flag exits 2 (does not swallow the flag)
    ✓ --files at end of argv exits 2
    ✓ --ignore followed by another flag exits 2
    ✓ --files - is accepted as the stdin sentinel (parser does not reject lone dash) (1 ms)
    ✓ --include-files in json mode emits <bucket>-files arrays
    ✓ --include-files in text mode prints space-joined paths (1 ms)
    ✓ --include-files in github mode writes heredoc multi-line outputs (1 ms)
    ✓ --include-files dry-run previews heredoc blocks without writing (1 ms)
    ✓ invalid --ignore regex exits 2 with a clean usage error (1 ms)

 PASS  tests/version-monitor/updater.test.js
  applyUpdates
    ✓ rewrites each of the six source types in place (8 ms)
    ✓ skips major bumps unless allowMajor is set (7 ms)
    ✓ rewrites every occurrence of a duplicated scalar pin (3 ms)
    ✓ writes nothing on a dry run (6 ms)
    ✓ records an update whose current value is not found as unmatched (6 ms)

 PASS  tests/cli/index.test.js
  cli main()
    ✓ no args prints top-level usage and exits 0 (5 ms)
    ✓ --help prints top-level usage
    ✓ -h prints top-level usage (1 ms)
    ✓ --version prints package version and exits 0
    ✓ -v prints package version
    ✓ unknown top-level flag exits 2 with stderr message
    ✓ unknown subcommand exits 2 with stderr message (1 ms)
    ✓ routes detect-changes --help to its runCli (3 ms)
    ✓ routes detect-changes through to its runCli with args (2 ms)
    ✓ detect-changes propagates a usage-error exit code
  cli main() central error handling
    ✓ CancelledError from a subcommand exits 130 with a stderr message
    ✓ non-CancelledError rejections propagate to the bin shim (13 ms)
  cli COMMANDS registry
    ✓ detect-changes is registered with a summary and run handler
    ✓ install-hooks is registered with a summary and run handler
  cli main() routes install-hooks
    ✓ routes install-hooks --help to its runCli (2 ms)
  cli loadCommands()
    ✓ discovers a valid command module and indexes it by name (87 ms)
    ✓ ignores non-.js files in the commands directory (9 ms)
    ✓ throws a clear error when a module is missing required fields (4 ms)
    ✓ throws when two modules register the same name (10 ms)
    ✓ returns entries in deterministic (sorted) order (68 ms)

 PASS  tests/release/cli.test.js
  release CLIs - dispatcher registration
    ✓ release:bump is registered (4 ms)
    ✓ release:changelog is registered (1 ms)
    ✓ release:zip is registered
  release CLIs - parseArgs
    ✓ release:bump parses --type, --to, --dry-run, --help (2 ms)
    ✓ release:bump rejects unknown args (15 ms)
    ✓ release:changelog parses --to, --dry-run, --help (1 ms)
    ✓ release:zip parses --force, --dry-run, --help
  release CLIs - runCli help
    ✓ release:bump --help prints usage and returns 0 (1 ms)
    ✓ release:changelog --help prints usage and returns 0
    ✓ release:zip --help prints usage and returns 0 (1 ms)
    ✓ release:bump unknown arg returns 2
  release CLIs - runCli end-to-end against fixture
    ✓ release:bump --type patch updates files and returns 0 (9 ms)
    ✓ release:bump --dry-run does not modify files (11 ms)
    ✓ release:bump exits 1 when plugin entry missing (5 ms)
    ✓ release:changelog rewrites CHANGELOG and returns 0 (16 ms)
    ✓ release:changelog exits 1 on empty Unreleased (8 ms)
    ✓ release:zip writes dist/<slug>-<version>.zip and returns 0 (52 ms)
    ✓ release:zip refuses to overwrite without --force (109 ms)

 PASS  tests/version-monitor/detect.test.js
  detect orchestrator
    ✓ annotates each update with is_major (1 ms)
    ✓ runs no detector when every source is disabled
    ✓ records hard failures so the run is not silently empty
    ✓ treats a rate limit as soft (no recorded error) (1 ms)
    ✓ does not record an expected 404 as a hard failure

version-monitor: npm lookup for "lodash" failed: network down
version-monitor: npm lookup for "jest" failed: network down
version-monitor: npm lookup for "lodash" failed: rate limited
version-monitor: npm lookup for "lodash" failed: not found
version-monitor: npm lookup for "jest" failed: not found
 PASS  tests/version-monitor/http.test.js
  getJson
    ✓ resolves parsed JSON on a 2xx response (1 ms)
    ✓ sends a User-Agent and a bearer token when given one
    ✓ rejects on a non-2xx status (3 ms)
    ✓ flags rate-limit responses (1 ms)
    ✓ rejects on invalid JSON
    ✓ rejects on a transport error (1 ms)
    ✓ rejects and tears down the request on timeout
  isClientError
    ✓ is true for a non-rate-limit 4xx (1 ms)
    ✓ is false for rate limits, 5xx, and transport errors (3 ms)

 PASS  tests/ui/wizard.test.js
  Wizard
    ✓ should run all steps in order (1 ms)
    ✓ should honour the skip() predicate (1 ms)
    ✓ should pass context to skip()
    ✓ should default context to empty object (6 ms)
    ✓ should default steps to empty array
    ✓ should handle an empty steps array
    ✓ should throw a clear error when steps is not an array (4 ms)
    ✓ should omit ANSI formatting in non-TTY mode (1 ms)
    ✓ should propagate step errors (1 ms)

 PASS  tests/version-monitor/config.test.js
  parseConfigYaml
    ✓ parses inline-flow mappings and lists (1 ms)
    ✓ ignores comments and blank lines
  loadConfig
    ✓ loads and normalises the sample config (1 ms)
    ✓ throws naming the path when the config is missing (6 ms)
  validate
    ✓ defaults paths for an enabled source that omits them
    ✓ rejects an unknown source
    ✓ rejects a non-string paths entry
    ✓ rejects a missing sources mapping

 PASS  tests/ui/selects.test.js
  checkbox (non-TTY)
    ✓ should return selected items by number
    ✓ should return unique selections in display order
    ✓ should handle empty input gracefully
  radio (non-TTY)
    ✓ should return a single selected item
    ✓ should default to first choice on invalid input (1 ms)
  flat select validation
    ✓ should throw when checkbox choices is missing (6 ms)
    ✓ should throw when radio choices is empty (1 ms)
  flat select (TTY) -- Ctrl+C
    ✓ should reject with CancelledError on Ctrl+C (1 ms)
  checkboxTree (non-TTY)
    ✓ should return selected items from groups by number (1 ms)
    ✓ should return unique selections in display order
    ✓ should handle empty selection
    ✓ should throw when groups is missing (2 ms)
    ✓ should throw when groups is null (1 ms)
    ✓ should throw when a group items is not an array
    ✓ should return an empty array for empty groups without prompting
  checkboxTree (TTY)
    ✓ should resolve selections in display order, not toggle order (1 ms)
    ✓ should reject with CancelledError on Ctrl+C

 PASS  tests/version-monitor/wp-cli.test.js
  wp-cli detector
    ✓ reports an update when a newer release exists (1 ms)
    ✓ reports nothing when already on the latest release (1 ms)
    ✓ makes no request when no wp-cli version is pinned (2 ms)

 PASS  tests/version-monitor/semver.test.js
  semver.splitVersion
    ✓ separates a range prefix from the numeric core (1 ms)
    ✓ separates a v tag prefix (1 ms)
    ✓ returns an empty core for non-numeric specs
  semver.parse
    ✓ fills missing minor/patch with zero (1 ms)
    ✓ captures the pre-release tag
  semver.compareStable / gt
    ✓ ranks by major, then minor, then patch
    ✓ ignores prefixes and pre-release tags (1 ms)
  semver.isMajorBump
    ✓ is true only when the major increases
  semver.isPreRelease
    ✓ detects pre-release suffixes
  semver.formatLatest
    ✓ re-attaches the current spec prefix to the latest core (1 ms)

 PASS  tests/version-monitor/container.test.js
  container helpers
    ✓ splits image references and skips digest pins
    ✓ maps official images to library/* and rejects other registries
    ✓ picks the newest tag of the same numeric shape
    ✓ collects images past --platform flags and across multi-stage FROMs (1 ms)
  container detector
    ✓ reports updates for Dockerfile and devcontainer images
    ✓ reports nothing when the current tag is newest

 PASS  tests/ui/spinner.test.js
  spinner
    ✓ should return an object with start, succeed, fail, update methods (2 ms)
    ✓ should default to current text when succeed is called without args
    non-TTY mode
      ✓ should print plain text on start in non-TTY (1 ms)
      ✓ should print succeed message in non-TTY (1 ms)
      ✓ should print fail message in non-TTY (1 ms)
    TTY mode
      ✓ should animate frames on an interval (1 ms)
      ✓ should not create multiple intervals when start is called twice
      ✓ should stop animation on succeed (8 ms)
      ✓ should stop animation on fail
      ✓ should update text while running (1 ms)

 PASS  tests/version-monitor/cli.test.js
  runCli arg handling
    ✓ prints usage and exits 0 on --help (1 ms)
    ✓ exits 2 when no mode is given
    ✓ exits 2 on mutually exclusive modes
    ✓ exits 2 on an unknown argument
  runCli --detect
    ✓ loads config, runs detect, prints JSON (1 ms)
    ✓ exits 2 when the config is missing
    ✓ exits 1 but still prints results when a detector errored
  runCli --report / --apply (stdin)
    ✓ reads JSON from stdin and prints markdown for --report (1 ms)
    ✓ reads JSON from stdin and applies for --apply (17 ms)
    ✓ exits 2 when stdin is not valid JSON

 PASS  tests/ui/terminal.test.js
  ANSI
    ✓ should expose the expected escape sequences (2 ms)
  isTTY
    ✓ should return true when stdout is a TTY
    ✓ should return false when stdout is not a TTY
  write / writeLine
    ✓ should write text without appending a newline (1 ms)
    ✓ should append a newline when writeLine is called
    ✓ should default writeLine to an empty line
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
    ✓ should resolve with the typed answer (1 ms)
    ✓ should reject with CancelledError on SIGINT
    ✓ should resolve empty when closed without an answer or cancellation
  readLine -- non-TTY mode
    ✓ should buffer lines from stdin and resolve in order
    ✓ should resolve queued waiters with an empty string when stdin closes (1 ms)
    ✓ should resolve immediately with an empty string after stdin has closed
    ✓ should buffer lines that arrive before a reader is waiting
  onKeypress
    ✓ should return a no-op cleanup in non-TTY
    ✓ should wire up keypress events on stdin in a TTY and clean them up (1 ms)
    ✓ should skip setRawMode when stdin does not support it (1 ms)

 PASS  tests/version-monitor/node.test.js
  node detector
    ✓ bumps .nvmrc to the newest LTS in the same major (1 ms)
    ✓ preserves the range prefix in package.json engines (2 ms)
    ✓ reports nothing when already on the newest LTS (1 ms)

 PASS  tests/version-monitor/npm.test.js
  npm detector
    ✓ reports an update when a newer version is published (1 ms)
    ✓ reports nothing when current equals latest (1 ms)
    ✓ skips floating pins like "*" (1 ms)
    ✓ skips pre-release publishes (1 ms)

 PASS  tests/version-monitor/reporter.test.js
  report
    ✓ groups updates by source with a heading and a summary (1 ms)
    ✓ adds a Notes column only to groups containing a major bump
    ✓ uses singular wording for a single update
    ✓ reports no updates cleanly

version-monitor: actions lookup for "actions/checkout" failed: rate limited
 PASS  tests/version-monitor/php.test.js
  php detector
    ✓ targets the latest stable at the current granularity (1 ms)
    ✓ reports nothing when already on the latest branch
    ✓ skips compound constraints
    ✓ ignores pre-release releases when picking the latest

 PASS  tests/version-monitor/actions.test.js
  actions.parseUses
    ✓ extracts version-tagged actions and skips non-tag refs
  actions detector
    ✓ reports an update when a newer release exists (1 ms)
    ✓ reports nothing when the pinned ref is already latest
    ✓ stops early on a rate-limit error

 PASS  tests/hooks/install.test.js
  installHooks
    ✓ installs both hooks with the executable bit set (74 ms)
    ✓ injects the version header right after the shebang (66 ms)
    ✓ skips when a hook already exists, prints the right reason (109 ms)
    ✓ detects Husky-managed hooks and tags the skip reason (76 ms)
    ✓ --force overwrites existing hooks (77 ms)
    ✓ --dry-run plans without touching the filesystem (34 ms)
    ✓ throws a clear error outside a git repository (17 ms)
    ✓ resolves the hooks dir when .git is a file (separate git dir) (24 ms)
    ✓ onConflict callback receives the conflict info per template (28 ms)
    ✓ onConflict returning true overwrites the existing hook (23 ms)
    ✓ --force bypasses the onConflict callback entirely (31 ms)
    ✓ --dry-run reports skips for conflicts without consulting onConflict (31 ms)
    ✓ onBeforeWrite / onAfterWrite fire around each successful install (21 ms)
  injectVersionHeader
    ✓ inserts the header between the shebang and the body
    ✓ returns the body unchanged when there is no newline
  looksLikeHusky
    ✓ matches the `.husky/` directory marker
    ✓ matches the husky.sh sourcing marker
    ✓ returns false for arbitrary hook scripts
  install-hooks runCli
    ✓ --help exits 0 and prints usage (1 ms)
    ✓ -h exits 0 and prints usage (1 ms)
    ✓ unknown flag exits 2 with a stderr message
    ✓ runs end-to-end inside a git repo, prints `installed` lines (23 ms)
    ✓ --dry-run prints planned actions, writes nothing (25 ms)
    ✓ outside a git repo exits 1 with a clear stderr message (8 ms)
    ✓ non-TTY conflict skips without prompting (CI-safe) (25 ms)

 PASS  tests/hooks/templates.test.js
  commit-msg template
    ✓ accepts "feat: add Logger" (5 ms)
    ✓ accepts "fix: handle empty CHANGELOG" (1 ms)
    ✓ accepts "docs: update README"
    ✓ accepts "feat(utilities): add Logger"
    ✓ accepts "fix(release): handle empty CHANGELOG"
    ✓ accepts "feat(ui)!: breaking change to wizard"
    ✓ accepts "chore(deps): bump eslint"
    ✓ accepts "ci(detect-changes): cover edge case"
    ✓ accepts "refactor(scaffolds): inline registry scan"
    ✓ accepts "revert: feat(ui): add wizard" (1 ms)
    ✓ accepts "revert(release): restore prior tag"
    ✓ rejects "wip"
    ✓ rejects "WIP: x"
    ✓ rejects "feat:"
    ✓ rejects "feat: "
    ✓ rejects "feat(): no scope chars allowed empty"
    ✓ rejects "random commit message" (1 ms)
    ✓ rejects "Feat: capitalised type"
    ✓ rejects "feature: not in type list"
    ✓ shell bypasses cover merge / revert / fixup / squash (1 ms)
  commit-msg template (end-to-end against /bin/sh)
    ✓ exits 0 for a valid Conventional Commit subject (18 ms)
    ✓ exits 1 for an invalid subject and prints guidance (33 ms)
    ✓ exits 0 for merge commits (24 ms)
    ✓ exits 0 for revert commits (20 ms)
    ✓ exits 0 for fixup! commits (12 ms)
  pre-commit template
    ✓ no-ops when package.json is absent (7 ms)
    ✓ no-ops when package.json has no lint:staged script (237 ms)
    ✓ does not false-positive when "lint:staged" appears only as a string (110 ms)
    ✓ runs the lint:staged script when defined (123 ms)
    ✓ propagates a non-zero exit from the lint:staged script (124 ms)
  shellcheck (optional)
    ✓ commit-msg passes shellcheck -s sh (46 ms)
    ✓ pre-commit passes shellcheck -s sh (21 ms)

Test Suites: 27 passed, 27 total
Tests:       350 passed, 350 total
Snapshots:   0 total
Time:        1.174 s
Ran all test suites.
```

---

## Open questions

- _(none yet)_

---

## Notes for the reviewer

- No new runtime dependencies; `https` is a Node built-in and tests mock the internal `http.js` via `jest.mock`.
- `container` and `wp-cli` are disabled by default in the sample config but are fully implemented and tested per the acceptance criteria.
- Action refs pinned to a floating major (`@v4`) are intentionally skipped — only fully-qualified tags (`@v4.0.2`) are bumped — so the monitor never rewrites a deliberate floating-major pin. Same rule for Node (`22` vs `22.11.0`).
- **Pre-existing environment issue (not this branch):** `npm run test:coverage` currently fails for *every* suite in the repo with `minimatch is not a function`, thrown from babel-istanbul instrumentation (a transitive `minimatch` major-version export change). `npm run check` (lint + `npm test`) is unaffected and green. Worth a separate fix on the release branch.

---

## Handoff log

_(no rotations yet — delete this line when the first entry is added)_
