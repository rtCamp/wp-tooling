# Issue #4 — Add shareable lint configs (ESLint + Stylelint)

**Status:** in-review
**Branch:** `v1.0.0/task/lint-configs`
**PR:** #5
**Assignee:** @Swanand01

---

## Summary

Adds two shareable lint configs exported from `@rtcamp/wp-tooling` — one for ESLint, one for Stylelint. Both extend official WordPress tooling and replace the stubs added in #1. Consumers reference them in a single line; all lint packages are peer dependencies.

---

## Decisions made

- Used `peerDependencies` for all lint packages rather than `dependencies` — consumers on `@wordpress/scripts` already have most of them; npm 7+ auto-installs the rest. Keeps `dependencies` empty per zero-runtime-dep policy.
- Added `eslint-import-resolver-typescript` as a devDependency (not just peer) — needed so it is hoisted to root `node_modules` and resolvable by `eslint-plugin-import` when linting this repo. Consumers get it transitively from `@wordpress/eslint-plugin`.
- Used `n/no-restricted-require` from `eslint-plugin-n` to ban runtime deps — `no-restricted-imports` only covers ES `import` statements, not CommonJS `require()`. `no-restricted-modules` is deprecated and removed in ESLint v11.
- Scoped jest plugin to `**/*.test.js` only — TypeScript test files excluded for now.
- Prettier enforcement comes for free via `@wordpress/eslint-plugin` entry 14 — no separate `prettier` dep needed.

---

## Files changed so far

- `src/lint/eslint.js` — new
- `src/lint/stylelint.js` — new
- `eslint.config.js` — new (replaces `.eslintrc.js`)
- `.eslintrc.js` — deleted
- `package.json` — edited (peerDependencies, devDependencies)
- `tests/lint/eslint.test.js` — new
- `tests/lint/stylelint.test.js` — new
- `CHANGELOG.md` — new

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

PASS tests/lint/eslint.test.js
  eslint config
    ✓ exports a non-empty array
    ✓ every entry is a plain object
    ✓ includes the eslint-comments plugin
    ✓ includes jest plugin scoped to test files only

PASS tests/lint/stylelint.test.js
  stylelint config
    ✓ exports a plain object
    ✓ extends @wordpress/stylelint-config
    ✓ extends @wordpress/stylelint-config/scss

Tests: 7 passed, 7 total
```

---

## Open questions

- _(none)_

---

## Notes for the reviewer

- `npm install` emits 7 `ERESOLVE overriding peer dependency` warnings. These come from sub-plugins inside `@wordpress/eslint-plugin` that have not updated their peer dep ranges to include ESLint v10. Everything lints correctly.
- `eslint-plugin-n` added as devDep for the `n/no-restricted-require` rule in `eslint.config.js`. Not needed by consumers.
- Verified in `theme-elementary` — both configs load and fire rules correctly against real source files.

---

## Handoff log

_(no rotations yet — delete this line when the first entry is added)_
