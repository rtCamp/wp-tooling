/**
 * Tests for example-set handling -- marker-region stripping (keep vs remove) and
 * the simple single-segment glob expander.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { stripRegions, expandGlob } = require('../../src/init/examples');

const SAMPLE = [
	'before',
	'// wp:example',
	'use Example;',
	'// wp:example:end',
	'after',
].join('\n');

describe('stripRegions', () => {
	it('drops only the marker lines when keeping the body', () => {
		expect(stripRegions(SAMPLE, 'wp:example', false)).toBe(
			'before\nuse Example;\nafter'
		);
	});

	it('drops the markers and the enclosed body when removing', () => {
		expect(stripRegions(SAMPLE, 'wp:example', true)).toBe('before\nafter');
	});

	it('only touches regions tagged with the given marker', () => {
		const text = [
			'// wp:example:settings',
			'keep me',
			'// wp:example:settings:end',
		].join('\n');
		// A different marker leaves the region (and its markers) untouched.
		expect(stripRegions(text, 'wp:example', true)).toBe(text);
	});
});

describe('expandGlob', () => {
	let dir;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-glob-'));
		fs.mkdirSync(path.join(dir, 'inc'));
		fs.writeFileSync(path.join(dir, 'inc/ExampleFoo.php'), '');
		fs.writeFileSync(path.join(dir, 'inc/ExampleBar.php'), '');
		fs.writeFileSync(path.join(dir, 'inc/Keep.php'), '');
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('expands a single-segment * glob to matching absolute paths', () => {
		const matches = expandGlob(dir, 'inc/Example*.php').sort();
		expect(matches).toEqual([
			path.join(dir, 'inc/ExampleBar.php'),
			path.join(dir, 'inc/ExampleFoo.php'),
		]);
	});

	it('returns nothing when no file matches', () => {
		expect(expandGlob(dir, 'inc/Missing*.php')).toEqual([]);
	});
});
