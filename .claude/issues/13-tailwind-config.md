# Issue #13 — Add Tailwind CSS v4 webpack plugin (tailwind-config)

**Status:** in-review
**Branch:** `v1.0.0/task/tailwind-config`
**PR:** https://github.com/rtCamp/wp-tooling/pull/14
**Assignee:** @Swanand01

---

## Summary

rtCamp themes that opt into Tailwind CSS need a way to keep Tailwind design tokens in sync with `theme.json` without manual duplication. Tailwind v4 uses CSS-first configuration via `@theme {}` — there is no `tailwind.config.js` — so the bridge between WordPress preset CSS variables and Tailwind utility namespaces must be generated at build time. This module ships a webpack plugin that does that automatically and a shareable PostCSS config so consumers don't need to know the setup details.

---

## Decisions made

- [2026-05-18] Implemented as a module inside `@rtcamp/wp-tooling` (`./tailwind-config`) rather than a standalone `@rtcamp/tailwind-config` package — avoids a separate repo/package for two files
- [2026-05-18] Tailwind v4 (not v3) — original issue assumed v3 preset approach; v4's CSS-first config makes the webpack plugin the correct primitive
- [2026-05-18] PostCSS config exported as `./tailwind-config/postcss` — consumers require it directly in `postcss.config.js` rather than manually wiring `@tailwindcss/postcss`
- [2026-05-18] `tailwindcss` and `@tailwindcss/postcss` added as `peerDependencies` — consumers on `@wordpress/scripts` will already have them after installing the Tailwind packages
- [2026-05-18] No runtime dependencies — only Node built-ins (`fs`, `path`) used in the plugin
- [2026-05-25] `@source` directive is computed dynamically, not hardcoded — `generateEntryScaffold()` uses `path.relative(cssDir, process.cwd())` to derive the path from the CSS output directory back to the project root (assumed to be `process.cwd()`, i.e. where webpack is invoked). For the default output path (`src/css/frontend/tailwind.css`) this produces `@source "../../../";`. Tailwind v4 auto-detection is not relied on.
- [2026-05-25] Plugin split into two outputs: `_tailwind-theme.css` (always regenerated from `theme.json`, gitignored) and `tailwind.css` (scaffolded once, then owned by the consumer). `_tailwind-theme.css` contains only the `@theme {}` WP-preset mapping block. `tailwind.css` imports it and is never overwritten after first run. This resolves the CI dirty-tree concern raised in review — only the gitignored file changes during build.

---

## Files changed so far

- `src/tailwind/GenerateTailwindThemePlugin.js` — new
- `src/tailwind/postcss.js` — new
- `src/tailwind/index.js` — new
- `package.json` — added `./tailwind-config` and `./tailwind-config/postcss` exports, `peerDependencies`
- `CHANGELOG.md` — new

---

## Verification run

```bash
$ node -e "const { GenerateTailwindThemePlugin } = require('./src/tailwind'); console.log(typeof GenerateTailwindThemePlugin)"
function

$ npm run lint
# zero errors
```

---

## Open questions

- _(none)_

---

## Notes for the reviewer

- The original issue (rtCamp/theme-elementary#636) was written for Tailwind v3. The approach diverges intentionally — v4 has no `tailwind.config.js`.
- `theme-elementary` uses this via a local `file:` reference during development; will switch to the published version post-release.
- Preflight is disabled by design — only `tailwindcss/theme.css` and `tailwindcss/utilities.css` are imported to avoid conflicts with block editor styles.

---

## Handoff log

_(no rotations yet — delete this line when the first entry is added)_
