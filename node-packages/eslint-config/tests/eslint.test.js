'use strict';

const config = require('../index');

describe('eslint config', () => {
	it('exports a non-empty array', () => {
		expect(Array.isArray(config)).toBe(true);
		expect(config.length).toBeGreaterThan(0);
	});

	it('every entry is a plain object', () => {
		for (const entry of config) {
			expect(typeof entry).toBe('object');
			expect(entry).not.toBeNull();
			expect(Array.isArray(entry)).toBe(false);
		}
	});

	it('includes the eslint-comments plugin', () => {
		const entry = config.find(
			(e) => e.plugins && '@eslint-community/eslint-comments' in e.plugins
		);
		expect(entry).toBeDefined();
	});

	it('includes jest plugin scoped to test files only', () => {
		const entry = config.find((e) => e.plugins && 'jest' in e.plugins);
		expect(entry).toBeDefined();
		expect(entry.files).toEqual(expect.arrayContaining(['**/*.test.js']));
	});
});
