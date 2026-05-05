# Issue #1 — Add TTY UI kit

**Status:** in-progress
**Branch:** `v1.0.0/task/tty-ui-kit`
**PR:** #3
**Assignee:** @abhishekxix

---

## Summary

The TTY UI kit is the interactive terminal layer every skeleton's setup wizard and add-module flow depend on. It is consumed via `@rtcamp/wp-tooling/ui`. Built entirely on Node.js built-ins (readline, process.stdout, process.stdin) — zero runtime dependencies. Provides eight public primitives: Wizard, text, confirm, password, checkbox, radio, checkboxTree, and spinner.

---

## Decisions made

- [2026-05-04] CommonJS only -- safer for cross-consumer compatibility.
- [2026-05-04] All UI primitives degrade gracefully in non-TTY (CI) environments.
- [2026-05-04] ASCII-only symbols in all UI output -- no Unicode emojis or special characters.
- [2026-05-04] Guard added to `readLine` to prevent the `close` event from resolving the promise before the `question` callback fires.

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
- `src/ui/core/terminal.js` -- new (ANSI codes, cursor, keypress, readLine)
- `src/ui/prompts/index.js` -- new (text, confirm, password)
- `src/ui/selects/flat.js` -- new (checkbox, radio)
- `src/ui/selects/tree.js` -- new (checkboxTree)
- `src/ui/spinner/index.js` -- new (spinner with TTY/non-TTY modes)
- `src/ui/wizard/index.js` -- new (Wizard class)
- `tests/ui/prompts.test.js` -- new
- `tests/ui/selects.test.js` -- new
- `tests/ui/spinner.test.js` -- new
- `tests/ui/wizard.test.js` -- new

---

## Verification run

```bash
$ npm run check
> @rtcamp/wp-tooling@0.1.0 check
> npm run lint && npm test


> @rtcamp/wp-tooling@0.1.0 lint
> eslint src tests


> @rtcamp/wp-tooling@0.1.0 test
> jest

 PASS  tests/ui/selects.test.js
  checkbox (non-TTY)
    ✓ should return selected items by number (1 ms)
    ✓ should handle empty input gracefully (1 ms)
  radio (non-TTY)
    ✓ should return a single selected item
    ✓ should default to first choice on invalid input
  checkboxTree (non-TTY)
    ✓ should return selected items from groups by number (1 ms)
    ✓ should handle empty selection

 PASS  tests/ui/wizard.test.js
  Wizard
    ✓ should run all steps in order
    ✓ should honour the skip() predicate
    ✓ should pass context to skip()
    ✓ should default context to empty object
    ✓ should handle an empty steps array
    ✓ should propagate step errors (4 ms)

 PASS  tests/ui/spinner.test.js
  spinner
    ✓ should return an object with start, succeed, fail, update methods (1 ms)
    ✓ should default to current text when succeed is called without args
    non-TTY mode
      ✓ should print plain text on start in non-TTY (1 ms)
      ✓ should print succeed message in non-TTY
      ✓ should print fail message in non-TTY
    TTY mode
      ✓ should animate frames on an interval (1 ms)
      ✓ should stop animation on succeed
      ✓ should stop animation on fail (1 ms)
      ✓ should update text while running

 PASS  tests/ui/prompts.test.js
  text
    ✓ should return the user input (1 ms)
    ✓ should return defaultValue when input is empty
    ✓ should trim whitespace from input
    ✓ should retry when validation fails (1 ms)
  confirm
    ✓ should return true for "y"
    ✓ should return true for "yes"
    ✓ should return false for "n"
    ✓ should return defaultValue on empty input (1 ms)
    ✓ should default to false when no defaultValue
  password
    ✓ should fall back to readLine in non-TTY

Test Suites: 4 passed, 4 total
Tests:       31 passed, 31 total
Snapshots:   0 total
Time:        0.182 s, estimated 1 s
Ran all test suites.
```

---

## Notes for the reviewer

- All eight exports exposed from barrel: Wizard, text, confirm, password, checkbox, radio, checkboxTree, spinner.
- Non-TTY fallbacks tested.
- No banned dependencies used.
- ASCII-only symbols throughout -- no Unicode emojis.
- Stub files for other sub-exports (scaffolds, release, hooks, ci, version-monitor, lint) are not included; those belong to their own issues.
