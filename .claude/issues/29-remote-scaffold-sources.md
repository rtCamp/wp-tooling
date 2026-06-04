# Issue #29 — Serve scaffolds from another repo (per-repo sources + upstream index)

**Status:** in-review <!-- in-progress | in-review | done -->
**Branch:** `v1.0.0/task/remote-scaffold-inventory`
**PR:** #30
**Assignee:** @Adi-ty

---

## Summary

Scaffold authors should be able to keep a scaffold's `scaffold.json` + templates in the repo that owns the convention, rather than vendoring every scaffold into wp-tooling. The engine fetches those scaffolds from pinned source repos so a single PR in the owning repo adds or changes a scaffold; wp-tooling only changes to onboard a new repo.

Two further engine capabilities were built on the same branch because they unblock the consuming effort (rtCamp/theme-elementary#639): **engine-side input discovery** (`discover_from`, so scaffold inputs auto-fill from the project instead of the caller guessing) and a **feature toggle layer** (scaffolds that can be turned on/off, persisted in `.wp-tooling.json`).

---

## Decisions made

- [2026-06-04] Remote scaffolds use **per-repo sources + an upstream index** (`scaffolds/sources.json` lists pinned `{ github, ref, path }`; each repo publishes `scaffolds/index.json`) rather than a single central inventory file — keeps ownership with the source repo. `source: "repository"` was dropped during this evolution; do not reintroduce.
- [2026-06-04] `discover_from` precedence is `supplied → discovered → default` and is **fail-safe** — `loadDiscovery` reads `composer.json`/`package.json`/`.wp-tooling.json` tolerantly (never throws); anything unresolved returns `undefined` so the caller falls back to `default`.
- [2026-06-04] `isPathInput()` heuristic: inputs whose key looks path-shaped (`*_path`, `*_dir`, `base_path`) keep their `default` and are **not** overwritten by a PSR-4 namespace discovery, since the PSR-4 root dir is rarely a scaffold's target sub-path.
- [2026-06-04] Added an input `transform` step; `json-escape` doubles backslashes so the PSR-4 composer autoload key renders as valid JSON (`namespace_json` derived input on `setup/psr4`).
- [2026-06-04] Feature engine verbs are **TTY-free** — `disable()` takes an injected `confirmRemove` callback so the UI layer owns prompting; the engine never imports a prompt. `.gitignore` lines are Mustache-rendered against the resolved inputs (`renderFeatureLines`) so placeholders never leak.
- [2026-06-04] `terminal.js`: on stdin close, in-flight line readers now **reject with `CancelledError`** instead of resolving `''` — resolving empty looped forever on any prompt with a required validator.

---

## Files changed so far

- `src/scaffolds/registry.js` — edited (remote fetch/scan, `discover_from` resolution, feature `enable`/`disable`/`status` verbs, gitignore helpers)
- `src/scaffolds/fetch.js`, `cache.js`, `list.js`, `add.js` — edited (remote fetch + cache, online-preferred list, CLI plumbing)
- `src/scaffolds/cli-support.js` — new (shared `add`/`features` CLI helpers)
- `src/scaffolds/config.js` — new (`.wp-tooling.json` read/write)
- `src/scaffolds/features.js` + `src/cli/commands/features.js` — new (`wp-tooling features` command)
- `src/scaffolds/schema.js`, `validate.js`, `render.js` — edited (`feature` block, `discover_from`, `transform`)
- `src/ui/style/index.js` — new (TTY-aware `style` helper); `src/ui/core/terminal.js`, `src/ui/index.js` — edited
- `scaffolds/setup/tailwind/**` — new (toggleable feature); `scaffolds/setup/psr4`, `scaffolds/wp/*` — edited (`discover_from`)
- `scaffolds/lint/phpstan/**` — edited (point at `rtcamp/wp-phpstan` baseline)
- `tests/scaffolds/*` + `tests/ui/style.test.js` — new/edited (engine, discovery, feature, traversal, manifests)
- `CHANGELOG.md`, `docs/ai-orchestration.md`, `docs/authoring-scaffolds.md` — edited

---

## Verification run

```bash
$ npm run check          # eslint src tests && jest
# ESLint: clean
# Tests: 635 passed, 45 suites
```

The new engine surfaces were additionally smoke-tested through the `wp-tooling` CLI in a throwaway project (`discover_from` namespace reuse from `composer.json`; `features --enable` / `--disable`) — copy-paste commands are in the PR's *How I verified*.

Backward-compat asserted: `execute()` result shape unchanged (only additive `engine.inputs` / `scaffold.kind`); the `feature` block never surfaces in the `add`/`execute` path; discovery never throws on missing/malformed project files. Bundled `setup/psr4` + `wp/cli` manifests are checked end-to-end (rendered wiring parses as JSON; PSR-4 root grafted onto kind sub-namespaces).

---

## Open questions

- _(none blocking)_

---

## Notes for the reviewer

- Three features land in one PR: remote sources were this branch's original scope; `discover_from` + the feature layer were added on top to unblock theme-elementary#639. Happy to split if preferred.
- The live-remote round-trip is covered deterministically by Jest; an end-to-end fetch additionally depends on network and a published source index.
- `discover_from` multi-PSR-4 heuristic takes the *first* `psr-4` map key as the root namespace (documented in `registry.js`); path-shaped inputs keep their default.

---

## Handoff log

_(no rotations yet — delete this line when the first entry is added)_
