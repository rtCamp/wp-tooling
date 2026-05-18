# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## Unreleased

### Added

- `./tailwind-config` — `GenerateTailwindThemePlugin` webpack plugin that generates a Tailwind CSS v4 entry point from `theme.json`, mapping WordPress preset tokens to Tailwind utility namespaces (`--color-*`, `--text-*`, `--font-*`, `--spacing-*`, `--shadow-*`)
- `./tailwind-config/postcss` — shareable PostCSS config for `@tailwindcss/postcss`
