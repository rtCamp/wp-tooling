# Issue #1 — Add TTY UI kit

**Status:** in-progress
**Branch:** `v1.0.0/task/tty-ui-kit`
**PR:** #3
**Assignee:** @abhishekxix

---

## Summary

The TTY UI kit is the interactive terminal layer every skeleton's setup wizard and add-module flow depend on. It is consumed via `@rtcamp/wp-tooling/ui`. Built entirely on Node.js built-ins (readline, process.stdout, process.stdin) — zero runtime dependencies. Provides nine public exports: Wizard, text, confirm, password, checkbox, radio, checkboxTree, spinner, and CancelledError.

---

## Decisions made

- [2026-05-04] CommonJS only -- safer for cross-consumer compatibility.
- [2026-05-04] All UI primitives degrade gracefully in non-TTY (CI) environments.
- [2026-05-04] ASCII-only symbols in all UI output -- no Unicode emojis or special characters.
- [2026-05-04] Guard added to `readLine` to prevent the `close` event from resolving the promise before the `question` callback fires.
- [2026-05-05] Input validation added to `checkbox`, `radio`, and `checkboxTree` -- throw `TypeError` on missing or invalid `choices`/`groups`.
- [2026-05-05] `checkboxTree` returns selections in display order, not toggle order.
- [2026-05-05] Spinner guards against multiple intervals when `start()` called twice.
- [2026-05-05] Wizard validates `steps` is an array, defaults to empty array on `undefined`, and omits ANSI formatting in non-TTY.
- [2026-05-05] `CancelledError` added -- thrown on Ctrl+C in any TTY prompt or select.
- [2026-05-05] `checkboxTree` returns empty array for empty groups without prompting.
- [2026-05-14] `readLine` rejects with `CancelledError` on SIGINT (Ctrl+C) in TTY mode. Reason: without an explicit SIGINT listener, `readline.createInterface` only pauses on Ctrl+C — `text` and `confirm` would silently resolve `''` / default instead of surfacing cancellation. Centralising the fix in `readLine` keeps `text`, `confirm`, and any future prompt that routes through it consistent with `password`.
- [2026-05-14] `text`, `confirm`, and `password` accept either a string message shortcut or a full options object. Reason: `text('Name?')` previously destructured the string and prompted with `undefined`. Normalising at the function boundary (`normaliseOptions`) keeps the options-object path untouched.
- [2026-05-14] Added seven sub-export stubs (`scaffolds`, `release`, `hooks`, `ci`, `version-monitor`, `lint/eslint`, `lint/stylelint`) so the `package.json` `exports` map resolves end-to-end.

---

## Files changed so far

- `.claude/issues/1-tty-ui-kit.md` -- new
- `.eslintrc.js` -- modified (added `examples/**/*.js` no-console override)
- `CHANGELOG.md` -- new
- `examples/prompts-demo.js` -- new (text, confirm, password demo)
- `examples/selects-demo.js` -- new (radio, checkbox, checkboxTree demo)
- `examples/spinner-demo.js` -- new (spinner lifecycle demo)
- `examples/wizard-demo.js` -- new (full wizard + all primitives demo)
- `examples/wizard-demo-non-tty.js` -- new (piped stdin non-TTY demo)
- `src/ui/index.js` -- new (barrel export)
- `src/ui/core/terminal.js` -- new (ANSI codes, cursor, keypress, readLine); updated 2026-05-14 — `readLine` rejects with `CancelledError` on SIGINT in TTY mode
- `src/ui/prompts/index.js` -- new (text, confirm, password); updated 2026-05-14 — string-message shortcut via `normaliseOptions`
- `src/ui/selects/flat.js` -- new (checkbox, radio)
- `src/ui/selects/tree.js` -- new (checkboxTree)
- `src/ui/spinner/index.js` -- new (spinner with TTY/non-TTY modes)
- `src/ui/errors.js` -- new (CancelledError class)
- `src/ui/wizard/index.js` -- new (Wizard class)
- `src/scaffolds/index.js` -- new stub (added 2026-05-14)
- `src/release/index.js` -- new stub (added 2026-05-14)
- `src/hooks/index.js` -- new stub (added 2026-05-14)
- `src/ci/index.js` -- new stub (added 2026-05-14)
- `src/version-monitor/index.js` -- new stub (added 2026-05-14)
- `src/lint/eslint.js` -- new stub (added 2026-05-14)
- `src/lint/stylelint.js` -- new stub (added 2026-05-14)
- `tests/ui/prompts.test.js` -- new; +6 tests on 2026-05-14 (string shortcuts and cancellation propagation)
- `tests/ui/selects.test.js` -- new
- `tests/ui/spinner.test.js` -- new
- `tests/ui/wizard.test.js` -- new

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

 PASS  tests/ui/selects.test.js
  checkbox (non-TTY)
    ✓ should return selected items by number (1 ms)
    ✓ should return unique selections in display order
    ✓ should handle empty input gracefully (1 ms)
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
    ✓ should throw when groups is missing (1 ms)
    ✓ should throw when groups is null (1 ms)
    ✓ should throw when a group items is not an array
    ✓ should return an empty array for empty groups without prompting
  checkboxTree (TTY)
    ✓ should resolve selections in display order, not toggle order
    ✓ should reject with CancelledError on Ctrl+C (1 ms)

 PASS  tests/ui/prompts.test.js
  text
    ✓ should return the user input
    ✓ should return defaultValue when input is empty
    ✓ should trim whitespace from input
    ✓ should retry when validation fails
    ✓ should accept a string message shortcut
    ✓ should propagate CancelledError from readLine (2 ms)
  confirm
    ✓ should return true for "y"
    ✓ should return true for "yes"
    ✓ should return false for "n"
    ✓ should return defaultValue on empty input
    ✓ should default to false when no defaultValue
    ✓ should accept a string message shortcut (1 ms)
    ✓ should propagate CancelledError from readLine
  password
    ✓ should fall back to readLine in non-TTY
    ✓ should accept a string message shortcut
    ✓ should reject with CancelledError on Ctrl+C (1 ms)

 PASS  tests/ui/wizard.test.js
  Wizard
    ✓ should run all steps in order (1 ms)
    ✓ should honour the skip() predicate
    ✓ should pass context to skip()
    ✓ should default context to empty object
    ✓ should default steps to empty array
    ✓ should handle an empty steps array (1 ms)
    ✓ should throw a clear error when steps is not an array (2 ms)
    ✓ should omit ANSI formatting in non-TTY mode
    ✓ should propagate step errors

 PASS  tests/ui/spinner.test.js
  spinner
    ✓ should return an object with start, succeed, fail, update methods
    ✓ should default to current text when succeed is called without args (1 ms)
    non-TTY mode
      ✓ should print plain text on start in non-TTY
      ✓ should print succeed message in non-TTY
      ✓ should print fail message in non-TTY
    TTY mode
      ✓ should animate frames on an interval (1 ms)
      ✓ should not create multiple intervals when start is called twice
      ✓ should stop animation on succeed
      ✓ should stop animation on fail
      ✓ should update text while running

Test Suites: 4 passed, 4 total
Tests:       52 passed, 52 total
Snapshots:   0 total
Time:        0.161 s, estimated 1 s
Ran all test suites.
❯ node -e "const {Wizard} = require('./src/ui/index.js'); console.log(typeof Wizard)"

function
❯ node -e "const {spinner} = require('./src/ui/index.js'); const s = spinner('CI run'); s.start(); s.succeed('OK');" < /dev/null
+ OK
```

---

## Notes for the reviewer

- Nine exports from barrel: Wizard, text, confirm, password, checkbox, radio, checkboxTree, spinner, CancelledError.
- Non-TTY fallbacks tested for all primitives.
- Input validation tested for `checkbox`, `radio`, and `checkboxTree`.
- Ctrl+C (`CancelledError`) tested for TTY prompts and selects. `text` and `confirm` propagate the rejection from `readLine`, so cancellation is consistent across every prompt.
- String-message shortcut accepted by `text`, `confirm`, `password` — addresses @bhavz-10 review point that `text('Name')` previously prompted with `undefined`.
- No banned dependencies used.
- ASCII-only symbols throughout -- no Unicode emojis.
- Stub files for the other seven sub-exports (`scaffolds`, `release`, `hooks`, `ci`, `version-monitor`, `lint/eslint`, `lint/stylelint`) are included as `module.exports = {}` so the `package.json` `exports` map resolves end-to-end. Each will be replaced by the feature PR that owns the sub-package.

## Handoff log

### ← Handoff IN · 2026-05-14 · @Adi-ty

- **Confirmed reproducibility:** `npm run check` → exit 0; 4 test suites pass, lint clean. HEAD at `523f58f`.
- **Starting point:** PR #3 has `CHANGES_REQUESTED` from @bhavz-10 (2026-05-08) that is still outstanding. Picking up:
    - Cancellation inconsistency — `text()` and `confirm()` go through `readLine()` and resolve `''` / default on
Ctrl+C; `password` already throws `CancelledError`. Make `text` and `confirm` reject with `CancelledError` to match.
    - `text` / `confirm` / `password` only accept an options object — `text('Name')` prompts with `undefined`. Add a
string-form shortcut (or throw a clear `TypeError`).
    - Sub-export stubs flagged HIGH by Copilot are still missing. `package.json` `exports` map points at
`./src/{scaffolds,release,hooks,ci,version-monitor,lint/*}` — those files don't exist, so
`require('@rtcamp/wp-tooling/scaffolds')` etc. fails at runtime. Decide: add the seven stubs (matches acceptance
criteria) vs. trim exports map to only `./ui` until each sub-package lands.
- **Deviations from plan above:** N/A — no `/handoff out` was recorded by @abhishekxix before rotation. Outgoing
context reconstructed from PR #3 review thread and `.claude/issues/1-tty-ui-kit.md` history.