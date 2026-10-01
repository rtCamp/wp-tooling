# Changelog

All notable changes to `@rtcamp/eslint-config` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
