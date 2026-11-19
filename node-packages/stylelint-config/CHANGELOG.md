# Changelog

All notable changes to `@rtcamp/stylelint-config` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [2.0.0] - 2026-11-20

### Changed

- **Breaking:** requires Stylelint 17. The peer ranges are `stylelint` `^17.14.1`, `@wordpress/stylelint-config` `^25.0.0 || ^26.0.0 || ^27.0.0` and `stylelint-scss` `^7.2.0`, matching `@wordpress/scripts` 35 and later. See the README to upgrade from 1.x.

## [1.1.0] - 2026-10-01

### Changed

- `engines.node` raised to `>=22.19` to match the rest of the monorepo (`@rtcamp/wp-tooling` needs it for Lighthouse 13).

## [1.0.0] - 2026-07-30

### Added

- Initial release — rtCamp shareable Stylelint config, extracted from `@rtcamp/wp-tooling`.
  Extends `@wordpress/stylelint-config` and `@wordpress/stylelint-config/scss`.
