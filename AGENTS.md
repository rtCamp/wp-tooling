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
- `.github/workflows/` holds `ci.yml` (lint + tests on every PR and push to main) and the two subtree-split release workflows

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
- **Composer packages release by subtree split**: a `v*` tag push runs `release-php.yml`, which splits each `composer-packages/*` directory with `git subtree split --prefix=<dir>` to its read-only mirror repo (`rtCamp/wp-phpcs`, `rtCamp/wp-phpstan`) and tags it there for Packagist.
- **npm packages publish to the npm registry**: each `node-packages/*` workspace is published to npmjs.com as `@rtcamp/<dirname>` (public access, set in its `publishConfig`), with its own version. Every push to `main` also splits each workspace to an `npm/<dirname>` branch of this repo, which keeps serving git-URL installs for projects that have not moved to registry versions.
- **Dependency discipline differs by package type**: `wp-tooling` ships zero runtime dependencies (full banned-package list in its own `AGENTS.md`); the three config packages instead rely on `peerDependencies` — consumers bring their own `eslint`/`stylelint`/`tailwindcss`.
- **Prefer official WordPress tooling**: build custom only when no official `@wordpress/*` (or upstream PHPCS/PHPStan) option covers the need, or the official option blocks a hard constraint. `eslint-config` extends `@wordpress/eslint-plugin`, `stylelint-config` extends `@wordpress/stylelint-config`, `wp-phpcs` layers on WPCS/VIPCS/PHPCompatibilityWP/Slevomat, `wp-phpstan` wraps `szepeviktor/phpstan-wordpress`.
- **PHP version skew is intentional**: the packages target PHP `>=8.2` (the rtCamp plugin/theme floor) while the monorepo root requires `>=8.4.1` for `symplify/monorepo-builder`. `monorepo-builder validate` will flag this — expected, not a bug.

For full release-mechanism details, see `.github/workflows/release-php.yml` and `.github/workflows/split-npm-packages.yml`.

## Common pitfalls

- Composer packages have no `version` field in `composer.json` — they version via git tag at the subtree-split step, not a manifest bump. Only their `CHANGELOG.md` gets a heading cut.
- There is no root `composer test` / `composer check` — root `composer.json` has no `scripts` key. Run tests from inside each `composer-packages/*` directory.
- `wp-tooling release:bump` / `release:changelog` are for **consumer** WordPress plugins/themes, not this monorepo. They require a `.php` file with a `Plugin Name:` header at cwd root and throw otherwise.
- Subtree-split artifacts — the `npm/<dirname>` branches and the `wp-phpcs`/`wp-phpstan` mirror repos — are generated. Never hand-edit them; a diverged target fails the next split run instead of being silently rewritten.
- Never use a `v*` tag for an npm release: `release-php.yml` fires on every `v*` tag and tags share one namespace, so it would cut a Composer release too. Tag npm releases `<name>@<version>` (for example `@rtcamp/eslint-config@1.1.0`).
- Every one of the six packages carries its own `LICENSE` file — `git subtree split` only carries history of files *inside* the split directory, so the root `LICENSE` never reaches a mirror repo or split branch.
- `ci.yml` runs every workspace lint, every Jest suite with its coverage threshold (Node 22.19 and 24), and each `composer-packages/*` suite installed standalone (PHP 8.2, 8.3 and 8.4) on every PR and push to main. A red CI blocks the merge that would otherwise ship straight onto the `npm/*` branches.
- `.vscode/extensions.json` only recommends extensions from verified publishers (Microsoft, GitHub, Red Hat, EditorConfig Foundation) — don't add others, regardless of popularity.

## PR instructions

- Ensure `npm run check` (and the `composer test` commands for whichever `composer-packages/*` you touched) pass.
- Fix all linting/formatting issues — see `CONTRIBUTING.md` for the full PR checklist.
