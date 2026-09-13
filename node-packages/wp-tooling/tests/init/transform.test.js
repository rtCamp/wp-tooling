/**
 * Tests for the in-place transform -- single-pass search-replace, the path-
 * confinement guard, and version stamping.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
	applyReplacements,
	resolveWithin,
	applyVersion,
} = require('../../src/init/transform');
const { makeRoot, touch } = require('./_helpers');
const { renameFiles, replaceInFiles } = require('../../src/init/transform');

const noopUi = { info() {}, warn() {}, success() {}, error() {} };

describe('applyReplacements', () => {
	it('replaces every token in one pass', () => {
		const out = applyReplacements('project-name and PROJECT_NAME', [
			['project-name', 'my-plugin'],
			['PROJECT_NAME', 'MY_PLUGIN'],
		]);
		expect(out).toBe('my-plugin and MY_PLUGIN');
	});

	it('does not re-scan substituted text (no cascade)', () => {
		// Renaming foo -> foobar must not become foobarbar.
		expect(applyReplacements('foo', [['foo', 'foobar']])).toBe('foobar');
	});

	it('prefers the longest source token at each position', () => {
		// Pairs are passed longest-first, as buildIdentityReplacements emits them.
		expect(
			applyReplacements('abcd', [
				['abc', 'X'],
				['ab', 'Y'],
			])
		).toBe('Xd');
	});

	it('returns the input unchanged with no replacements', () => {
		expect(applyReplacements('untouched', [])).toBe('untouched');
	});
});

describe('resolveWithin', () => {
	const root = path.resolve('/tmp/project');

	it('resolves a relative path inside the root', () => {
		expect(resolveWithin(root, 'inc/Foo.php')).toBe(
			path.join(root, 'inc/Foo.php')
		);
	});

	it('allows the root itself', () => {
		expect(resolveWithin(root, '.')).toBe(root);
	});

	it('rejects a parent-directory escape', () => {
		expect(() => resolveWithin(root, '../secrets')).toThrow(/outside/i);
	});

	it('rejects an absolute path outside the root', () => {
		expect(() => resolveWithin(root, '/etc/passwd')).toThrow(/outside/i);
	});
});

describe('applyVersion', () => {
	let dir;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-transform-'));
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('stamps the version into json and php-header files', () => {
		fs.writeFileSync(
			path.join(dir, 'package.json'),
			'{\n\t"version": "0.0.0"\n}\n'
		);
		fs.writeFileSync(
			path.join(dir, 'plugin.php'),
			'<?php\n/**\n * Plugin Name: X\n * Version: 0.0.0\n */\n'
		);

		applyVersion(
			dir,
			[
				{ path: 'package.json', kind: 'json' },
				{ path: 'plugin.php', kind: 'php-header' },
			],
			'2.1.0',
			noopUi
		);

		const pkg = JSON.parse(
			fs.readFileSync(path.join(dir, 'package.json'), 'utf8')
		);
		expect(pkg.version).toBe('2.1.0');
		expect(fs.readFileSync(path.join(dir, 'plugin.php'), 'utf8')).toContain(
			'Version: 2.1.0'
		);
	});
});

describe('filesystem transforms', () => {
	let root;
	beforeEach(() => {
		root = makeRoot();
	});
	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
		jest.restoreAllMocks();
	});
	test('rename collision never overwrites an existing destination', () => {
		touch(root, 'starter.txt', 'source');
		touch(root, 'acme.txt', 'destination');
		expect(() =>
			renameFiles([path.join(root, 'starter.txt')], [['starter', 'acme']])
		).toThrow(/collision/i);
		expect(fs.readFileSync(path.join(root, 'acme.txt'), 'utf8')).toBe(
			'destination'
		);
	});

	test('path containment rejects a symlink escape', () => {
		fs.symlinkSync(path.dirname(root), path.join(root, 'escape'));
		expect(() => resolveWithin(root, 'escape/file.txt')).toThrow(/outside/);
	});

	test('replacement failure stops before subsequent files and reports the failing path', () => {
		const files = ['first.txt', 'failing.txt', 'last.txt'].map((name) =>
			path.join(root, name)
		);
		for (const file of files) {
			fs.writeFileSync(file, 'starter');
		}
		const originalWrite = fs.writeFileSync;
		jest.spyOn(fs, 'writeFileSync').mockImplementation((file, ...args) => {
			if (file === files[1]) {
				throw new Error('disk full');
			}
			return originalWrite(file, ...args);
		});
		expect(() => replaceInFiles(files, [['starter', 'acme']])).toThrow(
			/failing.txt: disk full/
		);
		expect(files.map((file) => fs.readFileSync(file, 'utf8'))).toEqual([
			'acme',
			'starter',
			'starter',
		]);
	});

	test('case-only rename changes the directory entry without losing contents', () => {
		touch(root, 'Starter.txt', 'content');
		expect(
			renameFiles(
				[path.join(root, 'Starter.txt')],
				[['Starter', 'starter']]
			)
		).toBe(1);
		expect(fs.readdirSync(root)).toEqual(['starter.txt']);
		expect(fs.readFileSync(path.join(root, 'starter.txt'), 'utf8')).toBe(
			'content'
		);
	});
	test('distinct case-variant files remain a collision', () => {
		touch(root, 'Starter.txt', 'source');
		// A case-insensitive filesystem cannot host both directory entries.
		if (fs.existsSync(path.join(root, 'starter.txt'))) {
			return;
		}
		touch(root, 'starter.txt', 'destination');
		expect(() =>
			renameFiles(
				[path.join(root, 'Starter.txt')],
				[['Starter', 'starter']]
			)
		).toThrow(/collision/);
		expect(fs.readFileSync(path.join(root, 'starter.txt'), 'utf8')).toBe(
			'destination'
		);
	});
});
