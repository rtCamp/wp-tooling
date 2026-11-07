## Dev environment tips

```bash
npm install                                                          # install npm workspace deps for node-packages/*
composer install                                                     # install shared dev tooling (phpcs, phpstan, phpunit)
(cd composer-packages/phpcs && composer install)                     # phpcs package needs its own install too
(cd composer-packages/phpstan && composer install)                   # phpstan package needs its own install too
```

### Key Directories

- `node-packages/wp-tooling/` — `@rtcamp/wp-tooling`, the CLI consumed by every rtCamp plugin/theme skeleton; has its own `AGENTS.md`
- `node-packages/eslint-config/` — `@rtcamp/eslint-config`, shareable ESLint flat config extending `@wordpress/eslint-plugin`
- `node-packages/stylelint-config/` — `@rtcamp/stylelint-config`, shareable Stylelint config extending `@wordpress/stylelint-config`
- `node-packages/tailwind-config/` — `@rtcamp/tailwind-config`, Tailwind v4 PostCSS config + `theme.json` webpack plugin
- `composer-packages/phpcs/` — `rtcamp/wp-phpcs`, PHP_CodeSniffer standards (`rtCampWP`, `rtCampWP-Basic`)
- `composer-packages/phpstan/` — `rtcamp/wp-phpstan`, shared PHPStan baseline for WordPress projects
- `.github/workflows/` holds `ci.yml` (lint + tests on every PR and push to main), `pr-title.yml` (Conventional Commit PR titles), `release.yml` (release-please), the two subtree-split workflows and the npm publish workflow

## Progressive discovery

Read only what your task needs, when it needs it:

- **Contributor docs**: see `CONTRIBUTING.md` for setup, the PR checklist, and the exact test commands for both ecosystems.
- **Directory guides**: some directories carry their own `AGENTS.md` and `README.md` with rules for working there (e.g. `node-packages/wp-tooling/AGENTS.md`) — read it before changing files in that directory.

## Code quality

```bash
npm run lint                                                         # ESLint across every npm workspace with a lint script
npm run lint:fix                                                     # same, with --fix
npm test                                                             # Jest across every npm workspace with a test script
(cd composer-packages/phpcs && composer test)                        # phpcs package's own PHPUnit suite
(cd composer-packages/phpstan && composer test)                      # phpstan package's own PHPUnit suite
```

## Architectural decisions

- **Package layering**: `node-packages/*` (npm workspaces, `@rtcamp` scope) and `composer-packages/*` (Composer, `rtcamp` vendor) are independent ecosystems sharing one repo for coordinated development only — nothing internal is shared or imported across that boundary.
- **release-please makes every release**: pull requests are squash-merged, so each PR title becomes a commit on `main`. On each push to `main`, `release.yml` runs release-please, which keeps a release pull request open for every package with changes to release. The packages are listed in `release-please-config.json` and their current versions in `.release-please-manifest.json`. Merging a release pull request bumps that package's version, writes its `CHANGELOG.md`, tags it `<name>@<version>` (for example `@rtcamp/eslint-config@2.1.0` or `rtcamp/wp-phpstan@2.1.0`) and publishes a GitHub release. release-please opens these pull requests with `GITHUB_TOKEN`, so GitHub holds their `ci.yml` and PR title runs until a maintainer selects "Approve workflows to run" in the merge box; approve them before merging.
- **Composer packages release one at a time by subtree split**: a `rtcamp/<package>@<version>` tag (for example `rtcamp/wp-phpstan@2.0.0`) runs `release-php.yml`, which splits only that package's `composer-packages/*` directory with `git subtree split --prefix=<dir>` to its read-only mirror repo (`rtCamp/wp-phpcs` or `rtCamp/wp-phpstan`) and tags it `v<version>` there for Packagist. `release.yml` calls it for each tag release-please creates; a tag pushed by hand still runs it. Each package keeps its own version.
- **npm packages publish to the npm registry**: each `node-packages/*` workspace is published to npmjs.com as `@rtcamp/<dirname>` (public access, set in its `publishConfig`), with its own version. `publish-npm-packages.yml` publishes each workspace whose `package.json` `version` is not on npm yet, when it changes on `main` (as a merged release pull request does). It authenticates with npm trusted publishing (no stored token), and a maintainer approves each release in the protected `npm` environment. Every push to `main` also splits each workspace to an `npm/<dirname>` branch of this repo, which keeps serving git-URL installs for projects that have not moved to registry versions.
- **Dependency discipline differs by package type**: `wp-tooling` ships zero runtime dependencies (full banned-package list in its own `AGENTS.md`); the three config packages instead rely on `peerDependencies` — consumers bring their own `eslint`/`stylelint`/`tailwindcss`.
- **Prefer official WordPress tooling**: build custom only when no official `@wordpress/*` (or upstream PHPCS/PHPStan) option covers the need, or the official option blocks a hard constraint. `eslint-config` extends `@wordpress/eslint-plugin`, `stylelint-config` extends `@wordpress/stylelint-config`, `wp-phpcs` layers on WPCS/VIPCS/PHPCompatibilityWP/Slevomat, `wp-phpstan` wraps `szepeviktor/phpstan-wordpress`.
- **PHP version skew is intentional**: the packages target PHP `>=8.2` (the rtCamp plugin/theme floor) while the monorepo root requires `>=8.4.1` for `symplify/monorepo-builder`. `monorepo-builder validate` will flag this — expected, not a bug.

For full release-mechanism details, see `release-please-config.json`, `.github/workflows/release.yml`, `.github/workflows/release-php.yml`, `.github/workflows/split-npm-packages.yml` and `.github/workflows/publish-npm-packages.yml`.

## Common pitfalls

- Composer packages have no `version` field in `composer.json`. release-please tracks their version in `.release-please-manifest.json` and only writes their `CHANGELOG.md`; the version reaches Packagist as the mirror's `v<version>` tag.
- There is no root `composer test` / `composer check` — root `composer.json` has no `scripts` key. Run tests from inside each `composer-packages/*` directory.
- `wp-tooling release:bump` / `release:changelog` are for **consumer** WordPress plugins/themes, not this monorepo. They require a `.php` file with a `Plugin Name:` header at cwd root and throw otherwise.
- Subtree-split artifacts — the `npm/<dirname>` branches and the `wp-phpcs`/`wp-phpstan` mirror repos — are generated. Never hand-edit them; a diverged target fails the next split run instead of being silently rewritten.
- npm packages do version in `package.json`: release-please's release pull request bumps `version`, the package's entry in the root `package-lock.json` and its `CHANGELOG.md`. Merging it publishes the version once a maintainer approves the `npm` environment.
- Composer release tags are `rtcamp/<package>@<version>`, one per package; a bare `v*` tag releases nothing (the `v1.0.0` and `v1.0.1` tags date from when both packages shared a version). npm release tags keep the leading `@` (for example `@rtcamp/eslint-config@1.1.0`), so `release-php.yml` never matches them.
- Never edit a `CHANGELOG.md` by hand: the PR title is the changelog entry. release-please lists `feat` under Added, `fix` under Fixed, and `perf`, `revert` and `build` under Changed; `docs`, `chore`, `ci`, `test`, `refactor` and `style` release nothing. A `!` after the type (`feat(eslint-config)!:`) makes a major release. To reword an entry after its pull request merged, add the new title to that pull request's description between a `BEGIN_COMMIT_OVERRIDE` line and an `END_COMMIT_OVERRIDE` line; release-please uses it on its next run (run the Release workflow by hand to apply it now). Edits made by hand in a release pull request are lost the next time release-please updates it.
- A commit counts for every package whose files it touches, whatever its scope says, so a `feat!` that also edits other workspaces makes a major release of each of them. Keep cross-package dependency bumps in their own `chore(deps-dev)` pull request.
- An `@rtcamp/eslint-config` release also rewrites the other workspaces' `@rtcamp/eslint-config` devDependency range to `^<new version>`, in their `package.json` and in the root `package-lock.json`, through `extra-files` in `release-please-config.json`. The release commit counts as a `chore` for those workspaces, so they get no release of their own. A new workspace that devDepends on it needs its two entries added there, or the next major leaves `npm ci` out of sync.
- A new package needs an entry in `release-please-config.json` (with its root `package-lock.json` `extra-files` entry if it is an npm package) and its current version in `.release-please-manifest.json`.
- The first version of a new npm package is published by hand, because npm only accepts a trusted publisher for a package that already exists. Until then, the workflow skips the package with a warning and `npm install @rtcamp/<name>` does not resolve, so install from the git URL (`#npm/<dirname>`). The steps are in the header of `publish-npm-packages.yml`.
- Write `bin` paths without a leading `./` (`"bin/wp-tooling.js"`), the form `npm pkg fix` writes. `npm publish` auto-corrects `./bin/...` with a warning, and the workflow's preview step fails on any auto-correction.
- Every one of the six packages carries its own `LICENSE` file — `git subtree split` only carries history of files *inside* the split directory, so the root `LICENSE` never reaches a mirror repo or split branch.
- `ci.yml` runs every workspace lint, every Jest suite with its coverage threshold (Node 22.19 and 24), and each `composer-packages/*` suite installed standalone (PHP 8.2, 8.3 and 8.4) on every PR and push to main. A red CI blocks the merge that would otherwise ship straight onto the `npm/*` branches.
- `.vscode/extensions.json` only recommends extensions from verified publishers (Microsoft, GitHub, Red Hat, EditorConfig Foundation) — don't add others, regardless of popularity.

## PR instructions

- Ensure `npm run check` (and the `composer test` commands for whichever `composer-packages/*` you touched) pass.
- Fix all linting/formatting issues — see `CONTRIBUTING.md` for the full PR checklist.
