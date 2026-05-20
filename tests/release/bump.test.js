'use strict';

const fs = require('fs');
const path = require('path');

const {
	bump,
	nextVersion,
	rewritePluginEntry,
	rewriteJsonVersion,
	slugToConstantPrefix,
} = require('../../src/release/bump');
const { copyFixture, cleanup } = require('./_helpers');

describe('release/bump - pure helpers', () => {
	test('nextVersion patch', () => {
		expect(nextVersion('1.2.3', 'patch')).toBe('1.2.4');
	});
	test('nextVersion minor zeros patch', () => {
		expect(nextVersion('1.2.3', 'minor')).toBe('1.3.0');
	});
	test('nextVersion major zeros minor + patch', () => {
		expect(nextVersion('1.2.3', 'major')).toBe('2.0.0');
	});
	test('nextVersion explicit override wins', () => {
		expect(nextVersion('1.2.3', 'patch', '9.9.9')).toBe('9.9.9');
	});
	test('nextVersion rejects malformed current', () => {
		expect(() => nextVersion('not-semver', 'patch')).toThrow(/not a valid/);
	});
	test('nextVersion rejects malformed explicit', () => {
		expect(() => nextVersion('1.2.3', 'patch', '1.2')).toThrow(
			/not a valid/
		);
	});
	test('nextVersion rejects unknown type', () => {
		expect(() => nextVersion('1.2.3', 'frobnicate')).toThrow(/--type/);
	});

	test('slugToConstantPrefix converts kebab to UPPER_SNAKE', () => {
		expect(slugToConstantPrefix('my-plugin')).toBe('MY_PLUGIN');
		expect(slugToConstantPrefix('a')).toBe('A');
		expect(slugToConstantPrefix('foo-bar-baz')).toBe('FOO_BAR_BAZ');
	});

	test('rewritePluginEntry rewrites Version header and constant value', () => {
		const body = [
			'<?php',
			'/**',
			' * Plugin Name: X',
			' * Version:     1.2.3',
			' */',
			"define( 'MY_PLUGIN_VERSION', '1.2.3' );",
			'',
		].join('\n');
		const result = rewritePluginEntry(body, '2.0.0', 'MY_PLUGIN_VERSION');
		expect(result.headerWritten).toBe(true);
		expect(result.constantWritten).toBe(true);
		expect(result.body).toContain('Version:     2.0.0');
		expect(result.body).toContain("define( 'MY_PLUGIN_VERSION', '2.0.0' )");
		// constant name preserved
		expect(result.body).toContain('MY_PLUGIN_VERSION');
	});

	test('rewritePluginEntry also rewrites const-style constants', () => {
		const body = "const MY_PLUGIN_VERSION = '1.0.0';";
		const result = rewritePluginEntry(body, '2.0.0', 'MY_PLUGIN_VERSION');
		expect(result.constantWritten).toBe(true);
		expect(result.body).toBe("const MY_PLUGIN_VERSION = '2.0.0';");
	});

	test('rewriteJsonVersion preserves a 2-space indent', () => {
		const file = path.join(
			require('os').tmpdir(),
			`bump-indent-${Date.now()}.json`
		);
		fs.writeFileSync(file, '{\n  "version": "1.0.0"\n}\n');
		const next = rewriteJsonVersion(file, '2.0.0');
		fs.unlinkSync(file);
		expect(next).toBe('{\n  "version": "2.0.0"\n}\n');
	});

	test('rewriteJsonVersion returns null when version key absent', () => {
		const file = path.join(
			require('os').tmpdir(),
			`bump-noversion-${Date.now()}.json`
		);
		fs.writeFileSync(file, '{"name": "x"}\n');
		const next = rewriteJsonVersion(file, '2.0.0');
		fs.unlinkSync(file);
		expect(next).toBeNull();
	});
});

describe('release/bump - integration against fixture', () => {
	let tmp;

	afterEach(() => {
		cleanup(tmp);
		tmp = null;
	});

	test('patch bump updates package.json, composer.json, plugin entry, constant', () => {
		tmp = copyFixture('plugin-a');
		const result = bump({ cwd: tmp, type: 'patch' });
		expect(result.from).toBe('1.2.3');
		expect(result.to).toBe('1.2.4');
		expect(result.dryRun).toBe(false);
		expect(result.changed.sort()).toEqual(
			['composer.json', 'package.json', 'plugin-a.php'].sort()
		);

		expect(
			JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'))).version
		).toBe('1.2.4');
		expect(
			JSON.parse(fs.readFileSync(path.join(tmp, 'composer.json'))).version
		).toBe('1.2.4');
		const php = fs.readFileSync(path.join(tmp, 'plugin-a.php'), 'utf8');
		expect(php).toContain('Version:     1.2.4');
		expect(php).toContain("define( 'PLUGIN_A_VERSION', '1.2.4' )");
	});

	test('--to overrides --type', () => {
		tmp = copyFixture('plugin-a');
		const result = bump({ cwd: tmp, type: 'major', to: '5.5.5' });
		expect(result.to).toBe('5.5.5');
		expect(
			JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'))).version
		).toBe('5.5.5');
	});

	test('dry-run does not write any file', () => {
		tmp = copyFixture('plugin-a');
		const before = fs.readFileSync(path.join(tmp, 'plugin-a.php'));
		const result = bump({ cwd: tmp, type: 'minor', dryRun: true });
		expect(result.to).toBe('1.3.0');
		expect(result.dryRun).toBe(true);
		expect(fs.readFileSync(path.join(tmp, 'plugin-a.php'))).toEqual(before);
		expect(
			JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'))).version
		).toBe('1.2.3');
	});

	test('composer.json without version is left untouched', () => {
		tmp = copyFixture('plugin-a');
		fs.writeFileSync(
			path.join(tmp, 'composer.json'),
			JSON.stringify({ name: 'rtcamp/plugin-a' }, null, 4) + '\n'
		);
		const result = bump({ cwd: tmp, type: 'patch' });
		expect(result.changed).not.toContain('composer.json');
		const composer = JSON.parse(
			fs.readFileSync(path.join(tmp, 'composer.json'))
		);
		expect(composer.version).toBeUndefined();
	});

	test('throws when plugin entry has no Version header', () => {
		tmp = copyFixture('plugin-a');
		const without = fs
			.readFileSync(path.join(tmp, 'plugin-a.php'), 'utf8')
			.replace(/^[ \t]*\*?\s*Version:.*$/m, ' * NoVersion: 1.2.3');
		fs.writeFileSync(path.join(tmp, 'plugin-a.php'), without);
		expect(() => bump({ cwd: tmp, type: 'patch' })).toThrow(
			/no "Version:" header/
		);
	});

	test('exits non-zero (via thrown error) when plugin entry is missing', () => {
		tmp = copyFixture('plugin-a');
		fs.unlinkSync(path.join(tmp, 'plugin-a.php'));
		expect(() => bump({ cwd: tmp, type: 'patch' })).toThrow(
			/no plugin entry file/
		);
	});

	test('rejects a malformed config.constantPrefix', () => {
		tmp = copyFixture('plugin-a');
		const pkg = JSON.parse(fs.readFileSync(path.join(tmp, 'package.json')));
		pkg.config = { constantPrefix: 'my-bad-prefix*' };
		fs.writeFileSync(
			path.join(tmp, 'package.json'),
			JSON.stringify(pkg, null, 4) + '\n'
		);
		expect(() => bump({ cwd: tmp, type: 'patch' })).toThrow(
			/invalid constantPrefix/
		);
	});

	test('config.constantPrefix overrides the slug-derived constant name', () => {
		tmp = copyFixture('plugin-a');
		const pkg = JSON.parse(fs.readFileSync(path.join(tmp, 'package.json')));
		pkg.config = { constantPrefix: 'ACME_PLUGIN' };
		fs.writeFileSync(
			path.join(tmp, 'package.json'),
			JSON.stringify(pkg, null, 4) + '\n'
		);
		// Replace constant name in entry file so the new prefix matches.
		const php = fs
			.readFileSync(path.join(tmp, 'plugin-a.php'), 'utf8')
			.replace('PLUGIN_A_VERSION', 'ACME_PLUGIN_VERSION');
		fs.writeFileSync(path.join(tmp, 'plugin-a.php'), php);

		bump({ cwd: tmp, type: 'patch' });
		const after = fs.readFileSync(path.join(tmp, 'plugin-a.php'), 'utf8');
		expect(after).toContain("define( 'ACME_PLUGIN_VERSION', '1.2.4' )");
	});
});
