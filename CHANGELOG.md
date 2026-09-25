# Changelog

All notable changes to `@rtcamp/tailwind-config` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- `engines.node` raised to `>=22.19` to match the rest of the monorepo (`@rtcamp/wp-tooling` needs it for Lighthouse 13).

## [1.0.0] - 2026-07-30

### Added

- Initial release — rtCamp Tailwind CSS v4 integration, extracted from `@rtcamp/wp-tooling`.
  `GenerateTailwindThemePlugin` webpack plugin (generates a Tailwind entry from `theme.json`)
  and a shareable PostCSS config at `@rtcamp/tailwind-config/postcss`.
