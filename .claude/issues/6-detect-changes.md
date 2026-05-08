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

---

## Files changed so far

- `bin/wp-tooling.js` — new (executable shim, `chmod +x`)
- `src/cli/index.js` — new (dispatcher + subcommand registry)
- `src/ci/detect-changes.js` — new (library + `runCli` for the dispatcher)
- `src/ci/index.js` — new (barrel)
- `tests/cli/index.test.js` — new (11 tests)
- `tests/ci/detect-changes.test.js` — new (30 tests)
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

 PASS  tests/cli/index.test.js
  cli main()
    ✓ no args prints top-level usage and exits 0 (1 ms)
    ✓ --help prints top-level usage
    ✓ -h prints top-level usage
    ✓ --version prints package version and exits 0
    ✓ -v prints package version
    ✓ unknown top-level flag exits 2 with stderr message
    ✓ unknown subcommand exits 2 with stderr message
    ✓ routes detect-changes --help to its runCli (2 ms)
    ✓ routes detect-changes through to its runCli with args (1 ms)
    ✓ detect-changes propagates a usage-error exit code
  cli COMMANDS registry
    ✓ detect-changes is registered with a summary and run handler (1 ms)

 PASS  tests/ci/detect-changes.test.js
  detectChanges
    ✓ counts files into the right buckets
    ✓ default ignore excludes docs and .wordpress-org
    ✓ default ignore preserves .github/workflows and .github/actions
    ✓ lockfile changes count under both css and js buckets
    ✓ phpstan.neon and phpstan.neon.dist count as php
    ✓ composer.json and composer.lock count as php
    ✓ string --ignore overrides the default
    ✓ RegExp --ignore is accepted directly
    ✓ null ignore disables filtering
    ✓ empty-string ignore disables filtering
    ✓ invalid ignore type throws TypeError (6 ms)
    ✓ accepts a newline-delimited string for files (1 ms)
    ✓ tolerates Windows line endings in file list
    ✓ invalid files type throws TypeError
    ✓ returns zero counts for an empty list
    ✓ gha bucket excludes nested-directory yml files outside workflows/actions
  exports
    ✓ DEFAULT_PATTERNS has the four expected buckets
    ✓ DEFAULT_IGNORE matches docs/, .wordpress-org/, and .github/ non-workflow paths
  runCli
    ✓ --help prints usage and exits 0
    ✓ unknown flag exits 2 with stderr message
    ✓ invalid --output exits 2
    ✓ --files <path> with --output json prints valid JSON (1 ms)
    ✓ --output github appends key=value lines to $GITHUB_OUTPUT (2 ms)
    ✓ --output github warns to stderr when GITHUB_OUTPUT is unset
    ✓ --dry-run parses cleanly and exits 0
    ✓ --dry-run + --output github does not touch $GITHUB_OUTPUT and previews to stdout (1 ms)
    ✓ --dry-run + --output github previews even when $GITHUB_OUTPUT is unset (1 ms)
    ✓ text mode prints key: value lines
    ✓ --ignore overrides default
    ✓ missing --files path exits 1 with stderr message (1 ms)

Test Suites: 2 passed, 2 total
Tests:       41 passed, 41 total
Snapshots:   0 total
Time:        0.131 s, estimated 1 s
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
  --dry-run                     With --output github, preview to stdout (no file write).
  --help, -h                    Print this help.
❯ printf 'src/foo.js\nsrc/style.scss\ncomposer.json\n.github/actions/setup/action.yml\ndocs/foo.md\n' \
    | ./bin/wp-tooling.js detect-changes --files - --output json
{"total-count":4,"ignored-count":1,"css-count":1,"js-count":1,"php-count":1,"gha-count":1}
❯ ./bin/wp-tooling.js frobnicate; echo "exit=$?"
wp-tooling: unknown command "frobnicate"
Run `wp-tooling --help` for the list of commands.
exit=2
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
