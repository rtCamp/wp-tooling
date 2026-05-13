# Issue #6 — Add detect-changes CLI and bin/wp-tooling dispatcher

**Status:** in-progress
**Branch:** `v1.0.0/task/detect-changes`
**PR:** #7
**Assignee:** @Adi-ty

---

## Summary

Consolidate the per-skeleton modified-files helper into `@rtcamp/wp-tooling/ci`, exposed as a `detect-changes` script. Default bucket regexes (css/js/php/gha) and the default ignore regex live in the package so every skeleton stays in lockstep automatically; `--ignore` remains overridable for project-specific path exclusions. Diff base auto-detection (PR via `GITHUB_BASE_REF`, push via `HEAD~1`) and the file-list dance move out of YAML into the script, replacing a multi-step bash block with a single command.

---

## Decisions made

- [2026-05-08] Scope cut then restored: initially shipped the script alone with a temporary `if (require.main === module)` trampoline; the dispatcher (`bin/wp-tooling` + `src/cli/index.js`) landed in the same PR after end-to-end testing. Trampoline removed; the script is no longer directly runnable -- entry is `npx wp-tooling detect-changes` or `./bin/wp-tooling.js detect-changes`.
- [2026-05-08] Dispatcher uses lazy `require()` per subcommand inside the `COMMANDS` map, so cold-start cost stays close to a single subcommand's footprint. Stories 04/07 add their entries the same way.
- [2026-05-08] Top-level flags (`--help`, `-h`, `--version`, `-v`) are handled in the dispatcher; subcommand-specific flags pass through. `wp-tooling detect-changes --help` routes through to the subcommand's own help so each command owns its own usage text.
- [2026-05-08] Exit codes: 0 success, 1 runtime/I/O failure, 2 usage error. Subcommand exit codes propagate unchanged through the dispatcher.
- [2026-05-08] `--dry-run` is meaningful only in `github` output mode -- the file write to `$GITHUB_OUTPUT` is the command's only real side effect. Under dry-run + github, the would-be lines print to stdout with a `[dry-run]` prefix; the file is not touched (verified by reading the file before/after in the test suite). Text and JSON modes are unaffected since their output *is* the answer.
- [2026-05-08] Patterns are baked into the package; only `--ignore` is overridable in v1. Per-bucket regex overrides (e.g. `--bucket css=...`) can be added non-breakingly later if a real consumer needs them.
- [2026-05-08] Bucket regexes anchored where possible (`\.s?css$`, `(?:^|\/)package(?:-lock)?\.json$`) to avoid mid-path false positives like `my-package.json` matching the JS bucket.
- [2026-05-08] gha regex is permissive (`.+\.yml$` after `workflows/` or `actions/`). Initial draft used `[^/]+\.yml$` to rule out nested workflows, but composite actions live at `.github/actions/<name>/action.yml` (two components deep) and the strict form broke them. Workflows are flat in practice so the looser match is harmless.
- [2026-05-08] DEFAULT_IGNORE has no trailing `\/` after the lookaheads. The original issue body proposed `\.github\/(?!workflows)(?!actions)\/|...` (with trailing slash); that pattern fails for non-nested ignores like `.github/dependabot.yml` or `.github/CODEOWNERS`. Dropped the slash; tests covered it.
- [2026-05-08] On any git failure (shallow clone, missing ref) the script writes a clear stderr message and returns an empty file list. Workflow does not crash on a misconfigured checkout; it just gates everything as "no changes" and surfaces the reason.
- [2026-05-08] `--output github` warns rather than errors when `$GITHUB_OUTPUT` is unset, so local testing of the github mode does not blow up.
- [2026-05-11] Post-review fix (push-mode diff base): `resolveBaseRef()` now prefers `payload.before` from `$GITHUB_EVENT_PATH` for push events and falls back to `git fetch --deepen=1` before returning `HEAD~1`. The original `HEAD~1`-only fallback failed silently under `actions/checkout`'s default `fetch-depth: 1`, producing all-zero counts and exit 0 — CI would skip jobs on real changes.
- [2026-05-11] Post-review fix (argv values): `parseArgs` routes every value-taking flag (`--output`, `--ignore`, `--base`, `--files`) through a shared `takeValue` helper that rejects missing values and adjacent flags. Caught `--files --output json` (was swallowing `--output` as the file path) and `--files` at end-of-argv (was silently falling back to git-diff mode). Literal `-` still accepted as the stdin sentinel.
- [2026-05-11] Post-review fix (invalid `--ignore` regex): `runCli` validates the regex eagerly at the CLI boundary, returning a one-line `detect-changes: invalid --ignore regex "..."` with exit 2 instead of the raw Node `SyntaxError` stack. Library `resolveIgnore` behaviour unchanged — bad regex strings still surface as real errors to programmer callers.
- [2026-05-13] Added `--include-files` (library: `includeFiles: true`) on review request — surfaces the matching file paths per bucket so downstream workflows can lint or test only the changed files. Opt-in, not default, for two reasons: (1) `$GITHUB_OUTPUT` has a per-output size limit and a large changeset would otherwise bloat every step output; (2) preserves the original counts-only contract for any existing consumer. The result object stays a flat record (`<bucket>-count` always; `<bucket>-files` when opted in), so it reads as a planned extension rather than a bolt-on layer.
- [2026-05-13] Output formatting per mode: JSON serialises arrays natively; text mode space-joins paths on the same line as the key (Unix pipe-friendly); GitHub mode uses the multi-line heredoc syntax with a fixed `EOF_WP_TOOLING` delimiter for non-empty buckets and the compact `key=` form for empty ones. File paths cannot contain newlines, so a fixed delimiter is safe.

---

## Files changed so far

- `bin/wp-tooling.js` — new (executable shim, `chmod +x`)
- `src/cli/index.js` — new (dispatcher + subcommand registry)
- `src/ci/detect-changes.js` — new (library + `runCli` for the dispatcher)
- `src/ci/index.js` — new (barrel)
- `tests/cli/index.test.js` — new (11 tests)
- `tests/ci/detect-changes.test.js` — new (42 tests)
- `CHANGELOG.md` — new (Unreleased entry)
- `.claude/issues/6-detect-changes.md` — new (this file)

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

 PASS  tests/ci/detect-changes.test.js
  detectChanges
    ✓ counts files into the right buckets (1 ms)
    ✓ default ignore excludes docs and .wordpress-org (1 ms)
    ✓ default ignore preserves .github/workflows and .github/actions
    ✓ lockfile changes count under both css and js buckets
    ✓ phpstan.neon and phpstan.neon.dist count as php
    ✓ composer.json and composer.lock count as php
    ✓ string --ignore overrides the default
    ✓ RegExp --ignore is accepted directly
    ✓ null ignore disables filtering
    ✓ empty-string ignore disables filtering
    ✓ invalid ignore type throws TypeError (9 ms)
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
    ✓ --help prints usage and exits 0 (1 ms)
    ✓ unknown flag exits 2 with stderr message
    ✓ invalid --output exits 2
    ✓ --files <path> with --output json prints valid JSON (1 ms)
    ✓ --output github appends key=value lines to $GITHUB_OUTPUT (1 ms)
    ✓ --output github warns to stderr when GITHUB_OUTPUT is unset
    ✓ --dry-run parses cleanly and exits 0 (1 ms)
    ✓ --dry-run + --output github does not touch $GITHUB_OUTPUT and previews to stdout
    ✓ --dry-run + --output github previews even when $GITHUB_OUTPUT is unset (1 ms)
    ✓ text mode prints key: value lines
    ✓ --ignore overrides default
    ✓ missing --files path exits 1 with stderr message
    ✓ --files followed by another flag exits 2 (does not swallow the flag)
    ✓ --files at end of argv exits 2
    ✓ --ignore followed by another flag exits 2
    ✓ --files - is accepted as the stdin sentinel (parser does not reject lone dash)
    ✓ --include-files in json mode emits <bucket>-files arrays (1 ms)
    ✓ --include-files in text mode prints space-joined paths
    ✓ --include-files in github mode writes heredoc multi-line outputs (1 ms)
    ✓ --include-files dry-run previews heredoc blocks without writing
    ✓ invalid --ignore regex exits 2 with a clean usage error (1 ms)

 PASS  tests/cli/index.test.js
  cli main()
    ✓ no args prints top-level usage and exits 0
    ✓ --help prints top-level usage
    ✓ -h prints top-level usage
    ✓ --version prints package version and exits 0
    ✓ -v prints package version (1 ms)
    ✓ unknown top-level flag exits 2 with stderr message
    ✓ unknown subcommand exits 2 with stderr message
    ✓ routes detect-changes --help to its runCli
    ✓ routes detect-changes through to its runCli with args (1 ms)
    ✓ detect-changes propagates a usage-error exit code
  cli COMMANDS registry
    ✓ detect-changes is registered with a summary and run handler

Test Suites: 2 passed, 2 total
Tests:       53 passed, 53 total
Snapshots:   0 total
Time:        0.159 s, estimated 1 s
Ran all test suites.
❯ ./bin/wp-tooling.js
Usage: wp-tooling <command> [options]

Commands:
  detect-changes  Bucket changed files for CI gating

Global options:
  --help, -h        Print this help.
  --version, -v     Print the package version.

Run `wp-tooling <command> --help` for command-specific options.
❯ ./bin/wp-tooling.js detect-changes --help
Usage: detect-changes [options]

  --output <text|json|github>   Output format (default: text).
  --ignore <regex>              Override the default ignore regex.
                                Pass an empty string to disable ignoring.
  --base <ref>                  Override the diff base ref.
  --files <path|->              Read newline-delimited file list from a path
                                or stdin (`-`); skip git entirely.
  --include-files               Include the matching file paths per bucket in the output.
  --dry-run                     With --output github, preview to stdout (no file write).
  --help, -h                    Print this help.
❯ printf 'src/foo.js\nsrc/style.scss\ncomposer.json\n.github/actions/setup/action.yml\ndocs/foo.md\n' \
    | ./bin/wp-tooling.js detect-changes --files - --include-files --output json
{"total-count":4,"ignored-count":1,"css-count":1,"js-count":1,"php-count":1,"gha-count":1,"total-files":["src/foo.js","src/style.scss","composer.json",".github/actions/setup/action.yml"],"ignored-files":["docs/foo.md"],"css-files":["src/style.scss"],"js-files":["src/foo.js"],"php-files":["composer.json"],"gha-files":[".github/actions/setup/action.yml"]}
❯ ./bin/wp-tooling.js frobnicate; echo "exit=$?"
wp-tooling: unknown command "frobnicate"
Run `wp-tooling --help` for the list of commands.
exit=2
❯ printf 'src/foo.js\nsrc/style.scss\ncomposer.json\n.github/actions/setup/action.yml\ndocs/foo.md\n' \
  | ./bin/wp-tooling.js detect-changes --files - --include-files --output json
{"total-count":4,"ignored-count":1,"css-count":1,"js-count":1,"php-count":1,"gha-count":1,"total-files":["src/foo.js","src/style.scss","composer.json",".github/actions/setup/action.yml"],"ignored-files":["docs/foo.md"],"css-files":["src/style.scss"],"js-files":["src/foo.js"],"php-files":["composer.json"],"gha-files":[".github/actions/setup/action.yml"]}
```

---

## Open questions

- Worth exposing per-bucket overrides (`--bucket name=regex`) for v1, or wait for a usecase? Default is to wait.

---

## Notes for the reviewer

- Patterns mirror the existing per-skeleton helpers but are stricter at the boundaries (anchored). Tests cover the boundary cases (lockfiles in CSS+JS, phpstan baseline as PHP, actions vs workflows in GHA, nested non-workflow yml ignored).
- Library entry point is `require('@rtcamp/wp-tooling/ci')` -> `{ detectChanges, DEFAULT_PATTERNS, DEFAULT_IGNORE }`. The package.json `./ci` export already points at `src/ci/index.js` from earlier setup.

---

## Handoff log

_(no rotations yet — delete this line when the first entry is added)_
