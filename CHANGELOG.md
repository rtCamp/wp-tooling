# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Added

- Shareable ESLint config exported via `@rtcamp/wp-tooling/eslint-config` — extends `@wordpress/eslint-plugin` recommended (flat config, ESLint v10), `@eslint-community/eslint-plugin-eslint-comments`, and `eslint-plugin-jest` scoped to `**/*.test.js`
- Shareable Stylelint config exported via `@rtcamp/wp-tooling/stylelint-config` — extends `@wordpress/stylelint-config` and `@wordpress/stylelint-config/scss`
- `eslint.config.js` — repo-local flat config extending the shared export, with Node globals and `n/no-restricted-require` banning runtime deps
