# Changelog

All notable changes to `rtcamp/wp-phpstan` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Added

- Initial shared PHPStan baseline (`phpstan.neon.dist`): level 5,
  `treatPhpDocTypesAsCertain: false`, `reportUnmatchedIgnoredErrors: true`.
- Dependency on `szepeviktor/phpstan-wordpress ^2.0` (which pulls `phpstan/phpstan ^2.0`
  and the WordPress stubs) so consumers get the full toolchain from one dev requirement.
