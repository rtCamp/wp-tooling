# CLAUDE.md — `wp-tooling`

Read this file at the start of every session. Topic-specific details live in [.claude/issues/](.claude/issues/) (per-task state) and [.claude/commands/](.claude/commands/) (skills). Read those only when the task requires.

---

## What this repo is

An npm package of shared tooling for rtCamp WordPress projects. Provides the TTY UI toolkit, scaffold registry, release scripts, git hooks, lint configs, CI scripts, and version monitor. Consumed by every rtCamp skeleton — plugin and theme alike. This repo is tooling only; no production runtime code belongs here.

---

## Non-negotiables

- No runtime dependencies in `dependencies` — dev deps are fine.
- Banned from `dependencies`: `chalk`, `inquirer`, `@inquirer/prompts`, `clack`, `@clack/prompts`, `ora`, `listr2`.
- ESLint pinned at `8.57.1` — matches `@wordpress/scripts` range.
- `Mustache.escape = (text) => text` — never HTML-encode generated code.
- Every UI primitive works in non-TTY environments (CI) — no crash when `process.stdout.isTTY` is false.
- Every CLI command supports `--dry-run`.

---

## Principle — prefer official WordPress tooling

When WordPress or `@wordpress/*` ships something that covers our need, we use it. Build custom only when there's a real gap — no official option, or the official option blocks a hard constraint (zero-runtime-deps, non-TTY fallback, etc.).

Our lint configs **extend** `@wordpress/eslint-plugin` and `@wordpress/stylelint-config` rather than define rules from scratch. Our build wrapper targets `@wordpress/scripts` defaults. When upstream bumps ESLint or Stylelint, we move with it.

Before adding any new tool, package, or convention: check if an official WordPress option already exists. If it does, use that and layer rtCamp-specific overrides on top.

---

## Language & versions

| | |
|---|---|
| Node | 22 LTS (`^22.x`) |
| npm | 10.x |
| ESLint | `8.57.1` pinned (not `^`) |
| Jest | `^29` |
| Mustache | `^4` |

Whole package is CommonJS for broad Node compatibility. No ESM mix.

---

## Directory layout

```
src/
  ui/               TTY UI toolkit (index.js, core/terminal.js, prompts/, selects/, spinner/, wizard/)
  scaffolds/        ScaffoldRegistry — recursive scaffold.json scanner
  release/          Version bump, changelog, package zip
  hooks/            Shell script hooks (commit-msg, pre-commit) — consumers wire via husky or plain git
  lint/             eslint.js + stylelint.js — extend @wordpress/eslint-plugin + @wordpress/stylelint-config
  ci/               CI helper commands (e.g. detect-changes)
  version-monitor/  Version monitor detectors + updaters + reporters
tests/              Jest suite, mirrors src/
bin/                CLI entry point — `wp-tooling <command>`
package.json
CHANGELOG.md
```

PascalCase for class names, camelCase for functions, kebab-case for filenames.

---

## Architecture patterns

| Pattern | Shape |
|---|---|
| **Wizard step** | Class with `name`, `description`, `skip(ctx)`, `run(ctx)`. Extends `AbstractStep` (if defined) or exports an object matching that shape |
| **Scaffold** | JSON spec + Mustache templates. Discovered by `ScaffoldRegistry.scan()` — no hardcoded registration |
| **UI primitive** | Function returning a Promise. Zero deps. Works without TTY (reads from `stdin`, falls back gracefully) |
| **CI script** | Subcommand under `bin/wp-tooling <command>`. Exports a function that takes `{ args, env }` |

Rule of thumb: prefer small, pure functions with explicit inputs over classes with internal state.

---

## Coding standards

- ESLint `@wordpress/eslint-plugin` — zero errors before PR.
- Every public function has a JSDoc block with `@param` and `@returns`.
- No `eval`, no `Function(string)`, no dynamic `require` paths.
- All async work uses `async/await` — no raw `.then()` chains.
- Error messages include what was expected and what was received.

---

## Testing

- Every UI primitive, wizard, and scaffold gets at least one Jest test.
- Tests live in `tests/<area>/<name>.test.js`, mirroring `src/`.
- Test against mock TTY (never a real terminal).
- Run full suite: `npm test`.
- Watch mode during development: `npm test -- --watch`.

---

## Git workflow

- Every milestone has a long-lived release branch (`release/v1.0.0`). Never merge directly into `main`.
- Task branches: `v1.0.0/task/<kebab-slug>`, based on `release/v1.0.0`.
- Commit style: [Conventional Commits](https://www.conventionalcommits.org/) — `feat(ui): add spinner primitive`.
- PR title: `[v1.0.0] <commit subject>`. PR target: `release/v1.0.0`.
- Squash merge. Never `--no-verify`.

---

## Working on an issue

When the user references a GitHub issue (`#13`, "the TTY UI task"):

1. Check `.claude/issues/<N>-<slug>.md`.
2. **File exists** → the issue is in progress or complete. Read it for current state. Continue from there.
3. **File missing** → the issue has not been started. Copy `.claude/issues/_TEMPLATE.md` to `.claude/issues/<N>-<slug>.md`, fill `Summary` from the GitHub issue, set `status: in-progress`. Commit it as part of the first commit on the task branch.

Update this file as work progresses — decisions, files changed, verification output, open questions.

### Rotation protocol (seniors at 4h/day may rotate mid-issue)

- **Leaving an issue:** run `/handoff out` — Claude generates the log entry + a GitHub issue comment. Push WIP, apply `Status: Blocked`, post the comment.
- **Picking up an issue:** pull the branch, run `npm run check` to confirm reproducibility, then `/handoff in`. Remove `Status: Blocked`, post the comment.
- Outgoing entry must be detailed enough that the incoming engineer needs **zero questions**.

---

## Available skills

- `/add-wizard-step <name>` — scaffold a new wizard step with `skip` and `run` stubs + test
- `/add-scaffold <category>/<slug>` — scaffold a new scaffold.json + Mustache templates + validation
- `/add-ui-primitive <name>` — scaffold a TTY UI component with zero-dep check and non-TTY fallback
- `/add-ci-script <name>` — scaffold a CLI helper dispatched via `npx wp-tooling`
- `/add-version-detector <name>` — scaffold a version monitor detector + updater + reporter
- `/review-tooling-pr` — audit a PR for banned deps, exports-map integrity, ESLint pinning
- `/handoff [out|in]` — generate a rotation handoff log entry + GitHub comment

---

## PR authoring

Use `.github/pull_request_template.md`. PR body mirrors the issue structure. Draft from the issue file:

- PR "What this does" ← issue file `Summary`
- PR "Changes" ← issue file `Files changed so far`
- PR "How I verified" ← issue file `Verification run`
- PR "Reviewer notes" ← issue file `Notes for the reviewer`

Always include `Closes #<N>` in the PR body.

---

## User preferences

- No auto-commits — the developer runs all `git` commands themselves.
- Brief, direct replies in chat.
- Don't create unsolicited documentation files.
- British English in prose; camelCase identifiers in code.
- Don't add emojis to files unless asked.
