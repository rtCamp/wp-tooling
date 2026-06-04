/**
 * Tests for the shared CLI plumbing (src/scaffolds/cli-support.js). The
 * flag-value guard and registry-construction recipe used to be copy-pasted
 * into every subcommand; the per-command suites now only smoke-test that they
 * wire these in, while the contract itself is pinned here once.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
	defaultsDir,
	projectDir,
	buildRegistry,
	fetchOptsFrom,
	requireFlagValue,
} = require('../../src/scaffolds/cli-support');

describe('requireFlagValue', () => {
	it('returns a normal value', () => {
		expect(requireFlagValue('src', '--cwd')).toBe('src');
	});

	it('throws when the value is missing', () => {
		expect(() => requireFlagValue(undefined, '--cwd')).toThrow(
			/Missing value for --cwd/
		);
	});

	it('throws when the next token is itself a flag', () => {
		// `--name --json` must not consume --json as the value.
		expect(() => requireFlagValue('--json', '--name')).toThrow(
			/Missing value for --name/
		);
	});

	it('points the user at the =value form for dash-leading values', () => {
		expect(() => requireFlagValue('--x', '--name')).toThrow(
			/--name=<value>/
		);
	});
});

describe('fetchOptsFrom', () => {
	it('maps only the set fetch options', () => {
		expect(fetchOptsFrom({})).toEqual({});
		expect(fetchOptsFrom({ refresh: true, cacheDir: '/c' })).toEqual({
			refresh: true,
			cacheDir: '/c',
		});
	});
});

describe('paths + buildRegistry', () => {
	it('resolves the bundled defaults dir and a project bin/scaffolds dir', () => {
		expect(defaultsDir().endsWith(path.join('scaffolds'))).toBe(true);
		expect(projectDir('/x')).toBe(path.join('/x', 'bin', 'scaffolds'));
	});

	it('scans the bundled catalogue', async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wpt-clisupport-'));
		const registry = await buildRegistry(cwd, {});
		expect(registry.get('wp/cli')).toBeTruthy();
	});
});
