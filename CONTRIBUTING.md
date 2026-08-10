# Contributing to wp-tooling

Thanks for your interest in improving wp-tooling. This is a
**monorepo** with two independently-consumed package families:

- `node-packages/*` — npm packages (`@rtcamp/wp-tooling`, `@rtcamp/eslint-config`,
  `@rtcamp/stylelint-config`, `@rtcamp/tailwind-config`), installed by rtCamp
  plugin/theme skeletons.
- `composer-packages/*` — Composer packages (`rtcamp/wp-phpcs`, `rtcamp/wp-phpstan`),
  installed as `require-dev` by rtCamp WordPress projects.

Both are shared tooling, not application code — a change here can ripple into every
consuming project, so treat published behaviour (CLI flags, config exports,
PHPCS/PHPStan rule sets) as a stable contract.

## Ground rules

- **Conventions live in [AGENTS.md](AGENTS.md).** Read it first — it covers the repo
  layout, language/version floors, coding standards, and the exact test commands for
  both ecosystems.
- **No runtime dependencies** in any `node-packages/*` package's `dependencies` —
  dev/peer deps only.
- **PHP packages target PHP >=8.2** (the rtCamp plugin/theme floor), even though the
  monorepo root itself requires a higher PHP floor for its own dev tooling (see
  AGENTS.md → "Language & versions").

## Development setup

```bash
npm install        # installs npm workspace deps for node-packages/*
composer install   # installs the shared dev tooling (phpcs, phpstan, phpunit) used against composer-packages/*
```

`composer-packages/phpcs` and `composer-packages/phpstan` each need their own install
before their `composer test` runs (see AGENTS.md → Testing):
`cd composer-packages/phpcs && composer install` and
`cd composer-packages/phpstan && composer install`.

## Before you open a PR

Run whichever of these apply to your change:

```bash
npm run check                                                        # lint + test every npm workspace
(cd composer-packages/phpcs && composer install && composer test)    # phpcs package tests
(cd composer-packages/phpstan && composer install && composer test)  # phpstan package tests
```

## Pull request checklist

- [ ] The commands above pass for whichever package(s) you touched
- [ ] Tests added for new behaviour
- [ ] Breaking changes to a public contract (CLI flags, config exports, PHPCS/PHPStan
      rules) are called out in the PR description
- [ ] `CHANGELOG.md` entry added under `## Unreleased` in the changed package(s)
- [ ] Conventional Commits

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).
