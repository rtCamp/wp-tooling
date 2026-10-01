<h1 align="center">@rtcamp/wp-tooling</h1>

<p align="center">
  <a href="https://github.com/rtCamp/wp-tooling/blob/main/node-packages/wp-tooling/LICENSE"><img src="https://img.shields.io/badge/license-GPL--2.0--or--later-blue.svg" alt="License: GPL-2.0-or-later"></a>
  <a href="https://www.npmjs.com/package/@rtcamp/wp-tooling"><img src="https://img.shields.io/npm/v/@rtcamp/wp-tooling.svg" alt="npm version"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22.19-339933.svg" alt="Node 22.19+">
  <img src="https://img.shields.io/badge/runtime%20dependencies-0-brightgreen.svg" alt="Zero runtime dependencies">
</p>

<p align="center">
  The CLI and library behind rtCamp's WordPress starters: scaffolding, project setup, releases,
  git hooks, CI helpers and accessibility and performance checks.
</p>

---

`@rtcamp/wp-tooling` is what [plugin-elementary](https://github.com/rtCamp/plugin-elementary) and
[theme-elementary](https://github.com/rtCamp/theme-elementary) run for `npm run init`, `release:*`
and their git hooks. It works in any WordPress plugin or theme, and it has no runtime
dependencies.

Requirements:

- Node.js 22.19+
- A WordPress plugin or theme project. PHP scaffolds target [`rtcamp/wp-primitives`](https://github.com/rtCamp/wp-primitives) `^2.0`.

## Install

```bash
npm install --save-dev @rtcamp/wp-tooling
```

## Quick start

```bash
npx wp-tooling list                                  # every scaffold in the catalogue
npx wp-tooling add wp/cpt --slug=book --singular=Book --plural=Books
npx wp-tooling features --enable tailwind            # toggle a feature the project declares (both starters do)
npx wp-tooling <command> --help                      # options for any command
```

## Commands

| Command | What it does |
| --- | --- |
| `add` | Add a scaffold to the current project, e.g. `wp-tooling add wp/cli --name=qm-export` |
| `list` | List every scaffold in the merged catalogue |
| `validate` | Validate scaffold manifests |
| `features` | Turn optional project features on or off, e.g. `--enable tailwind` |
| `cache` | Manage the on-disk cache of remote scaffold templates |
| `install-hooks` | Install the `commit-msg` and `pre-commit` git hooks |
| `release:bump` | Bump the version in `package.json`, `composer.json` and the plugin or theme header |
| `release:changelog` | Finalise the `## Unreleased` section of `CHANGELOG.md` |
| `release:zip` | Build a `.distignore`-aware `dist/<slug>-<version>.zip` |
| `detect-changes` | Bucket the files a change touches, so CI runs only the jobs it needs |
| `coverage-gate` | Fail when too few of a pull request's changed lines are covered (Clover or LCOV) |
| `a11y` | Run pa11y-ci and report normalised accessibility violations |
| `perf` | Collect Core Web Vitals and Lighthouse scores, plus optional server profiling |
| `version-monitor` | Detect and apply WordPress, PHP and Node updates that Dependabot misses |

## Scaffolds

46 scaffolds; the code scaffolds also generate their tests:

| Group | Scaffolds |
| --- | --- |
| `wp/*` | admin page, dynamic and interactive blocks, WP-CLI command, custom post type, cron, module, registrable, REST controller, settings page, shortcode, taxonomy, user role |
| `wp-api/*` | block bindings, script modules, speculative loading |
| `utility/*` | wiring for the wp-primitives cache, feature selector, logger, timer and transients |
| `setup/*` | Claude skills, EditorConfig, Jest, pa11y, performance, PHPUnit, PSR-4, Tailwind |
| `lint/*` | ESLint, Stylelint, PHPCS (core, full and VIP), PHPStan, i18n |
| `ci/*` | GitHub Actions for lint, tests, build, build artifacts, accessibility and WordPress.org deploys |

Run `npx wp-tooling list` for the exact ids and `npx wp-tooling add <id> --help` for each one's inputs.

## Library

The same functionality is available from code:

| Entry point | Use |
| --- | --- |
| `@rtcamp/wp-tooling/init` | The setup engine behind `npm run init` in both starters |
| `@rtcamp/wp-tooling/scaffolds` | Scaffold registry, rendering and validation |
| `@rtcamp/wp-tooling/features` | Feature toggles |
| `@rtcamp/wp-tooling/release` | Version bump, changelog and zip |
| `@rtcamp/wp-tooling/hooks` | Git hook installer |
| `@rtcamp/wp-tooling/ci` | `detectChanges`, `computeGate` and their parsers and errors |
| `@rtcamp/wp-tooling/a11y` | `runA11y` |
| `@rtcamp/wp-tooling/perf` | Performance runner |
| `@rtcamp/wp-tooling/version-monitor` | Detectors, updaters and reporters |
| `@rtcamp/wp-tooling/ui` | Zero-dependency terminal UI: wizard, prompts, selects, spinner |

## Documentation

- [Authoring scaffolds](https://github.com/rtCamp/wp-tooling/blob/main/node-packages/wp-tooling/docs/authoring-scaffolds.md)
- [Examples](https://github.com/rtCamp/wp-tooling/blob/main/node-packages/wp-tooling/docs/examples.md)
- [AI orchestration](https://github.com/rtCamp/wp-tooling/blob/main/node-packages/wp-tooling/docs/ai-orchestration.md)
- [The wp-primitives contract](https://github.com/rtCamp/wp-tooling/blob/main/node-packages/wp-tooling/docs/wp-primitives-contract.md)
- [Editor setup](https://github.com/rtCamp/wp-tooling/blob/main/node-packages/wp-tooling/docs/editor-setup.md)
- [CHANGELOG](https://github.com/rtCamp/wp-tooling/blob/main/node-packages/wp-tooling/CHANGELOG.md)

## Related packages

[`@rtcamp/eslint-config`](https://www.npmjs.com/package/@rtcamp/eslint-config),
[`@rtcamp/stylelint-config`](https://www.npmjs.com/package/@rtcamp/stylelint-config) and
[`@rtcamp/tailwind-config`](https://www.npmjs.com/package/@rtcamp/tailwind-config) are separate
packages from the same repository. The scaffolds install them when you add the matching lint or
setup scaffold.

## Contributing

This package lives in the [rtCamp/wp-tooling](https://github.com/rtCamp/wp-tooling) monorepo. See
[AGENTS.md](https://github.com/rtCamp/wp-tooling/blob/main/AGENTS.md) for architecture and coding
rules and [CONTRIBUTING.md](https://github.com/rtCamp/wp-tooling/blob/main/CONTRIBUTING.md) for
setup, tests and the pull request checklist.

## License

GPL-2.0-or-later. See [LICENSE](https://github.com/rtCamp/wp-tooling/blob/main/node-packages/wp-tooling/LICENSE).

<p align="center">
  <a href="https://rtcamp.com"><img src="https://n8e0ka87m9.gdcdn.us/kfnbt046p8/GitHub_Banner.webp" alt="rtCamp" width="100%"></a>
</p>
