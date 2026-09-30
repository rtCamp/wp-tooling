'use strict';
const {
	runCleanup,
	resolveSetupCleanup,
	runSetupCleanup,
} = require('../../src/init/cleanup');
const fs = require('fs');
const path = require('path');
const { makeRoot, touch, snapshot } = require('./_helpers');

describe('runCleanup', () => {
	let root;
	const ui = { info: jest.fn() };
	beforeEach(() => {
		root = makeRoot();
	});
	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
		jest.restoreAllMocks();
	});
	test('cleanup validates all paths before deleting any target', () => {
		touch(root, 'keep.txt', 'keep');
		expect(() => runCleanup(root, ['keep.txt', '.'], ui)).toThrow(
			/project root/
		);
		expect(fs.readFileSync(path.join(root, 'keep.txt'), 'utf8')).toBe(
			'keep'
		);
	});

	test.each(['keep.txt', {}, [null]])(
		'rejects malformed cleanup targets %j before deletion',
		(targets) => {
			touch(root, 'keep.txt', 'keep');
			expect(() => runCleanup(root, targets, ui)).toThrow(/Expected/);
			expect(fs.readFileSync(path.join(root, 'keep.txt'), 'utf8')).toBe(
				'keep'
			);
		}
	);
	test('removes files and directories and skips missing targets', () => {
		touch(root, 'file.txt');
		touch(root, 'nested/file.txt');
		expect(runCleanup(root, ['file.txt', 'nested', 'missing'], ui)).toBe(2);
		expect(fs.readdirSync(root)).toEqual([]);
	});
});

describe('runSetupCleanup', () => {
	let root;
	let ui;
	const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
	const exists = (rel) => fs.existsSync(path.join(root, rel));
	beforeEach(() => {
		root = makeRoot();
		ui = { info: jest.fn(), warn: jest.fn() };
	});
	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
	});

	test('moves each source over its destination, creating parent directories', () => {
		touch(root, 'README.md', 'starter readme');
		touch(root, 'README.plugin.md', 'plugin readme');
		touch(root, 'docs/index.plugin.md', 'plugin index');
		const result = runSetupCleanup(
			root,
			{
				replace: [
					{ from: 'README.plugin.md', to: 'README.md' },
					{ from: 'docs/index.plugin.md', to: 'guides/index.md' },
				],
			},
			ui
		);
		expect(result).toEqual({ replaced: 2, unset: 0 });
		expect(read('README.md')).toBe('plugin readme');
		expect(read('guides/index.md')).toBe('plugin index');
		expect(exists('README.plugin.md')).toBe(false);
		expect(exists('docs/index.plugin.md')).toBe(false);
	});

	test('warns about and skips a missing source', () => {
		touch(root, 'README.md', 'starter readme');
		const result = runSetupCleanup(
			root,
			{
				replace: [{ from: 'README.plugin.md', to: 'README.md' }],
				unset: [{ file: 'package.json', keys: ['homepage'] }],
			},
			ui
		);
		expect(result).toEqual({ replaced: 0, unset: 0 });
		expect(read('README.md')).toBe('starter readme');
		expect(ui.warn).toHaveBeenCalledWith(
			'skipped README.md: README.plugin.md not found'
		);
		expect(ui.warn).toHaveBeenCalledWith(
			'skipped package.json: file not found'
		);
	});

	test.each([
		['tabs', '\t', '\n'],
		['two spaces', '  ', '\n'],
		['no trailing newline', '\t', ''],
	])(
		'removes listed top-level keys and keeps the file style (%s)',
		(label, indent, eol) => {
			const pkg = {
				name: 'starter',
				homepage: 'https://example.com/starter',
				repository: { type: 'git', url: 'https://example.com/r.git' },
				bugs: { url: 'https://example.com/issues' },
				license: 'GPL-2.0-or-later',
			};
			touch(
				root,
				'package.json',
				JSON.stringify(pkg, null, indent) + eol
			);
			const result = runSetupCleanup(
				root,
				{
					unset: [
						{
							file: 'package.json',
							keys: ['homepage', 'repository', 'bugs', 'absent'],
						},
					],
				},
				ui
			);
			expect(result).toEqual({ replaced: 0, unset: 3 });
			expect(read('package.json')).toBe(
				JSON.stringify(
					{ name: 'starter', license: 'GPL-2.0-or-later' },
					null,
					indent
				) + eol
			);
		}
	);

	test('leaves a JSON file untouched when none of its keys are present', () => {
		const raw = '{\n    "name": "starter"\n}';
		touch(root, 'package.json', raw);
		expect(
			runSetupCleanup(
				root,
				{ unset: [{ file: 'package.json', keys: ['homepage'] }] },
				ui
			)
		).toEqual({ replaced: 0, unset: 0 });
		expect(read('package.json')).toBe(raw);
	});

	test.each([
		['invalid JSON', '{broken', /package\.json to be valid JSON/],
		['a non-object', '[]', /JSON object/],
	])('%s fails before any file moves', (label, body, message) => {
		touch(root, 'README.md', 'starter readme');
		touch(root, 'README.plugin.md', 'plugin readme');
		touch(root, 'package.json', body);
		const before = snapshot(root);
		expect(() =>
			runSetupCleanup(
				root,
				{
					replace: [{ from: 'README.plugin.md', to: 'README.md' }],
					unset: [{ file: 'package.json', keys: ['homepage'] }],
				},
				ui
			)
		).toThrow(message);
		expect(snapshot(root)).toEqual(before);
	});

	test.each([
		[
			'a directory source',
			() => touch(root, 'plugin-docs/index.md'),
			{ from: 'plugin-docs', to: 'docs' },
			/source plugin-docs to be a file/,
		],
		[
			'a directory destination',
			() => {
				touch(root, 'README.plugin.md');
				touch(root, 'README.md/nested.md');
			},
			{ from: 'README.plugin.md', to: 'README.md' },
			/destination README\.md to be a file/,
		],
	])('rejects %s before any file moves', (label, arrange, pair, message) => {
		arrange();
		touch(root, 'CHANGELOG.plugin.md', 'plugin changelog');
		const before = snapshot(root);
		expect(() =>
			runSetupCleanup(
				root,
				{
					replace: [
						{ from: 'CHANGELOG.plugin.md', to: 'CHANGELOG.md' },
						pair,
					],
				},
				ui
			)
		).toThrow(message);
		expect(snapshot(root)).toEqual(before);
	});
});

describe('resolveSetupCleanup', () => {
	let root;
	const pair = (from, to) => ({ from, to });
	const keys = (file, list) => ({ file, keys: list });
	beforeEach(() => {
		root = makeRoot();
	});
	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
	});

	test('accepts a source inside a cleanup target, since moves run first', () => {
		const { moves } = resolveSetupCleanup(root, {
			targets: ['plugin-docs'],
			replace: [pair('plugin-docs/README.md', 'README.md')],
		});
		expect(moves).toHaveLength(1);
	});

	test('accepts an absent cleanup block and one without replace or unset', () => {
		expect(resolveSetupCleanup(root, undefined)).toEqual({
			moves: [],
			edits: [],
		});
		expect(resolveSetupCleanup(root, { targets: ['x'] })).toEqual({
			moves: [],
			edits: [],
		});
	});

	test.each([
		[{ replace: {} }, /cleanup\.replace to be an array/],
		[{ unset: 'package.json' }, /cleanup\.unset to be an array/],
		[{ replace: ['README.md'] }, /cleanup\.replace\[0\] to be an object/],
		[{ replace: [null] }, /cleanup\.replace\[0\] to be an object/],
		[{ replace: [pair('../x.md', 'README.md')] }, /replace\[0\]\.from/],
		[{ replace: [pair('a.md', '/abs.md')] }, /replace\[0\]\.to/],
		[{ replace: [pair('a.md', '.')] }, /below the project root/],
		[{ replace: [pair('a.md', 'a.md')] }, /to differ from/],
		[
			{ replace: [pair('a.md', 'README.md'), pair('b.md', 'README.md')] },
			/destination once/,
		],
		[
			{ replace: [pair('a.md', 'b.md'), pair('a.md', 'c.md')] },
			/source once, received "a\.md" again at cleanup\.replace\[1\]\.from/,
		],
		[
			{ replace: [pair('a.md', 'b.md'), pair('b.md', 'c.md')] },
			/another pair's destination/,
		],
		[
			{ replace: [pair('a.md', 'notes'), pair('b.md', 'notes/b.md')] },
			/replace\[1\]\.to not to sit under another pair's destination/,
		],
		[
			{ targets: ['docs'], replace: [pair('a.md', 'docs/index.md')] },
			/replace\[0\]\.to to be outside cleanup target "docs"/,
		],
		[
			{ targets: ['README.md'], replace: [pair('a.md', 'README.md')] },
			/replace\[0\]\.to to be outside cleanup target "README.md"/,
		],
		[{ unset: [{ file: 'package.json' }] }, /unset\[0\]\.keys/],
		[{ unset: [keys('package.json', [])] }, /unset\[0\]\.keys/],
		[{ unset: [keys('package.json', [''])] }, /unset\[0\]\.keys/],
		[{ unset: [keys('package.json', [1])] }, /unset\[0\]\.keys/],
		[
			{ unset: [keys('package.json', ['a', 'a'])] },
			/unset\[0\]\.keys to be a nonempty array of unique/,
		],
		[{ unset: [keys('../package.json', ['a'])] }, /unset\[0\]\.file/],
		[
			{
				unset: [
					keys('package.json', ['a']),
					keys('package.json', ['b']),
				],
			},
			/cleanup\.unset file once/,
		],
		[
			{
				replace: [pair('package.plugin.json', 'package.json')],
				unset: [keys('package.json', ['a'])],
			},
			/not to be a cleanup\.replace source or destination/,
		],
		[
			{ targets: ['package.json'], unset: [keys('package.json', ['a'])] },
			/outside cleanup target "package\.json"/,
		],
	])('rejects %j', (cleanup, message) => {
		expect(() => resolveSetupCleanup(root, cleanup)).toThrow(message);
	});
});
