'use strict';

const wordpress = require('@wordpress/eslint-plugin');
const commentsConfigs = require('@eslint-community/eslint-plugin-eslint-comments/configs');

// Same test paths as the `@wordpress/scripts` default config.
const TEST_FILES = [
	'**/@(test|__tests__)/**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}',
	'**/*.@(test|spec).{js,jsx,ts,tsx,mjs,cjs,mts,cts}',
];

/**
 * Builds the shared config around a set of unit-test rule configs.
 *
 * Mirrors the default flat config in `@wordpress/scripts` (`config/eslint.config.cjs`),
 * which `wp-scripts lint-js` drops as soon as a project has its own `eslint.config.js`.
 *
 * @param {Object[]} testConfigs Flat configs applied to unit-test files.
 * @return {Object[]} Flat config array.
 */
module.exports = (testConfigs) => [
	{ ignores: ['**/build/**', '**/node_modules/**', '**/vendor/**'] },
	// ESLint only discovers .js, .mjs and .cjs on its own.
	{ files: ['**/*.jsx', '**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'] },
	...wordpress.configs.recommended,
	commentsConfigs.recommended,
	...testConfigs.map((config) => ({ ...config, files: TEST_FILES })),
];
