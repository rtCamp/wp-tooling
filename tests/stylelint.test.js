'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const config = require('../index');

// Import via a separate node process since Stylelint 17 is ESM-only.
const cli = path.join(
	path.dirname(require.resolve('stylelint')),
	'../bin/stylelint.mjs'
);

/**
 * Lint source code with this package's config.
 *
 * @param {string} code     - CSS or SCSS source.
 * @param {string} filename - Virtual file name.
 * @return {string[]} The rules that reported a problem.
 */
const lint = (code, filename) => {
	const { stderr } = spawnSync(
		process.execPath,
		[
			cli,
			'--config',
			path.join(__dirname, '../index.js'),
			'--stdin-filename',
			filename,
			'--formatter',
			'json',
		],
		{ input: code, encoding: 'utf8' }
	);
	return JSON.parse(stderr)[0].warnings.map((warning) => warning.rule);
};

describe('stylelint config', () => {
	it('exports a plain object', () => {
		expect(typeof config).toBe('object');
		expect(config).not.toBeNull();
		expect(Array.isArray(config)).toBe(false);
	});

	it('extends @wordpress/stylelint-config', () => {
		expect(config.extends).toContain('@wordpress/stylelint-config');
	});

	it('extends @wordpress/stylelint-config/scss', () => {
		expect(config.extends).toContain('@wordpress/stylelint-config/scss');
	});

	it('passes clean CSS and SCSS', () => {
		expect(lint('a {\n\tcolor: #fff;\n}\n', 'style.css')).toEqual([]);
		expect(
			lint('$color: #fff;\n\na {\n\tcolor: $color;\n}\n', 'style.scss')
		).toEqual([]);
	});

	it('reports CSS problems', () => {
		expect(lint('a {}\n', 'style.css')).toEqual(['block-no-empty']);
	});

	it('reports SCSS problems', () => {
		expect(lint('a {\n\t@extend .button;\n}\n', 'style.scss')).toEqual([
			'scss/at-extend-no-missing-placeholder',
		]);
	});
});
