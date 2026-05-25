'use strict';

const fs = require('fs');
const path = require('path');

const { loadContext, findPluginEntry } = require('../../src/release/context');
const { copyFixture, cleanup } = require('./_helpers');

describe('release/context', () => {
	let tmp;

	afterEach(() => {
		cleanup(tmp);
		tmp = null;
	});

	test('findPluginEntry returns the *.php with Plugin Name header', () => {
		tmp = copyFixture('plugin-a');
		const entry = findPluginEntry(tmp);
		expect(entry).toBe(path.join(tmp, 'plugin-a.php'));
	});

	test('findPluginEntry throws when no entry file is present', () => {
		tmp = copyFixture('plugin-a');
		fs.unlinkSync(path.join(tmp, 'plugin-a.php'));
		expect(() => findPluginEntry(tmp)).toThrow(/no plugin entry file/);
	});

	test('findPluginEntry throws when multiple entry files exist at root', () => {
		tmp = copyFixture('plugin-a');
		fs.writeFileSync(
			path.join(tmp, 'second.php'),
			'<?php\n/**\n * Plugin Name: Second\n */\n'
		);
		expect(() => findPluginEntry(tmp)).toThrow(
			/multiple plugin entry files/
		);
	});

	test('findPluginEntry ignores nested *.php with Plugin Name header', () => {
		tmp = copyFixture('plugin-a');
		fs.mkdirSync(path.join(tmp, 'examples'));
		fs.writeFileSync(
			path.join(tmp, 'examples', 'demo.php'),
			'<?php\n/**\n * Plugin Name: Demo\n */\n'
		);
		// Still resolves to the root entry, not the nested one.
		expect(findPluginEntry(tmp)).toBe(path.join(tmp, 'plugin-a.php'));
	});

	test('loadContext returns the full project shape', () => {
		tmp = copyFixture('plugin-a');
		const ctx = loadContext(tmp);
		expect(ctx.currentVersion).toBe('1.2.3');
		expect(ctx.pluginSlug).toBe('plugin-a');
		expect(ctx.pluginEntry).toBe(path.join(tmp, 'plugin-a.php'));
		expect(ctx.packageJson.name).toBe('plugin-a');
		expect(ctx.composerJson.name).toBe('rtcamp/plugin-a');
		expect(ctx.composerJsonPath).toBe(path.join(tmp, 'composer.json'));
	});

	test('loadContext sets composerJson to null when composer.json is absent', () => {
		tmp = copyFixture('plugin-a');
		fs.unlinkSync(path.join(tmp, 'composer.json'));
		const ctx = loadContext(tmp);
		expect(ctx.composerJson).toBeNull();
		expect(ctx.composerJsonPath).toBeNull();
	});

	test('loadContext throws when package.json is missing', () => {
		tmp = copyFixture('plugin-a');
		fs.unlinkSync(path.join(tmp, 'package.json'));
		expect(() => loadContext(tmp)).toThrow(/no package\.json/);
	});

	test('loadContext throws when package.json has no version field', () => {
		tmp = copyFixture('plugin-a');
		fs.writeFileSync(
			path.join(tmp, 'package.json'),
			JSON.stringify({ name: 'plugin-a' })
		);
		expect(() => loadContext(tmp)).toThrow(/no "version" field/);
	});

	test('loadContext propagates a malformed package.json error', () => {
		tmp = copyFixture('plugin-a');
		fs.writeFileSync(path.join(tmp, 'package.json'), '{ not json }');
		expect(() => loadContext(tmp)).toThrow(/failed to parse/);
	});
});
