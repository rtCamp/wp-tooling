# wp-tooling

rtCamp's shared WordPress tooling monorepo. Two independently-installable package
families live here — pick what you need.

## Node packages (`node-packages/`)

| Package | What it is |
| --- | --- |
| [`@rtcamp/wp-tooling`](node-packages/wp-tooling) | TTY UI toolkit, scaffold registry, release scripts, git hooks, CI helpers, version monitor — the CLI consumed by every rtCamp plugin/theme skeleton |
| [`@rtcamp/eslint-config`](node-packages/eslint-config) | Shareable ESLint flat config, extends `@wordpress/eslint-plugin` |
| [`@rtcamp/stylelint-config`](node-packages/stylelint-config) | Shareable Stylelint config, extends `@wordpress/stylelint-config` |
| [`@rtcamp/tailwind-config`](node-packages/tailwind-config) | Tailwind CSS v4 PostCSS config + `theme.json` webpack plugin |

Install instructions are in each package's own README.

## Composer packages (`composer-packages/`)

| Package | What it is |
| --- | --- |
| [`rtcamp/wp-phpcs`](composer-packages/phpcs) | `rtCampWP` / `rtCampWP-Basic` PHP_CodeSniffer standards (WPCS + VIPCS + PHPCompatibilityWP + Slevomat) |
| [`rtcamp/wp-phpstan`](composer-packages/phpstan) | Shared PHPStan baseline for WordPress projects |

Install instructions are in each package's own README.

## Contributing

See [AGENTS.md](AGENTS.md) for the repo layout, coding standards, and test commands,
and [CONTRIBUTING.md](CONTRIBUTING.md) for the PR process.

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).

<p align="center">
  <a href="https://rtcamp.com"><img src="https://n8e0ka87m9.gdcdn.us/kfnbt046p8/GitHub_Banner.webp" alt="rtCamp" width="100%"></a>
</p>
