# Issue #9 — git hooks + install-hooks CLI

**Status:** in-progress <!-- in-progress | in-review | done -->
**Branch:** `v1.0.0/task/git-hooks`
**PR:** #11
**Assignee:** @Adi-ty

---

## Summary

Conventional Commits and lint-on-commit are non-negotiable in our flow, but every engineer setting them up by hand creates drift. This issue ships two POSIX-shell hook templates (`commit-msg`, `pre-commit`) plus a Node installer exposed as `wp-tooling install-hooks`. The hooks live in `wp-tooling`, not in each skeleton, so updates ship to all skeletons through a plain `npm update`. We deliberately avoid Husky to preserve our zero-runtime-dep policy.

---

## Decisions made

- [2026-05-15] Dispatcher-only CLI — no separate `bin/wp-tooling-install-hooks.js`. The detect-changes PR established a single `bin/wp-tooling.js` shim routing through `src/cli/index.js`; matching that keeps a single entry point.
- [2026-05-15] No TTY UI imports for now. The TTY UI Kit PR is unmerged; plain `process.stdout.write`/`stderr.write` is used. Spinner/confirm will be layered in once the UI kit lands.
- [2026-05-15] `--dry-run` is supported per CLAUDE.md non-negotiable, even though the issue body doesn't mention it.
- [2026-05-15] Resolve the hooks directory via `git rev-parse --git-common-dir` so submodule/worktree cases (where `.git` is a file) work transparently.
- [2026-05-15] Husky detection: if an existing hook contains a Husky signature (`.husky/`, `husky.sh`), the skip hint names Husky explicitly. Otherwise generic.
- [2026-05-15] shellcheck test skips when the binary isn't on `PATH`. The JS regex test against the commit-msg pattern always runs.
- [2026-05-15] Branch is currently rebased on top of `v1.0.0/task/detect-changes` (PR #7 unmerged). Will rebase onto `release/v1.0.0` once #7 merges.
- [2026-05-20] Rebased onto the dispatcher auto-discovery refactor on `v1.0.0/task/detect-changes`. The `install-hooks` registration moved from an edit to `src/cli/index.js` into a new `src/cli/commands/install-hooks.js` exporting `{ name, summary, run }`. No dispatcher edit on this branch.
- [2026-05-20] Layered the TTY UI Kit integration on top once `v1.0.0/task/tty-ui-kit-port` merged into `release/v1.0.0`:
  - `installHooks` is now async and exposes three optional callbacks for the CLI layer: `onConflict({ name, dest, reason }) -> boolean | Promise<boolean>` for the overwrite prompt, plus `onBeforeWrite` / `onAfterWrite` for spinner control. The library stays UI-agnostic — UI code lives only in `runCli`.
  - `runCli` wires `confirm` into `onConflict` (TTY only — non-TTY stdin always skips, keeping CI fast-path intact) and wraps each successful write with a per-template `spinner`. Spinner degrades to plain `installing X` / `+ installed X` lines under non-TTY per the UI kit contract.
  - `--force` short-circuits the prompt entirely (callback isn't even passed). `--dry-run` never prompts (deterministic plan output).
- [2026-05-20] Made the dispatcher contract uniform with `v1.0.0/task/scaffold-registry`: `src/cli/index.js` `main()` is now declared `async` and always returns `Promise<number>`, regardless of whether the routed subcommand is sync or async. `bin/wp-tooling.js` switched from `Promise.resolve(...).then(...)` coercion to a direct `.then(success, failure)` chain on the always-promise. The two branches now produce byte-identical `src/cli/index.js` and `bin/wp-tooling.js` — no dispatcher conflict at merge time.
- [2026-05-20] Pinned `process.stdin.isTTY` to `false` inside the `install-hooks runCli` describe block's `beforeEach`/`afterEach`. The UI password and select tests set `stdin.isTTY = true` inside their own try/finally; under certain jest worker scheduling orders the elevated value can be observed by our suite, which would cause the `non-TTY conflict skips without prompting (CI-safe)` test to fall into the `confirm()` -> `readLine()` path and hang for 5 s. The stub makes the test environment-independent.
- [2026-05-22] Added central `CancelledError` handling in `src/cli/index.js`: `main()` wraps `command.run()` in try/catch and maps any error with `err.name === 'CancelledError'` (duck-typed for `jest.isolateModules`) to exit code 130 with a `wp-tooling: cancelled` stderr line. Subcommands no longer need their own Ctrl+C handler. Ported from the scaffold-engine prototype because `install-hooks` is the first real caller (its `confirm()` prompt can throw `CancelledError`); putting it in the dispatcher beats every interactive subcommand reinventing the same catch.

---

## Files changed so far

- `src/hooks/templates/commit-msg` — new
- `src/hooks/templates/pre-commit` — new
- `src/hooks/install.js` — new (async library + `runCli` driving spinner + confirm via the UI kit)
- `src/hooks/index.js` — new
- `src/cli/commands/install-hooks.js` — new (dispatcher auto-discovery picks it up; no edit to `src/cli/index.js`)
- `src/cli/index.js` — edited (`main()` is now declared `async` for a uniform `Promise<number>` contract; matches `v1.0.0/task/scaffold-registry` byte-for-byte. Also wraps `command.run()` in try/catch to map `CancelledError` -> exit 130.)
- `bin/wp-tooling.js` — edited (direct `.then(process.exit, failureHandler)` on the always-Promise `main()`; matches scaffold-registry byte-for-byte)
- `tests/hooks/install.test.js` — new (20 tests: happy path, conflicts, --force, --dry-run, separate git dir, `onConflict` / `onBeforeWrite` / `onAfterWrite` lifecycle; runCli describe pins `process.stdin.isTTY = false` for ordering-independent runs)
- `tests/hooks/templates.test.js` — new (POSIX shellcheck + JS regex coverage of the commit-msg pattern + end-to-end `/bin/sh` execution of both templates)
- `tests/cli/index.test.js` — edited (all `cli.main()` tests converted to async/await; cover `install-hooks` routing + registry presence; new `central error handling` describe asserts `CancelledError` -> 130 with stderr message and that non-cancelled rejections still propagate to the bin shim)
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

 PASS  tests/hooks/install.test.js
  installHooks
    ✓ installs both hooks with the executable bit set (18 ms)
    ✓ injects the version header right after the shebang (16 ms)
    ✓ skips when a hook already exists, prints the right reason (21 ms)
    ✓ detects Husky-managed hooks and tags the skip reason (22 ms)
    ✓ --force overwrites existing hooks (21 ms)
    ✓ --dry-run plans without touching the filesystem (22 ms)
    ✓ throws a clear error outside a git repository (12 ms)
    ✓ resolves the hooks dir when .git is a file (separate git dir) (19 ms)
    ✓ onConflict callback receives the conflict info per template (22 ms)
    ✓ onConflict returning true overwrites the existing hook (20 ms)
    ✓ --force bypasses the onConflict callback entirely (20 ms)
    ✓ --dry-run reports skips for conflicts without consulting onConflict (20 ms)
    ✓ onBeforeWrite / onAfterWrite fire around each successful install (17 ms)
  injectVersionHeader
    ✓ inserts the header between the shebang and the body (1 ms)
    ✓ returns the body unchanged when there is no newline
  looksLikeHusky
    ✓ matches the `.husky/` directory marker
    ✓ matches the husky.sh sourcing marker
    ✓ returns false for arbitrary hook scripts
  install-hooks runCli
    ✓ --help exits 0 and prints usage (1 ms)
    ✓ -h exits 0 and prints usage (1 ms)
    ✓ unknown flag exits 2 with a stderr message
    ✓ runs end-to-end inside a git repo, prints `installed` lines (16 ms)
    ✓ --dry-run prints planned actions, writes nothing (21 ms)
    ✓ outside a git repo exits 1 with a clear stderr message (5 ms)
    ✓ non-TTY conflict skips without prompting (CI-safe) (22 ms)

 PASS  tests/hooks/templates.test.js
  commit-msg template
    ✓ accepts "feat: add Logger" (1 ms)
    ✓ accepts "fix: handle empty CHANGELOG"
    ✓ accepts "docs: update README"
    ✓ accepts "feat(utilities): add Logger"
    ✓ accepts "fix(release): handle empty CHANGELOG"
    ✓ accepts "feat(ui)!: breaking change to wizard"
    ✓ accepts "chore(deps): bump eslint"
    ✓ accepts "ci(detect-changes): cover edge case"
    ✓ accepts "refactor(scaffolds): inline registry scan"
    ✓ rejects "wip"
    ✓ rejects "WIP: x"
    ✓ rejects "feat:"
    ✓ rejects "feat: "
    ✓ rejects "feat(): no scope chars allowed empty"
    ✓ rejects "random commit message"
    ✓ rejects "Feat: capitalised type"
    ✓ rejects "feature: not in type list"
    ✓ shell bypasses cover merge / revert / fixup / squash
  commit-msg template (end-to-end against /bin/sh)
    ✓ exits 0 for a valid Conventional Commit subject (7 ms)
    ✓ exits 1 for an invalid subject and prints guidance (6 ms)
    ✓ exits 0 for merge commits (4 ms)
    ✓ exits 0 for revert commits (4 ms)
    ✓ exits 0 for fixup! commits (4 ms)
  pre-commit template
    ✓ no-ops when package.json is absent (2 ms)
    ✓ no-ops when package.json has no lint:staged script (5 ms)
  shellcheck (optional)
    ✓ commit-msg passes shellcheck -s sh (20 ms)
    ✓ pre-commit passes shellcheck -s sh (20 ms)

 PASS  tests/cli/index.test.js
  cli main()
    ✓ no args prints top-level usage and exits 0
    ✓ --help prints top-level usage
    ✓ -h prints top-level usage
    ✓ --version prints package version and exits 0
    ✓ -v prints package version
    ✓ unknown top-level flag exits 2 with stderr message
    ✓ unknown subcommand exits 2 with stderr message
    ✓ routes detect-changes --help to its runCli (1 ms)
    ✓ routes detect-changes through to its runCli with args (1 ms)
    ✓ detect-changes propagates a usage-error exit code
  cli main() central error handling
    ✓ CancelledError from a subcommand exits 130 with a stderr message (1 ms)
    ✓ non-CancelledError rejections propagate to the bin shim (3 ms)
  cli COMMANDS registry
    ✓ detect-changes is registered with a summary and run handler
    ✓ install-hooks is registered with a summary and run handler
  cli main() routes install-hooks
    ✓ routes install-hooks --help to its runCli (1 ms)
  cli loadCommands()
    ✓ discovers a valid command module and indexes it by name (34 ms)
    ✓ ignores non-.js files in the commands directory (3 ms)
    ✓ throws a clear error when a module is missing required fields (2 ms)
    ✓ throws when two modules register the same name (4 ms)
    ✓ returns entries in deterministic (sorted) order (6 ms)

 PASS  tests/ui/terminal.test.js
  ANSI
    ✓ should expose the expected escape sequences (1 ms)
  isTTY
    ✓ should return true when stdout is a TTY
    ✓ should return false when stdout is not a TTY (1 ms)
  write / writeLine
    ✓ should write text without appending a newline
    ✓ should append a newline when writeLine is called
    ✓ should default writeLine to an empty line
  clearLine
    ✓ should write clear-line + carriage return when stdout is a TTY
    ✓ should write nothing when stdout is not a TTY
  moveCursorUp
    ✓ should emit the move-up escape when n > 0 in a TTY (1 ms)
    ✓ should not write anything when n is 0
    ✓ should not write anything in non-TTY (1 ms)
  hideCursor / showCursor
    ✓ should write the hide/show sequences in a TTY
    ✓ should write nothing in non-TTY
  readLine -- TTY mode
    ✓ should resolve with the typed answer
    ✓ should reject with CancelledError on SIGINT (1 ms)
    ✓ should resolve empty when closed without an answer or cancellation
  readLine -- non-TTY mode
    ✓ should buffer lines from stdin and resolve in order (1 ms)
    ✓ should resolve queued waiters with an empty string when stdin closes
    ✓ should resolve immediately with an empty string after stdin has closed
    ✓ should buffer lines that arrive before a reader is waiting (1 ms)
  onKeypress
    ✓ should return a no-op cleanup in non-TTY
    ✓ should wire up keypress events on stdin in a TTY and clean them up (1 ms)
    ✓ should skip setRawMode when stdin does not support it

 PASS  tests/ui/wizard.test.js
  Wizard
    ✓ should run all steps in order (1 ms)
    ✓ should honour the skip() predicate
    ✓ should pass context to skip()
    ✓ should default context to empty object (1 ms)
    ✓ should default steps to empty array
    ✓ should handle an empty steps array
    ✓ should throw a clear error when steps is not an array (3 ms)
    ✓ should omit ANSI formatting in non-TTY mode
    ✓ should propagate step errors

 PASS  tests/ci/detect-changes.test.js
  detectChanges
    ✓ counts files into the right buckets (1 ms)
    ✓ default ignore excludes docs and .wordpress-org
    ✓ default ignore preserves .github/workflows and .github/actions
    ✓ lockfile changes count under both css and js buckets
    ✓ phpstan.neon and phpstan.neon.dist count as php
    ✓ composer.json and composer.lock count as php
    ✓ string --ignore overrides the default
    ✓ RegExp --ignore is accepted directly (1 ms)
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
    ✓ DEFAULT_PATTERNS has the four expected buckets
    ✓ DEFAULT_IGNORE matches docs/, .wordpress-org/, and .github/ non-workflow paths
  runCli
    ✓ --help prints usage and exits 0
    ✓ unknown flag exits 2 with stderr message
    ✓ invalid --output exits 2
    ✓ --files <path> with --output json prints valid JSON (1 ms)
    ✓ --output github appends key=value lines to $GITHUB_OUTPUT (1 ms)
    ✓ --output github warns to stderr when GITHUB_OUTPUT is unset
    ✓ --dry-run parses cleanly and exits 0 (1 ms)
    ✓ --dry-run + --output github does not touch $GITHUB_OUTPUT and previews to stdout
    ✓ --dry-run + --output github previews even when $GITHUB_OUTPUT is unset
    ✓ text mode prints key: value lines
    ✓ --ignore overrides default (1 ms)
    ✓ missing --files path exits 1 with stderr message
    ✓ --files followed by another flag exits 2 (does not swallow the flag)
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
    ✓ should default to first choice on invalid input (1 ms)
  flat select validation
    ✓ should throw when checkbox choices is missing (10 ms)
    ✓ should throw when radio choices is empty
  flat select (TTY) -- Ctrl+C
    ✓ should reject with CancelledError on Ctrl+C
  checkboxTree (non-TTY)
    ✓ should return selected items from groups by number (1 ms)
    ✓ should return unique selections in display order
    ✓ should handle empty selection
    ✓ should throw when groups is missing (1 ms)
    ✓ should throw when groups is null
    ✓ should throw when a group items is not an array (1 ms)
    ✓ should return an empty array for empty groups without prompting
  checkboxTree (TTY)
    ✓ should resolve selections in display order, not toggle order
    ✓ should reject with CancelledError on Ctrl+C

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
    ✓ should propagate CancelledError from readLine (1 ms)
  password
    ✓ should fall back to readLine in non-TTY
    ✓ should accept a string message shortcut
    ✓ should reject with CancelledError on Ctrl+C (1 ms)

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
      ✓ should not create multiple intervals when start is called twice (1 ms)
      ✓ should stop animation on succeed
      ✓ should stop animation on fail
      ✓ should update text while running

Test Suites: 9 passed, 9 total
Tests:       189 passed, 189 total
Snapshots:   0 total
Time:        0.759 s, estimated 1 s
Ran all test suites.
```

Manual smoke test:

```bash
❯ SMOKE=$(mktemp -d) && cd "$SMOKE" && git init --quiet
  ~/rtproj/wp-tooling/bin/wp-tooling.js install-hooks
+ installed commit-msg
+ installed pre-commit

❯ ~/rtproj/wp-tooling/bin/wp-tooling.js install-hooks
? Overwrite commit-msg? (an existing hook is already in place) (y/N) y
+ installed commit-msg
? Overwrite pre-commit? (an existing hook is already in place) (y/N) y
+ installed pre-commit
```

---

## Open questions

- _(none yet)_

---

## Notes for the reviewer

- Templates are POSIX `sh` only (no bash-isms). The `pre-commit` template short-circuits when `package.json` has no `lint:staged` script — intentional for pure-PHP repos.
- The version header is injected after the shebang so future installs can detect drift without re-reading the package version on every commit.
- The Husky-aware skip message is a UX hint only — behaviour (skip without `--force`, overwrite with `--force` *or* a `y` answer at the TTY prompt) is identical to the generic case.
- TTY UI integration: `runCli` now uses `confirm` for the overwrite prompt and `spinner` per template install. Non-TTY environments (CI) **never** prompt — conflicts always skip with the existing "pass --force to replace" hint, so CI behaviour is unchanged.
- The spinner animation is intentionally invisible in normal operation because each hook write completes well under the 80 ms animation interval. What the user sees (`installing X` followed by `+ installed X`) **is** the spinner's `start()` and `succeed()` output. The animation surfaces only when wrapping something genuinely slow; here the `+ / x` markers carry the UX signal.
- `src/cli/index.js` and `bin/wp-tooling.js` are byte-identical to `v1.0.0/task/scaffold-registry`. Whichever PR merges first, the other rebases with zero dispatcher conflict.

---

## Handoff log

_(no rotations yet — delete this line when the first entry is added)_

<!--
### → Handoff OUT · YYYY-MM-DD · @handle
- **Reason for rotation:** …
- **Expected return:** …
- **Branch state:** <branch> pushed to remote, HEAD at commit `<sha>`
- **What's done:** …
- **What's in progress:** …
- **What's next:** …
- **Blockers / open questions:** …
- **Gotchas for the incoming engineer:** …
- **Contact:** …

### ← Handoff IN · YYYY-MM-DD · @handle
- **Confirmed reproducibility:** …
- **Starting point:** …
- **Deviations from plan above:** …
-->
