# Changelog

All notable changes to `@rtcamp/eslint-config` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- **Breaking:** unit-test files get Vitest rules by default (`@wordpress/eslint-plugin`'s `test-unit` config) instead of `eslint-plugin-jest`'s. `wp-scripts test-unit-js` runs Vitest since `@wordpress/scripts` 36, and the Jest rules stopped ESLint with "Unable to detect Jest version" in projects without Jest installed. Test files are now matched the way `@wordpress/scripts` matches them: `test/` and `__tests__/` directories plus `*.test.*` and `*.spec.*` in every JS and TS extension, not only `*.test.js`. Projects that still run Jest switch to `@rtcamp/eslint-config/jest`. Without the switch, `no-undef` reports every Jest global (`describe`, `it`, `expect`, `jest`) in their test files, because the Vitest rules declare no test globals.
- **Breaking:** the `@wordpress/eslint-plugin` peer range is `^27.0.0 || ^28.0.0`. 25 and 26 are dropped because their `test-unit` config is still Jest; 28 is the version `@wordpress/scripts` 37 depends on.
- **Breaking:** for projects still on `@wordpress/eslint-plugin` 25, `.js` and `.jsx` files are now parsed by ESLint's default parser instead of `@babel/eslint-parser`, which the plugin dropped in 26. A project's Babel config no longer affects linting. Modern JavaScript and JSX still parse, but syntax that parsed only because the project's Babel config enabled it, such as decorators or Flow types, now gets a parsing error.
- **Breaking:** the package declares its entry points in `exports`: `@rtcamp/eslint-config` and `@rtcamp/eslint-config/jest`. ES module configs (`eslint.config.mjs`) need the map to import `/jest`, since ESM doesn't add the `.js` extension to a package subpath. Deep imports of other files, such as `@rtcamp/eslint-config/index.js`, no longer resolve.
- `eslint-plugin-jest` is an optional peer dependency, needed only for the `/jest` entry.

### Added

- `@rtcamp/eslint-config/jest`: the same config with `eslint-plugin-jest`'s recommended rules on the test paths instead of Vitest's.
- Ignores for `build/`, `vendor/` and `node_modules/`, and file discovery for `.jsx`, `.ts`, `.tsx`, `.mts` and `.cts`, matching the default config in `@wordpress/scripts`. `.jsx` files were skipped before ("File ignored because no matching configuration was supplied"), and `wp-scripts lint-js` drops its own default once a project has an `eslint.config.js`, so projects on this package got neither.

### Removed

- The optional `eslint-import-resolver-typescript` peer dependency. The config never used it: `@wordpress/eslint-plugin` installs and configures the resolver itself. Through the resolver's own peers, it made upgrading next to `@wordpress/scripts` 37 fail with `ERESOLVE`.

## [1.2.0] - 2026-10-01

### Changed

- The `@wordpress/eslint-plugin` peer range accepts 26 and 27 (`^25.1.0 || ^26.0.0 || ^27.0.0`). `@wordpress/scripts` 36 depends on 27, so projects on it could not move their own `@wordpress/eslint-plugin` past 25 without an install conflict. The config needs no other change: 26 drops `@babel/eslint-parser` from the `esnext` ruleset, and 27 moves `test-unit` to Vitest rules, but this config never used `test-unit` and already configures `eslint-plugin-jest` for `**/*.test.js` itself.

## [1.1.0] - 2026-10-01

### Changed

- `engines.node` raised to `>=22.19` to match the rest of the monorepo (`@rtcamp/wp-tooling` needs it for Lighthouse 13).

## [1.0.0] - 2026-07-30

### Added

- Initial release — rtCamp shareable ESLint flat config, extracted from `@rtcamp/wp-tooling`.
  Extends `@wordpress/eslint-plugin` (recommended), `@eslint-community/eslint-plugin-eslint-comments`,
  and `eslint-plugin-jest` scoped to `**/*.test.js`.
