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
- `.github/workflows/` — the two subtree-split release workflows and the npm publish workflow; no lint/test CI runs on pull requests

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
- **Composer packages release via subtree split**: `git subtree split --prefix=<dir>` pushes each one to its standalone mirror repo (`rtCamp/wp-phpcs`, `rtCamp/wp-phpstan`) on a `v*` tag push.
- **npm packages publish to npmjs.org**: `publish-npm-packages.yml` publishes each workspace whose `package.json` `version` is not on npm yet, when it changes on `main`. It authenticates with npm trusted publishing (no stored token), and a maintainer approves each release in the protected `npm` environment.
- **The npm branch split is a stopgap**: `split-npm-packages.yml` still splits every workspace to an `npm/<dirname>` branch of this repo on each push to `main`, so consumers installing from `git+https://github.com/rtCamp/wp-tooling.git#npm/<dirname>` keep working while they move to the registry.
- **Dependency discipline differs by package type**: `wp-tooling` ships zero runtime dependencies (full banned-package list in its own `AGENTS.md`); the three config packages instead rely on `peerDependencies` — consumers bring their own `eslint`/`stylelint`/`tailwindcss`.
- **Prefer official WordPress tooling**: build custom only when no official `@wordpress/*` (or upstream PHPCS/PHPStan) option covers the need, or the official option blocks a hard constraint. `eslint-config` extends `@wordpress/eslint-plugin`, `stylelint-config` extends `@wordpress/stylelint-config`, `wp-phpcs` layers on WPCS/VIPCS/PHPCompatibilityWP/Slevomat, `wp-phpstan` wraps `szepeviktor/phpstan-wordpress`.
- **PHP version skew is intentional**: the packages target PHP `>=8.2` (the rtCamp plugin/theme floor) while the monorepo root requires `>=8.4.1` for `symplify/monorepo-builder`. `monorepo-builder validate` will flag this — expected, not a bug.

For full release-mechanism details, see `.github/workflows/release-php.yml`, `.github/workflows/split-npm-packages.yml` and `.github/workflows/publish-npm-packages.yml`.

## Common pitfalls

- Composer packages have no `version` field in `composer.json` — they version via git tag at the subtree-split step, not a manifest bump. Only their `CHANGELOG.md` gets a heading cut.
- There is no root `composer test` / `composer check` — root `composer.json` has no `scripts` key. Run tests from inside each `composer-packages/*` directory.
- `wp-tooling release:bump` / `release:changelog` are for **consumer** WordPress plugins/themes, not this monorepo. They require a `.php` file with a `Plugin Name:` header at cwd root and throw otherwise.
- Subtree-split artifacts — the `npm/<dirname>` branches and the `wp-phpcs`/`wp-phpstan` mirror repos — are generated. Never hand-edit them; a diverged target fails the next split run instead of being silently rewritten.
- npm packages do version in `package.json`: a release is a pull request that bumps `version` and cuts that package's `CHANGELOG.md` heading. Merging it publishes the version once a maintainer approves the `npm` environment.
- The first version of a new npm package is published by hand, because npm only accepts a trusted publisher for a package that already exists. Until then, the workflow skips the package with a warning and `npm install @rtcamp/<name>` does not resolve, so install from the git URL (`#npm/<dirname>`). The steps are in the header of `publish-npm-packages.yml`.
- Write `bin` paths without a leading `./` (`"bin/wp-tooling.js"`). `npm publish` treats `./bin/...` as invalid and drops the `bin` entry from the published metadata, so `npx` finds no command. The workflow's preview step fails on any such rewrite.
- Every one of the six packages carries its own `LICENSE` file — `git subtree split` only carries history of files *inside* the split directory, so the root `LICENSE` never reaches a mirror repo or split branch.
- No CI workflow lints or tests pull requests. `publish-npm-packages.yml` runs `npm run check` only right before it publishes, so run the Code quality commands locally before opening a PR.
- `.vscode/extensions.json` only recommends extensions from verified publishers (Microsoft, GitHub, Red Hat, EditorConfig Foundation) — don't add others, regardless of popularity.

## PR instructions

- Ensure `npm run check` (and the `composer test` commands for whichever `composer-packages/*` you touched) pass.
- Fix all linting/formatting issues — see `CONTRIBUTING.md` for the full PR checklist.
