/**
 * Tests for the identity engine -- name validation, case-variant derivation, and
 * the search-replace pair builder that drives the project rename.
 */
'use strict';

const {
	generateIdentity,
	identityFromName,
	validateName,
	buildIdentityReplacements,
} = require('../../src/init/identity');

const CONFIG = {
	vendor: 'rtcamp',
	namespace: (id) => `${id.pascalSnake}\\Features`,
	package: (id) => `rtcamp/${id.kebab}-features`,
};

describe('validateName', () => {
	it('accepts a normal multi-word name', () => {
		expect(validateName('My Test Plugin')).toBeUndefined();
		expect(validateName('my-plugin')).toBeUndefined();
	});

	it('rejects an empty name', () => {
		expect(validateName('  ')).toMatch(/required/i);
	});

	it('rejects a name starting with a digit', () => {
		expect(validateName('1plugin')).toMatch(/start with a letter/i);
	});

	it('rejects a PHP reserved keyword', () => {
		expect(validateName('class')).toMatch(/reserved/i);
	});
});

describe('generateIdentity', () => {
	it('derives every case variant and WP convention from a name', () => {
		const id = generateIdentity('My Test Plugin');
		expect(id.kebab).toBe('my-test-plugin');
		expect(id.snake).toBe('my_test_plugin');
		expect(id.pascalSnake).toBe('My_Test_Plugin');
		expect(id.macro).toBe('MY_TEST_PLUGIN');
		expect(id.functionPrefix).toBe('my_test_plugin_');
		expect(id.constantPrefix).toBe('MY_TEST_PLUGIN');
		expect(id.cssPrefix).toBe('my-test-plugin-');
		expect(id.package).toBe('rtcamp/my-test-plugin');
	});

	it('splits acronym boundaries', () => {
		expect(generateIdentity('WPGraphQL').kebab).toBe('wp-graph-ql');
	});
});

describe('buildIdentityReplacements', () => {
	const oldId = identityFromName('Project Name', CONFIG);
	const newId = identityFromName('My Plugin', CONFIG);
	const pairs = buildIdentityReplacements(oldId, newId);
	const has = (from, to) => pairs.some(([f, t]) => f === from && t === to);

	it('covers the key case variants and prefixes', () => {
		expect(has('Project_Name', 'My_Plugin')).toBe(true);
		expect(has('project-name', 'my-plugin')).toBe(true);
		expect(has('PROJECT_NAME', 'MY_PLUGIN')).toBe(true);
	});

	it('covers the namespace in single- and double-backslash forms', () => {
		expect(has('Project_Name\\Features', 'My_Plugin\\Features')).toBe(true);
		expect(has('Project_Name\\\\Features', 'My_Plugin\\\\Features')).toBe(
			true
		);
	});

	it('is de-duplicated by source token', () => {
		const froms = pairs.map(([from]) => from);
		expect(new Set(froms).size).toBe(froms.length);
	});

	it('is sorted longest-source-first so specific tokens win', () => {
		for (let i = 1; i < pairs.length; i++) {
			expect(pairs[i - 1][0].length).toBeGreaterThanOrEqual(
				pairs[i][0].length
			);
		}
	});
});
