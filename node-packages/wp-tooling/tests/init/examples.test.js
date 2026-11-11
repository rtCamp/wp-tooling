/**
 * Tests for example-set handling -- marker-region stripping (keep vs remove) and
 * the simple single-segment glob expander.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
	stripRegions,
	expandGlob,
	applyExamples,
} = require('../../src/init/examples');
const { createJournal } = require('../../src/init/journal');
const { makeRoot, touch, snapshot, tree } = require('./_helpers');

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

	// Markers may end in a sentence terminator so they satisfy comment linters
	// (WPCS flags a bare `// wp:example`) without needing an ignore annotation.
	const PUNCTUATED = [
		'before',
		'// wp:example.',
		'use Example;',
		'// wp:example:end.',
		'after',
	].join('\n');

	it('accepts a punctuated marker when keeping the body', () => {
		expect(stripRegions(PUNCTUATED, 'wp:example', false)).toBe(
			'before\nuse Example;\nafter'
		);
	});

	it('accepts a punctuated marker when removing the body', () => {
		expect(stripRegions(PUNCTUATED, 'wp:example', true)).toBe(
			'before\nafter'
		);
	});

	it.each(['!', '?'])('accepts "%s" as a terminator too', (end) => {
		const text = [
			`// wp:example${end}`,
			'use Example;',
			`// wp:example:end${end}`,
		].join('\n');
		expect(stripRegions(text, 'wp:example', true)).toBe('');
	});

	it('treats punctuated and bare markers as the same region', () => {
		// Mixed spellings must still pair up, so an existing file part-migrated
		// to punctuated markers does not silently stop stripping.
		const text = [
			'// wp:example',
			'use Example;',
			'// wp:example:end.',
		].join('\n');
		expect(stripRegions(text, 'wp:example', true)).toBe('');
	});

	it('does not let the terminator swallow a longer marker', () => {
		// `[.!?]?` is anchored at end of line, so `wp:example` must not match a
		// line belonging to the more specific `wp:example:settings` group.
		const text = [
			'// wp:example:settings.',
			'keep me',
			'// wp:example:settings:end.',
		].join('\n');
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

describe('applyExamples with a journal', () => {
	let root;
	beforeEach(() => {
		root = makeRoot();
	});
	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
	});

	it('brings back removed folders and stripped files on rollback', () => {
		touch(root, 'inc/Main.php', SAMPLE);
		touch(root, 'inc/Modules/Example.php', '<?php');
		touch(root, 'inc/Modules/Example/Thing.php', '<?php');
		const before = snapshot(root);
		const paths = tree(root);
		const journal = createJournal(root);
		applyExamples(
			{
				examples: {
					groups: [
						{
							key: 'example',
							strip: ['inc/Main.php'],
							remove: [
								'inc/Modules/Example.php',
								'inc/Modules/Example',
							],
						},
					],
				},
			},
			root,
			null,
			new Set(['example']),
			journal
		);
		expect(fs.readFileSync(path.join(root, 'inc/Main.php'), 'utf8')).toBe(
			'before\nafter'
		);
		expect(fs.existsSync(path.join(root, 'inc/Modules'))).toBe(true);
		expect(fs.readdirSync(path.join(root, 'inc/Modules'))).toEqual([]);
		expect(journal.rollback()).toEqual({ errors: [], trash: null });
		expect(snapshot(root)).toEqual(before);
		expect(tree(root)).toEqual(paths);
	});
});
