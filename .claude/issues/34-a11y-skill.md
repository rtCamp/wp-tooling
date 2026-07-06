# Issue #34 — Add accessibility skill and wp-tooling a11y runner (pa11y-ci)

**Status:** in-progress <!-- in-progress | in-review | done -->
**Branch:** `v1.0.0/task/a11y-skill`
**PR:** #<pr-number> <!-- fill once opened -->
**Assignee:** @Adi-ty

---

## Summary

WordPress developers — and the coding agents working alongside them — need a fast, local loop to find and fix accessibility (WCAG2AA) problems in a plugin or theme. pa11y is already the org's established accessibility engine (installed and configured by the `setup/pa11y` scaffold), but there was no local, agent-driven command that turns pa11y's output into something an agent can act on and trace back to source.

This task adds a `wp-tooling a11y` command that runs the consumer-installed `pa11y-ci` and hands back a normalised report, plus a companion Claude Code `accessibility` skill that maps each violation's DOM selector to the template, block, or PHP that rendered it and fixes it with consent. Accessibility is a rendered-DOM concern, so this stays pure Node reusing pa11y — no WordPress ability, no MCP.

---

## Decisions made

- [2026-07-06] No `--url` flag — the runner is **config-driven only** (`.pa11yci.json` or `--config <path>`). pa11y-ci merges cwd-config URLs with positional CLI URLs, so a flag could not reliably override the config without temp-config patching; a single source of truth keeps the runner clean.
- [2026-07-06] `setup/pa11y` dependency pin corrected `pa11y-ci ^6.0.0` → `^4.1.1` (6.x does not exist on npm; 4.1.1 is latest). The scaffold's dep merge is non-destructive, so only fresh projects were affected.
- [2026-07-06] URL-level load failures (`net::ERR_*`) are classified as `scanError` + `summary.failedUrls`, never as violations; the CLI exits 1 for them (environment problem), keeping exit 3 meaningful.
- [2026-07-06] The `accessibility` skill treats `setup/pa11y` as one way to get a config, not a requirement — a project with its own pa11y setup works as-is.
- [2026-07-06] Skill housed in wp-tooling (`skills/accessibility/`) and distributed via `setup/claude-skills`, rather than wp-dev-tools as the Phase 2 plan sketches, because wp-dev-tools has no public repo yet for remote scaffold sources. Migrate later if the lens suite consolidates there.
- [2026-07-06] `setup/pa11y` template ships `"runners": ["axe", "htmlcs"]` (the engines catch disjoint issues — proven in the evals: axe found a nested-list violation htmlcs missed) per the Phase 2 plan §5.3.
- [2026-07-06] Template URLs changed to project-owned surfaces: front page + `sample_page` (default `/?p=1`) + `search_page` (default `/?s=hello`) + optional `extra_page`, each appended to `base_url`. `wp-admin`/`wp-login` dropped: unauthenticated `/wp-admin/` only audits the login redirect (double-counting it), and `wp-login.php` chrome is core-owned — permanently exit-3 on findings no project can fix. Page paths are scaffold inputs (engine renderer cannot iterate lists, so slot inputs + a falsy-omitted section; further URLs are added directly in the generated file).

---

## Files changed so far

- `src/a11y/errors.js` — new (`RunnerError`: `EBINMISSING` / `EBINFAIL` / `EBADJSON` / `ENOURLS`)
- `src/a11y/resolve-bin.js` — new (local/hoisted `.bin` walk-up, `npx --no-install` fallback, version probe)
- `src/a11y/urls.js` — new (resolve URLs from the pa11y config)
- `src/a11y/normalize.js` — new (pure normaliser: summary counts, `wcagCriterion` parse, `domHints` extraction, `scanError` classification)
- `src/a11y/run.js` — new (`runA11y()` core + `runCli()` adapter; exit codes 0/1/2/3)
- `src/a11y/index.js` — new (barrel exposed as `@rtcamp/wp-tooling/a11y`)
- `src/cli/commands/a11y.js` — new (dispatcher shim)
- `package.json` — edited (`"./a11y"` exports entry)
- `tests/a11y/*` — new (cli, normalize, resolve-bin, urls specs + fixtures)
- `skills/accessibility/SKILL.md`, `skills/accessibility/evals/evals.json` — new (seven-step lens skill + 3 behavioural evals)
- `scaffolds/setup/claude-skills/**` — edited (manifest description + two `files[]` entries; two new template copies)
- `scaffolds/setup/pa11y/scaffold.json` — edited (dep pin fix)
- `skills/README.md` — edited (What's here + install snippets)
- `CHANGELOG.md` — edited (two Unreleased entries)
- `src/init/index.js`, `tests/ui/selects.test.js` — edited (pre-existing lint-gate errors at HEAD: `no-shadow` on `cap`, prettier wrapping; `npm run check` fails without these fixes)

---

## Verification run

```bash
$ npm run check          # eslint src tests && jest
# ESLint: clean
# Tests: 726 passed, 54 suites
```

Tested live end-to-end on a WordPress plugin running under wp-env, with `@rtcamp/wp-tooling` installed as a dev dependency and the skills installed via `setup/claude-skills`: `--dry-run` resolves the local `pa11y-ci` 4.1.1, the config and its URLs; a plugin-rendered alt-less `<img>` seeded on the front page produces H37 alongside WordPress core's F92/ARIA4 on wp-login → exit 3 with `failedUrls: 0`.

Skill evals ran as subagents from `skills/accessibility/evals/evals.json`, with all assertions passing: eval-1 (audit and fix) 8/8, eval-2 (missing setup) 5/5, eval-3 (upstream/unreachable) 6/6. Outputs and per-eval `grading.json` are kept locally (`skills/*-workspace/` is gitignored).

---

## Open questions

- _(none blocking)_

---

## Notes for the reviewer

- The exit-code contract is the API: 0 clean · 1 run failure or unreachable URL · 2 usage/binary missing · 3 violations. `failedUrls > 0` downgrades an otherwise-clean run to exit 1 so CI never greenlights a scan that silently loaded nothing.
- `pa11y-ci` is never a dependency of `@rtcamp/wp-tooling` (zero-runtime-deps rule) — the runner resolves the consumer's install and `npx --no-install` never fetches from the network.
- `skills/accessibility-workspace/` (eval outputs) is gitignored by the existing `skills/*-workspace/` rule.

---

## Handoff log

_(no rotations yet — delete this line when the first entry is added)_
