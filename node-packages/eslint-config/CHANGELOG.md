# Changelog

All notable changes to `@rtcamp/eslint-config` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- `engines.node` raised to `>=22.19` to match the rest of the monorepo (`@rtcamp/wp-tooling` needs it for Lighthouse 13).

## [1.0.0] - 2026-07-30

### Added

- Initial release — rtCamp shareable ESLint flat config, extracted from `@rtcamp/wp-tooling`.
  Extends `@wordpress/eslint-plugin` (recommended), `@eslint-community/eslint-plugin-eslint-comments`,
  and `eslint-plugin-jest` scoped to `**/*.test.js`.
