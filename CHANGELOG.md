# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Added

- TTY UI kit (`src/ui/`) with nine public exports: `Wizard`, `text`, `confirm`, `password`, `checkbox`, `radio`, `checkboxTree`, `spinner`, and `CancelledError`.
- `Wizard` class -- runs steps in order, sharing a mutable context object; supports `skip(ctx)` predicate. Validates that `steps` is an array. Omits ANSI formatting in non-TTY mode.
- `spinner` -- async progress feedback with ASCII animation in TTY and plain text fallback. Guards against multiple intervals when `start()` called twice.
- `text`, `confirm`, `password` prompts with validation support and non-TTY fallback. Each accepts either a string message shortcut (`text('Name?')`) or a full options object.
- `checkbox` (multi-select) and `radio` (single-select) flat list selects with input validation (`TypeError` on missing or invalid `choices`).
- `checkboxTree` -- grouped tree multi-select with group-level toggling. Returns selections in display order. Input validation for `groups`. Returns empty array for empty groups without prompting.
- `CancelledError` -- thrown on Ctrl+C in any TTY-interactive prompt or select (including `text` and `confirm`, which surface cancellation through the underlying `readLine` SIGINT handler). Callers decide exit behaviour.
- Low-level terminal helpers (`src/ui/core/terminal.js`) -- ANSI codes, cursor control, keypress events.
- Jest test suite for all UI primitives (75 tests, including dedicated coverage for `src/ui/core/terminal.js`).
- **Scaffold engine** (`src/scaffolds/`) with `ScaffoldRegistry`, hand-rolled JSON-schema validator, minimal Mustache-style renderer, and `execute()` programmatic API returning the four-block result shape (`scaffold` / `engine` / `developer` / `ai`). Engine core has zero runtime dependencies and zero TTY UI coupling, so it works from AI orchestrators, CI scripts, and headless harnesses. Implements WTL-02, WTL-06, WTL-07.
- **Manifest extensions** in `scaffold.json` (WTL-07): optional `inputs[]` (project-portable variables with `discover_from` hints and transforms), `wiring[]` (cross-file registration snippets the caller applies with consent), `tests[]` (PHPUnit/Jest/actionlint/yaml-parse stubs), `secrets[]` (declarations only, never values).
- **`bin/wp-tooling` dispatcher** with auto-registration of subcommands from `bin/commands/*.js`. Drop a new command file in; no edit to the dispatcher required.
- **`add` subcommand** (`bin/commands/add.js`) wrapping `registry.execute()` with two modes: interactive (4-step TTY UI `Wizard`: discover, resolveInputs, confirm, execute) and non-interactive (`--non-interactive` / `--json` for AI and CI). Supports `--dry-run`, `--cwd`, and per-input flags. Implements WTL-06.
- **Default scaffold catalogue** under `scaffolds/` bundled with the package (WTL-09): four representative scaffolds covering all three source repos and four scaffold kinds: `wp/cli` (PHP code + PHPUnit test stub), `utility/cache` (`source: package` wrapper around `rtcamp/wp-php-toolkit`), `block/dynamic` (Gutenberg block with edit.js + render.php + block.json + index.js), `ci/cd-wporg` (workflow stub that `uses:` `rtCamp/wp-shared-workflows`, with declared `secrets[]` and `actionlint` validation).
- **Two-directory `ScaffoldRegistry.scan()`** that merges wp-tooling's bundled `scaffolds/` (defaults) with the project's `bin/scaffolds/` (project overrides). Each entry is tagged with `origin: 'default' | 'project'`. Implements WTL-09.
- **AI orchestration contract documentation** at `docs/ai-orchestration.md` (WTL-08). Twelve sections covering engine guarantees, skill responsibilities, error codes, project introspection (PSR-4 + class-suffix + namespace-substructure + block-slug + workflow-filename sampling), adaptive wiring (canonical vs translated snippets, fall-through location resolution, anchor restoration), the wiring permission protocol, the TDD-with-AI loop, and workflow-scaffold orchestration with the secrets checklist.
- **`list` subcommand** (`bin/commands/list.js`): lists every scaffold in the merged catalogue grouped by category, with `--json` for AI consumption, `--category=` and `--origin=default|project` filters, and `--cwd` for project-local scoping. JSON entries carry id / kind / origin / description plus counts (inputs, wiring, tests, secrets) so an AI can pick the right scaffold without reading each manifest.
- **Copy-pasteable AI skill** at `skills/scaffold.md` plus a `skills/README.md` with install instructions. The skill is a single Markdown file with Claude Code front-matter (`name`, `description`) that any project can drop into `.claude/skills/scaffold.md` (or any equivalent path for other AI orchestrators). Built from the `docs/ai-orchestration.md` contract and includes the full discover → introspect → invoke → wire → test → report flow with explicit hard prohibitions on auto-installs, secret-value handling, and admin-surface edits.
- Jest test suite for the scaffold engine, CLI, and list command (160 tests total).
