# Issue wp-devtools#22 — Add `wp-tooling perf` command + runner (two-layer: web-vitals/Lighthouse + server xhprof)

**Status:** in-progress <!-- in-progress | in-review | done -->
**Branch:** `v1.0.0/task/perf-runner`
**PR:** #<pr-number> <!-- fill once opened -->
**Assignee:** @Adi-ty

---

## Summary

rtCamp/wp-devtools#22 asks for a `wp-tooling perf` command mirroring the shipped `a11y` runner: one normalised JSON report an agent (or CI) can act on. Per the (cross-repo) planning docs' two-layer model, Layer 1 is the *symptom* — lab Core Web Vitals via the `web-vitals` attribution build under headless Chromium, plus Lighthouse — and Layer 2 is the *cause* — server-side function hotspots via xhprof, run over WP-CLI through a consumer-installed `server-profile.php` shim. This task ships both layers, the `setup/perf` scaffold that installs the consumer-side wiring, and verifies end-to-end on two consumers with real profiler data.

---

## Decisions made

- [2026-07-14] The server-side profiler moved mid-task from `rtCamp\WPFramework\Utils\XHProf_Profiler` (wp-framework) to `rtCamp\WPDevTools\Support\XHProfProfiler` (wp-dev-tools) — wp-framework#51 was closed unmerged because profiling is dev tooling, not an architectural component; the reviewed class was ported to wp-dev-tools (PR #66) as a plain class outside the `RT_DEV_TOOLS_DEV_MODE` gate, installed by consumers as `composer require --dev rtcamp/wp-dev-tools`. This task consumes that class; it does not reimplement xhprof.
- [2026-07-14] `server-profile.php`'s hardening (canonical-redirect hazard, `$_GET` query-string copy, output-buffer draining, STDERR route diagnostic, no `declare(strict_types)`) was designed and live-tested against `features-plugin-skeleton` before being adapted into the scaffold template — `redirect_canonical()` ends the request with `exit()`, which bypasses `finally`, so a canonical redirect would otherwise kill the process before the profiler's `stop()` runs or the JSON is echoed; the shim removes that hook, profiles with `start()`/`stop()` instead of `profile()`, and installs a `register_shutdown_function` fallback that drains open output buffers before emitting JSON.
- [2026-07-14] Config file is `.perfrc.json` (analogous to `.pa11yci.json`), but unlike `a11y` it is OPTIONAL when `--url` is supplied — the perf issue explicitly adds a repeatable `--url` flag, and a project should be able to run a one-off perf check with zero setup. `--url` replaces the config's `urls[]` entirely; every other section (webVitals/lighthouse/server/thresholds) still comes from the file when one exists. A malformed config is always `EBADJSON`, even with `--url`.
- [2026-07-14] Every per-URL layer failure downgrades independently rather than aborting the run: a page-load failure becomes a `scanError` (contributes to `summary.failedUrls`, final exit 1 — same semantics as `a11y`'s unreachable-URL handling); a Lighthouse or server-profile runtime failure degrades that URL's layer to `null`/empty + a note, with **no effect on the exit code** — the server layer especially is auxiliary cause-data, so a broken WP-CLI invocation must never take down the frontend result.
- [2026-07-14] `server-profile.js` (the Node-side WP-CLI invoker) never throws — every failure mode (spawn error, non-zero exit, unparseable stdout) returns `{ data: null, error: <detail> }` instead, because a thrown error would need per-call try/catch discipline at every call site to preserve the degrade-not-abort policy; returning a tagged result makes that policy the only path.
- [2026-07-14] INP is hardcoded to `null` in the normalised report regardless of what the frontend collector harvests — the collector never performs a user interaction, so a raw INP reading would be a fluke, not a measurement. Surfaced as an explicit `assessment` line rather than silently omitted.
- [2026-07-14] `puppeteer` resolution for `run.js` goes through a new `requireModule()` helper in `resolve-module.js` (walk `node_modules`, then `require()` the resolved directory) rather than an inline dynamic `require()` in `run.js` itself — this keeps `run.js` mockable via `jest.mock('./resolve-module')` with zero real puppeteer install needed in CI, mirroring how `collect-vitals.js` takes the browser as a parameter instead of resolving it.
- [2026-07-14] Housed in wp-tooling (`src/perf/`), distributed via a new `setup/perf` scaffold, matching the `a11y`/`setup/pa11y` precedent — issue #22 defers the scaffold to a later task, but end-to-end verification against a real consumer needs the consumer-side wiring (deps, config, shim) to exist, so it ships in this PR rather than a follow-up.
- [2026-07-14] `npm run check` on the branch point (`release/v1.0.0`) had two pre-existing failures unrelated to this task (`no-shadow` on `cap` + prettier wrapping in `src/init/index.js` and `tests/ui/selects.test.js`) — the same issue already fixed on the (still-open) a11y branch but never merged. Fixed here with the identical minimal rename (`cap` → `entry`) so `npm run check` is verifiable; documented rather than silently folded in.
- [2026-07-14] Live end-to-end testing surfaced a real bug: puppeteer 25.x's `executablePath()` returns a `Promise`, not a string (older versions returned it synchronously). `run.js` now `await`s it — safe either way, since `await` on a non-Promise value just returns it. Caught only because verification used a real, current puppeteer install rather than a mocked one.

---

## Files changed so far

- `src/perf/errors.js` — new (`RunnerError`: `EBINMISSING` / `EBINFAIL` / `EBADJSON` / `ENOURLS`)
- `src/perf/resolve-bin.js` — new (consumer binary resolution for `lighthouse`, mirrors `src/a11y/resolve-bin.js`)
- `src/perf/resolve-module.js` — new (consumer module resolution for `puppeteer`/`web-vitals`; `requireModule` loader for testability)
- `src/perf/config.js` — new (`.perfrc.json` resolution, section-merge over defaults, `--url` precedence)
- `src/perf/collect-vitals.js` — new (headless web-vitals attribution collection; puppeteer/browser passed in as parameters)
- `src/perf/lighthouse.js` — new (per-URL Lighthouse invocation, `CHROME_PATH` pin)
- `src/perf/server-profile.js` — new (per-URL WP-CLI shim invocation; never throws, always degrades)
- `src/perf/normalize.js` — new (pure two-layer normaliser: ratings, worst-metric pick, issue counting, Lighthouse/server extraction)
- `src/perf/run.js` — new (`runPerf()` core + `runCli()` adapter; exit codes 0/1/2/3)
- `src/perf/index.js` — new (barrel exposed as `@rtcamp/wp-tooling/perf`)
- `src/cli/commands/perf.js` — new (dispatcher shim)
- `package.json` — edited (`"./perf"` exports entry)
- `tests/perf/*` — new (cli, config, collect-vitals, lighthouse, server-profile, normalize, resolve-module specs + fixtures)
- `scaffolds/setup/perf/scaffold.json` — new
- `scaffolds/setup/perf/templates/.perfrc.json.mustache` — new
- `scaffolds/setup/perf/templates/server-profile.php` — new (raw copy, no Mustache rendering)
- `tests/scaffolds/bundled-manifests.test.js` — edited (three `setup/perf rendered config` cases: default render, custom inputs + server enabled, raw-copy byte-equality)
- `CHANGELOG.md` — edited (two Unreleased entries)
- `src/init/index.js`, `tests/ui/selects.test.js` — edited (pre-existing lint-gate errors at `release/v1.0.0` HEAD: `no-shadow` on `cap`, prettier wrapping; `npm run check` fails without these fixes)

---

## Verification run

```bash
$ npm run check          # eslint src tests && jest
# ESLint: clean
# Tests: 761 passed, 57 suites
```

Tested live end-to-end on two independent WordPress installs running under wp-env (Alpine `cli` containers, xhprof pecl-installed fresh into each), each with `@rtcamp/wp-tooling` installed as a dev dependency and `rtcamp/wp-dev-tools` wired in via composer for the server layer:

- `--dry-run` resolved the local `puppeteer` (25.3.0), the `web-vitals` attribution build, `lighthouse` (13.4.0), and the WP-CLI server command on both installs, with nothing reported `NOT FOUND`.
- A full `--output json` run against three URLs (front page, a single post, a search page) on each install returned complete data for every result: real LCP/CLS/FCP/TTFB values with ratings (INP `null` throughout, as designed), real Lighthouse `performance` scores with audits, and real xhprof top-N function lists (wall-time descending, plausible WordPress call stacks) — `failedUrls: 0` on both, exits split across 0 (clean) and 3 (a forced Lighthouse-threshold breach) as expected.
- Exercised against **two independently written `server-profile.php` variants** (each install's own pre-existing shim, left untouched rather than overwritten by the scaffold — the engine correctly skipped both): both returned identical-shaped, complete profiler output, confirming the Node-side `server-profile.js`/`normalize.js` handle real-world shim variance correctly.
- Specifically proved the canonical-redirect hardening: switched one install to pretty permalinks (`wp rewrite structure '/%postname%/'`), confirmed via `curl` that the query-string URL now issues a real HTTP 301, then re-ran the shim against that exact URL — it still returned complete, valid JSON (no truncation from a mid-render `exit()`), then reverted the permalink structure.
- Verified the config-less path (`--config <missing> --url <url>`, no `.perfrc.json` at all): frontend + Lighthouse layers still ran; `server: null` as designed (defaults to disabled without a config).
- Verified `--url` overriding an *existing* config's `urls[]` while its other sections (server, thresholds) still applied.
- Verified the scaffold never overwrites an existing `server-profile.php` (both installs already had one).
- Found and fixed one real bug via this live testing: puppeteer 25.x's `executablePath()` returns a `Promise`, not a string — `run.js` was calling it synchronously. Fixed by awaiting it (safe for both sync and async puppeteer versions).

---

## Open questions

- _(none blocking)_

---

## Notes for the reviewer

- The exit-code contract mirrors `a11y`: 0 clean · 1 run failure or unreachable URL · 2 usage/module-missing · 3 issues found. `failedUrls > 0` downgrades an otherwise-clean run to exit 1, same as `a11y`.
- `puppeteer`, `web-vitals`, and `lighthouse` are never dependencies of `@rtcamp/wp-tooling` (zero-runtime-deps rule) — the runner resolves the consumer's install; Lighthouse falls back to `npx --no-install` and never fetches from the network.
- The server layer's dependency (`rtcamp/wp-dev-tools`) is not on Packagist — consumers add it via a path or VCS composer repository. The scaffold description says so; the shim's `class_exists` guard keeps a project without it working (frontend layers only, `server: null`).
- `wp-dev-tools` is itself mid-development (`XHProfProfiler` port on an open PR, not yet on its default branch) — this task tracks the class name/namespace it settled on, not a specific commit; if the class is renamed again before merge, only the scaffold's shim template and this file's decisions need updating, not the Node runner (it only shells out to WP-CLI, it never references the PHP class by name).

---

## Handoff log

_(no rotations yet — delete this line when the first entry is added)_
