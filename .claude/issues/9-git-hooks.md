# Issue #9 — git hooks + install-hooks CLI

**Status:** in-progress <!-- in-progress | in-review | done -->
**Branch:** `v1.0.0/task/git-hooks`
**PR:** #11
**Assignee:** @Adi-ty

---

## Summary

Conventional Commits and lint-on-commit are non-negotiable in our flow, but every engineer setting them up by hand creates drift. This issue ships two POSIX-shell hook templates (`commit-msg`, `pre-commit`) plus a Node installer exposed as `wp-tooling install-hooks`. The hooks live in `wp-tooling`, not in each skeleton, so updates ship to all skeletons through a plain `npm update`. We deliberately avoid Husky to preserve our zero-runtime-dep policy.

---

## Decisions made

- [2026-05-15] Dispatcher-only CLI — no separate `bin/wp-tooling-install-hooks.js`. The detect-changes PR established a single `bin/wp-tooling.js` shim routing through `src/cli/index.js`; matching that keeps a single entry point.
- [2026-05-15] No TTY UI imports for now. The TTY UI Kit PR is unmerged; plain `process.stdout.write`/`stderr.write` is used. Spinner/confirm will be layered in once the UI kit lands.
- [2026-05-15] `--dry-run` is supported per CLAUDE.md non-negotiable, even though the issue body doesn't mention it.
- [2026-05-15] Resolve the hooks directory via `git rev-parse --git-common-dir` so submodule/worktree cases (where `.git` is a file) work transparently.
- [2026-05-15] Husky detection: if an existing hook contains a Husky signature (`.husky/`, `husky.sh`), the skip hint names Husky explicitly. Otherwise generic.
- [2026-05-15] shellcheck test skips when the binary isn't on `PATH`. The JS regex test against the commit-msg pattern always runs.
- [2026-05-15] Branch is currently rebased on top of `v1.0.0/task/detect-changes` (PR #7 unmerged). Will rebase onto `release/v1.0.0` once #7 merges.
- [2026-05-20] Rebased onto the dispatcher auto-discovery refactor on `v1.0.0/task/detect-changes`. The `install-hooks` registration moved from an edit to `src/cli/index.js` into a new `src/cli/commands/install-hooks.js` exporting `{ name, summary, run }`. No dispatcher edit on this branch.

---

## Files changed so far

- `src/hooks/templates/commit-msg` — new
- `src/hooks/templates/pre-commit` — new
- `src/hooks/install.js` — new
- `src/hooks/index.js` — new
- `src/cli/commands/install-hooks.js` — new (dispatcher auto-discovery picks it up; no edit to `src/cli/index.js`)
- `tests/hooks/install.test.js` — new
- `tests/hooks/templates.test.js` — new
- `tests/cli/index.test.js` — edited (cover `install-hooks` routing + registry presence)
- `CHANGELOG.md` — edited (Unreleased entry)

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

 PASS  tests/hooks/install.test.js
  installHooks
    ✓ installs both hooks with the executable bit set (27 ms)
    ✓ injects the version header right after the shebang (18 ms)
    ✓ skips when a hook already exists, prints the right reason (23 ms)
    ✓ detects Husky-managed hooks and tags the skip reason (22 ms)
    ✓ --force overwrites existing hooks (22 ms)
    ✓ --dry-run plans without touching the filesystem (22 ms)
    ✓ throws a clear error outside a git repository (11 ms)
    ✓ resolves the hooks dir when .git is a file (separate git dir) (18 ms)
  injectVersionHeader
    ✓ inserts the header between the shebang and the body
    ✓ returns the body unchanged when there is no newline
  looksLikeHusky
    ✓ matches the `.husky/` directory marker
    ✓ matches the husky.sh sourcing marker
    ✓ returns false for arbitrary hook scripts
  install-hooks runCli
    ✓ --help exits 0 and prints usage (1 ms)
    ✓ -h exits 0 and prints usage
    ✓ unknown flag exits 2 with a stderr message
    ✓ runs end-to-end inside a git repo, prints `installed` lines (17 ms)
    ✓ --dry-run prints planned actions, writes nothing (20 ms)
    ✓ outside a git repo exits 1 with a clear stderr message (5 ms)
    ✓ skipped existing hook reports the Husky hint on stdout (21 ms)

 PASS  tests/hooks/templates.test.js
  commit-msg template
    ✓ accepts "feat: add Logger"
    ✓ accepts "fix: handle empty CHANGELOG"
    ✓ accepts "docs: update README"
    ✓ accepts "feat(utilities): add Logger"
    ✓ accepts "fix(release): handle empty CHANGELOG"
    ✓ accepts "feat(ui)!: breaking change to wizard"
    ✓ accepts "chore(deps): bump eslint"
    ✓ accepts "ci(detect-changes): cover edge case"
    ✓ accepts "refactor(scaffolds): inline registry scan"
    ✓ rejects "wip"
    ✓ rejects "WIP: x"
    ✓ rejects "feat:" (1 ms)
    ✓ rejects "feat: "
    ✓ rejects "feat(): no scope chars allowed empty"
    ✓ rejects "random commit message"
    ✓ rejects "Feat: capitalised type"
    ✓ rejects "feature: not in type list" (1 ms)
    ✓ shell bypasses cover merge / revert / fixup / squash
  commit-msg template (end-to-end against /bin/sh)
    ✓ exits 0 for a valid Conventional Commit subject (8 ms)
    ✓ exits 1 for an invalid subject and prints guidance (5 ms)
    ✓ exits 0 for merge commits (4 ms)
    ✓ exits 0 for revert commits (4 ms)
    ✓ exits 0 for fixup! commits (3 ms)
  pre-commit template
    ✓ no-ops when package.json is absent (4 ms)
    ✓ no-ops when package.json has no lint:staged script (4 ms)
  shellcheck (optional)
    ✓ commit-msg passes shellcheck -s sh (45 ms)
    ✓ pre-commit passes shellcheck -s sh (20 ms)

 PASS  tests/ci/detect-changes.test.js
  detectChanges
    ✓ counts files into the right buckets (1 ms)
    ✓ default ignore excludes docs and .wordpress-org
    ✓ default ignore preserves .github/workflows and .github/actions
    ✓ lockfile changes count under both css and js buckets (1 ms)
    ✓ phpstan.neon and phpstan.neon.dist count as php
    ✓ composer.json and composer.lock count as php
    ✓ string --ignore overrides the default
    ✓ RegExp --ignore is accepted directly
    ✓ null ignore disables filtering
    ✓ empty-string ignore disables filtering
    ✓ invalid ignore type throws TypeError (8 ms)
    ✓ accepts a newline-delimited string for files
    ✓ tolerates Windows line endings in file list (1 ms)
    ✓ invalid files type throws TypeError
    ✓ returns zero counts for an empty list
    ✓ gha bucket excludes nested-directory yml files outside workflows/actions
    ✓ includeFiles adds <bucket>-files arrays alongside counts
    ✓ includeFiles omitted leaves the result counts-only
    ✓ includeFiles preserves the same file in multiple buckets
  exports
    ✓ DEFAULT_PATTERNS has the four expected buckets
    ✓ DEFAULT_IGNORE matches docs/, .wordpress-org/, and .github/ non-workflow paths
  runCli
    ✓ --help prints usage and exits 0
    ✓ unknown flag exits 2 with stderr message
    ✓ invalid --output exits 2
    ✓ --files <path> with --output json prints valid JSON (1 ms)
    ✓ --output github appends key=value lines to $GITHUB_OUTPUT
    ✓ --output github warns to stderr when GITHUB_OUTPUT is unset
    ✓ --dry-run parses cleanly and exits 0
    ✓ --dry-run + --output github does not touch $GITHUB_OUTPUT and previews to stdout (1 ms)
    ✓ --dry-run + --output github previews even when $GITHUB_OUTPUT is unset
    ✓ text mode prints key: value lines (1 ms)
    ✓ --ignore overrides default
    ✓ missing --files path exits 1 with stderr message
    ✓ --files followed by another flag exits 2 (does not swallow the flag)
    ✓ --files at end of argv exits 2
    ✓ --ignore followed by another flag exits 2
    ✓ --files - is accepted as the stdin sentinel (parser does not reject lone dash) (1 ms)
    ✓ --include-files in json mode emits <bucket>-files arrays
    ✓ --include-files in text mode prints space-joined paths
    ✓ --include-files in github mode writes heredoc multi-line outputs (1 ms)
    ✓ --include-files dry-run previews heredoc blocks without writing
    ✓ invalid --ignore regex exits 2 with a clean usage error (1 ms)

 PASS  tests/cli/index.test.js
  cli main()
    ✓ no args prints top-level usage and exits 0
    ✓ --help prints top-level usage
    ✓ -h prints top-level usage (1 ms)
    ✓ --version prints package version and exits 0
    ✓ -v prints package version
    ✓ unknown top-level flag exits 2 with stderr message
    ✓ unknown subcommand exits 2 with stderr message
    ✓ routes detect-changes --help to its runCli
    ✓ routes detect-changes through to its runCli with args (1 ms)
    ✓ detect-changes propagates a usage-error exit code
  cli COMMANDS registry
    ✓ detect-changes is registered with a summary and run handler
    ✓ install-hooks is registered with a summary and run handler
  cli main() routes install-hooks
    ✓ routes install-hooks --help to its runCli

Test Suites: 4 passed, 4 total
Tests:       102 passed, 102 total
Snapshots:   0 total
Time:        0.521 s, estimated 1 s
Ran all test suites.
```

Manual smoke test:

```bash
❯ cd $(mktemp -d) && git init && touch package.json
hint: Using 'master' as the name for the initial branch. This default branch name
hint: will change to "main" in Git 3.0. To configure the initial branch name
hint: to use in all of your new repositories, which will suppress this warning,
hint: call:
hint:
hint:   git config --global init.defaultBranch <name>
hint:
hint: Names commonly chosen instead of 'master' are 'main', 'trunk' and
hint: 'development'. The just-created branch can be renamed via this command:
hint:
hint:   git branch -m <name>
hint:
hint: Disable this message with "git config set advice.defaultBranchName false"
Initialized empty Git repository in /private/var/folders/wy/5g6ztjds0z368jw3q77n9vz80000gn/T/tmp.C8JHd03A6N/.git/
❯ node /Users/adi/rtproj/wp-tooling/bin/wp-tooling.js install-hooks
installed  commit-msg  -> /private/var/folders/wy/5g6ztjds0z368jw3q77n9vz80000gn/T/tmp.C8JHd03A6N/.git/hooks/commit-msg
installed  pre-commit  -> /private/var/folders/wy/5g6ztjds0z368jw3q77n9vz80000gn/T/tmp.C8JHd03A6N/.git/hooks/pre-commit
❯ ls -la .git/hooks/commit-msg .git/hooks/pre-commit
-rwxr-xr-x@ 1 adi  staff  798 May 15 16:39 .git/hooks/commit-msg
-rwxr-xr-x@ 1 adi  staff  306 May 15 16:39 .git/hooks/pre-commit
❯ git add package.json
❯ git commit --allow-empty -m "feat: hello"
[master (root-commit) b57e0e4] feat: hello
 1 file changed, 0 insertions(+), 0 deletions(-)
 create mode 100644 package.json
❯ git commit --allow-empty -m "wip"
✗ Commit message must follow Conventional Commits.
  Got:      wip
  Examples: feat(utilities): add Logger
            fix(release): handle empty CHANGELOG
            docs: update README
```

---

## Open questions

- _(none yet)_

---

## Notes for the reviewer

- Templates are POSIX `sh` only (no bash-isms). The `pre-commit` template short-circuits when `package.json` has no `lint:staged` script — intentional for pure-PHP repos.
- The version header is injected after the shebang so future installs can detect drift without re-reading the package version on every commit.
- The Husky-aware skip message is a UX hint only — behaviour (skip without `--force`, overwrite with `--force`) is identical to the generic case.

---

## Handoff log

_(no rotations yet — delete this line when the first entry is added)_

<!--
### → Handoff OUT · YYYY-MM-DD · @handle
- **Reason for rotation:** …
- **Expected return:** …
- **Branch state:** <branch> pushed to remote, HEAD at commit `<sha>`
- **What's done:** …
- **What's in progress:** …
- **What's next:** …
- **Blockers / open questions:** …
- **Gotchas for the incoming engineer:** …
- **Contact:** …

### ← Handoff IN · YYYY-MM-DD · @handle
- **Confirmed reproducibility:** …
- **Starting point:** …
- **Deviations from plan above:** …
-->
