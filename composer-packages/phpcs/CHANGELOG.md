# Changelog

All notable changes to `rtcamp/wp-phpcs` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.0] - 2026-07-30

### Added

- `rtCampWP-Basic` standard — WPCS (`WordPress-Extra`) + `WordPress-VIP-Go` +
  `WordPress-Docs` + `PHPCompatibilityWP`, with modern idioms (`[]`, `?:`) allowed and
  one-blank-line function spacing. At parity with the rtCamp plugin and theme skeletons.
- `rtCampWP` standard — the full strict superset: `rtCampWP-Basic` plus short-array
  enforcement and the Slevomat strict-typing, code-quality and doc-block sniffs.
- `phpcs.xml.dist.example` — a commented consumer template.
