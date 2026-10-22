# Changelog

All notable changes to `rtcamp/wp-phpstan` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- `phpVersion` range `80200`–`80599`, so code is analysed against every PHP version from the 8.2 floor up to 8.5.

### Changed

- **Breaking:** the baseline runs at level 8 (was 5). Projects now get missing-type errors for untyped parameters, returns and properties and for arrays with no value type (level 6), partially wrong union types (level 7), and nullable access (level 8). To migrate, record existing errors with `phpstan analyse --generate-baseline`, or set `level` lower in your own neon.
- `phpstan/phpstan` minimum raised to `^2.3`. 2.3 rewrote the analysis engine and bundles the optional Turbo extension, which loads automatically on PHP 8.3+: per its release notes, analysing WordPress core went from 60 s on 2.1.33 to under 8 s. 2.3 also reports some errors older releases missed, mostly `function.resultUnused`.

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
