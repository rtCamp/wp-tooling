'use strict';

const globals = require('globals');
const nPlugin = require('eslint-plugin-n').default;
const wpToolingConfig = require('./src/lint/eslint');

module.exports = [
	...wpToolingConfig,
	{
		plugins: { n: nPlugin },
		languageOptions: {
			ecmaVersion: 2023,
			sourceType: 'commonjs',
			globals: {
				...globals.node,
			},
		},
		rules: {
			'n/no-restricted-require': [
				'error',
				[
					{
						name: 'chalk',
						message:
							'Banned — @rtcamp/wp-tooling is zero-runtime-dep.',
					},
					{
						name: 'inquirer',
						message: 'Banned — use the built-in TTY UI primitives.',
					},
					{
						name: '@inquirer/prompts',
						message: 'Banned — use the built-in TTY UI primitives.',
					},
					{
						name: 'clack',
						message: 'Banned — use the built-in TTY UI primitives.',
					},
					{
						name: '@clack/prompts',
						message: 'Banned — use the built-in TTY UI primitives.',
					},
					{
						name: 'ora',
						message: 'Banned — use the built-in spinner primitive.',
					},
					{
						name: 'listr2',
						message: 'Banned — use the built-in Wizard primitive.',
					},
				],
			],
		},
	},
	{
		files: ['tests/**/*.js'],
		rules: {
			'n/no-restricted-require': 'off',
		},
	},
];
