/**
 * ESLint configuration — @rtcamp/wp-tooling
 *
 * Uses @wordpress/eslint-plugin for WordPress JS conventions.
 * ESLint is pinned at 8.57.1 — do NOT upgrade (required by @wordpress/scripts range).
 */
module.exports = {
    root: true,
    extends: [ 'plugin:@wordpress/eslint-plugin/recommended' ],
    env: {
        node: true,
        jest: true,
    },
    parserOptions: {
        ecmaVersion: 2023,
        sourceType: 'script',
    },
    rules: {
        // This package is zero-runtime-dep — block accidental external imports.
        'no-restricted-modules': [
            'error',
            {
                paths: [
                    { name: 'chalk',               message: 'Banned — @rtcamp/wp-tooling is zero-runtime-dep.' },
                    { name: 'inquirer',            message: 'Banned — use the built-in TTY UI primitives.' },
                    { name: '@inquirer/prompts',   message: 'Banned — use the built-in TTY UI primitives.' },
                    { name: 'clack',               message: 'Banned — use the built-in TTY UI primitives.' },
                    { name: '@clack/prompts',      message: 'Banned — use the built-in TTY UI primitives.' },
                    { name: 'ora',                 message: 'Banned — use the built-in spinner primitive.' },
                    { name: 'listr2',              message: 'Banned — use the built-in Wizard primitive.' },
                ],
            },
        ],
    },
    overrides: [
        {
            files: [ 'tests/**/*.js' ],
            rules: {
                'no-restricted-modules': 'off',
                'no-console': 'off',
            },
        },
        {
            files: [ 'examples/**/*.js' ],
            rules: {
                'no-console': 'off',
            },
        },
        {
            files: [ 'bin/**/*.js' ],
            rules: {
                'no-console': 'off',
            },
        },
    ],
};
