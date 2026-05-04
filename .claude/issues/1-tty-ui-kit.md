# Issue #1 — Add TTY UI kit

**Status:** in-progress
**Branch:** `v1.0.0/task/tty-ui-kit`
**PR:** <!-- fill once opened -->
**Assignee:** @abhishekxix

---

## Summary

The TTY UI kit is the interactive terminal layer every skeleton's setup wizard and add-module flow depend on. It is consumed via `@rtcamp/wp-tooling/ui`. Built entirely on Node.js built-ins (readline, process.stdout, process.stdin) — zero runtime dependencies. Provides seven public primitives: Wizard, text, confirm, password, checkbox, radio, checkboxTree, and spinner.

---

## Decisions made

- [2026-05-04] CommonJS only -- safer for cross-consumer compatibility.
- [2026-05-04] All UI primitives degrade gracefully in non-TTY (CI) environments.
- [2026-05-04] ASCII-only symbols in all UI output -- no Unicode emojis or special characters.
- [2026-05-04] Guard added to `readLine` to prevent the `close` event from resolving the promise before the `question` callback fires.

---

## Files changed so far

- `.claude/issues/1-tty-ui-kit.md` -- new
- `src/ui/index.js` -- new (barrel export)
- `src/ui/core/terminal.js` -- new (ANSI codes, cursor, keypress, readLine)
- `src/ui/prompts/index.js` -- new (text, confirm, password)
- `src/ui/selects/flat.js` -- new (checkbox, radio)
- `src/ui/selects/tree.js` -- new (checkboxTree)
- `src/ui/spinner/index.js` -- new (spinner with TTY/non-TTY modes)
- `src/ui/wizard/index.js` -- new (Wizard class)
- `tests/ui/wizard.test.js` -- new
- `tests/ui/spinner.test.js` -- new
- `tests/ui/prompts.test.js` -- new
- `tests/ui/selects.test.js` -- new
- `CHANGELOG.md` -- new

---

## Verification run

```bash
$ npm run check
# pending
```

---

## Notes for the reviewer

- All eight exports exposed from barrel: Wizard, text, confirm, password, checkbox, radio, checkboxTree, spinner.
- Non-TTY fallbacks tested.
- No banned dependencies used.
- ASCII-only symbols throughout -- no Unicode emojis.
- Stub files for other sub-exports (scaffolds, release, hooks, ci, version-monitor, lint) are not included; those belong to their own issues.
