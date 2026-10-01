# Changelog

All notable changes to `rtcamp/wp-phpstan` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.0.1] - 2026-10-01

### Added

- `homepage`, `authors` and `support` metadata in `composer.json`, so the Packagist
  page links to the monorepo for issues and source (the mirror repository is a
  read-only split).

### Changed

- README: a header with the license, PHP and tool-version badges, and a note that the
  mirror repository is read-only and issues and pull requests go to rtCamp/wp-tooling.

## [1.0.0] - 2026-07-30

### Added

- Initial shared PHPStan baseline (`phpstan.neon.dist`): level 5,
  `treatPhpDocTypesAsCertain: false`, `reportUnmatchedIgnoredErrors: true`, plus
  low-noise strictness flags (name-case checks, mixed/wide return checks,
  always-true last condition, static method signatures, no loop scope pollution).
- Dependency on `szepeviktor/phpstan-wordpress ^2.0` (which pulls `phpstan/phpstan ^2.0`
  and the WordPress stubs) so consumers get the full toolchain from one dev requirement.
