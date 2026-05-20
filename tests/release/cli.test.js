'use strict';

const fs = require('fs');
const path = require('path');

const bumpCli = require('../../src/cli/commands/release-bump');
const changelogCli = require('../../src/cli/commands/release-changelog');
const zipCli = require('../../src/cli/commands/release-zip');
const cli = require('../../src/cli/index');

const { copyFixture, cleanup } = require('./_helpers');

describe('release CLIs - dispatcher registration', () => {
	test('release-bump is registered', () => {
		expect(cli.COMMANDS['release-bump']).toBeDefined();
		expect(typeof cli.COMMANDS['release-bump'].run).toBe('function');
		expect(cli.COMMANDS['release-bump'].summary).toMatch(/bump/i);
	});

	test('release-changelog is registered', () => {
		expect(cli.COMMANDS['release-changelog']).toBeDefined();
		expect(typeof cli.COMMANDS['release-changelog'].run).toBe('function');
		expect(cli.COMMANDS['release-changelog'].summary).toMatch(/changelog/i);
	});

	test('release-zip is registered', () => {
		expect(cli.COMMANDS['release-zip']).toBeDefined();
		expect(typeof cli.COMMANDS['release-zip'].run).toBe('function');
		expect(cli.COMMANDS['release-zip'].summary).toMatch(/zip|dist/i);
	});
});

describe('release CLIs - parseArgs', () => {
	test('release-bump parses --type, --to, --dry-run, --help', () => {
		expect(bumpCli.parseArgs(['--type', 'minor'])).toEqual({
			type: 'minor',
			to: null,
			dryRun: false,
			help: false,
		});
		expect(bumpCli.parseArgs(['--to', '2.0.0', '--dry-run'])).toEqual({
			type: 'patch',
			to: '2.0.0',
			dryRun: true,
			help: false,
		});
		expect(bumpCli.parseArgs(['--help']).help).toBe(true);
	});

	test('release-bump rejects unknown args', () => {
		expect(() => bumpCli.parseArgs(['--frobnicate'])).toThrow(
			/unknown argument/
		);
		expect(() => bumpCli.parseArgs(['--type'])).toThrow(/--type requires/);
	});

	test('release-changelog parses --to, --dry-run, --help', () => {
		expect(changelogCli.parseArgs(['--to', '1.2.3'])).toEqual({
			to: '1.2.3',
			dryRun: false,
			help: false,
		});
		expect(changelogCli.parseArgs(['--dry-run']).dryRun).toBe(true);
	});

	test('release-zip parses --force, --dry-run, --help', () => {
		expect(zipCli.parseArgs(['--force'])).toEqual({
			force: true,
			dryRun: false,
			help: false,
		});
		expect(zipCli.parseArgs(['--dry-run']).dryRun).toBe(true);
	});
});

describe('release CLIs - runCli help', () => {
	let stdoutChunks;
	let stderrChunks;
	let stdoutSpy;
	let stderrSpy;

	beforeEach(() => {
		stdoutChunks = [];
		stderrChunks = [];
		stdoutSpy = jest
			.spyOn(process.stdout, 'write')
			.mockImplementation((chunk) => {
				stdoutChunks.push(chunk.toString());
				return true;
			});
		stderrSpy = jest
			.spyOn(process.stderr, 'write')
			.mockImplementation((chunk) => {
				stderrChunks.push(chunk.toString());
				return true;
			});
	});

	afterEach(() => {
		stdoutSpy.mockRestore();
		stderrSpy.mockRestore();
	});

	test('release-bump --help prints usage and returns 0', () => {
		expect(bumpCli.run(['--help'])).toBe(0);
		expect(stdoutChunks.join('')).toMatch(/Usage: wp-tooling release-bump/);
	});

	test('release-changelog --help prints usage and returns 0', () => {
		expect(changelogCli.run(['--help'])).toBe(0);
		expect(stdoutChunks.join('')).toMatch(
			/Usage: wp-tooling release-changelog/
		);
	});

	test('release-zip --help prints usage and returns 0', () => {
		expect(zipCli.run(['--help'])).toBe(0);
		expect(stdoutChunks.join('')).toMatch(/Usage: wp-tooling release-zip/);
	});

	test('release-bump unknown arg returns 2', () => {
		expect(bumpCli.run(['--frobnicate'])).toBe(2);
		expect(stderrChunks.join('')).toMatch(/unknown argument/);
	});
});

describe('release CLIs - runCli end-to-end against fixture', () => {
	let tmp;
	let cwdBackup;
	let stdoutSpy;
	let stderrSpy;

	beforeEach(() => {
		stdoutSpy = jest
			.spyOn(process.stdout, 'write')
			.mockImplementation(() => true);
		stderrSpy = jest
			.spyOn(process.stderr, 'write')
			.mockImplementation(() => true);
		cwdBackup = process.cwd();
	});

	afterEach(() => {
		process.chdir(cwdBackup);
		cleanup(tmp);
		tmp = null;
		stdoutSpy.mockRestore();
		stderrSpy.mockRestore();
	});

	test('release-bump --type patch updates files and returns 0', () => {
		tmp = copyFixture('plugin-a');
		process.chdir(tmp);
		const code = bumpCli.run(['--type', 'patch']);
		expect(code).toBe(0);
		expect(
			JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'))).version
		).toBe('1.2.4');
	});

	test('release-bump --dry-run does not modify files', () => {
		tmp = copyFixture('plugin-a');
		process.chdir(tmp);
		const before = fs.readFileSync(path.join(tmp, 'plugin-a.php'));
		const code = bumpCli.run(['--type', 'minor', '--dry-run']);
		expect(code).toBe(0);
		expect(fs.readFileSync(path.join(tmp, 'plugin-a.php'))).toEqual(before);
	});

	test('release-bump exits 1 when plugin entry missing', () => {
		tmp = copyFixture('plugin-a');
		fs.unlinkSync(path.join(tmp, 'plugin-a.php'));
		process.chdir(tmp);
		const code = bumpCli.run(['--type', 'patch']);
		expect(code).toBe(1);
	});

	test('release-changelog rewrites CHANGELOG and returns 0', () => {
		tmp = copyFixture('plugin-a');
		process.chdir(tmp);
		const code = changelogCli.run([]);
		expect(code).toBe(0);
		const body = fs.readFileSync(path.join(tmp, 'CHANGELOG.md'), 'utf8');
		expect(body).toMatch(/## 1\.2\.3 - \d{4}-\d{2}-\d{2}/);
		expect(body).toMatch(/^## Unreleased$/m);
	});

	test('release-changelog exits 1 on empty Unreleased', () => {
		tmp = copyFixture('plugin-a');
		fs.writeFileSync(
			path.join(tmp, 'CHANGELOG.md'),
			'# Changelog\n\n## Unreleased\n\n## 1.0.0\n'
		);
		process.chdir(tmp);
		const code = changelogCli.run([]);
		expect(code).toBe(1);
	});

	test('release-zip writes dist/<slug>-<version>.zip and returns 0', () => {
		tmp = copyFixture('plugin-a');
		process.chdir(tmp);
		const code = zipCli.run([]);
		expect(code).toBe(0);
		expect(
			fs.existsSync(path.join(tmp, 'dist', 'plugin-a-1.2.3.zip'))
		).toBe(true);
	});

	test('release-zip refuses to overwrite without --force', () => {
		tmp = copyFixture('plugin-a');
		process.chdir(tmp);
		expect(zipCli.run([])).toBe(0);
		expect(zipCli.run([])).toBe(1);
		expect(zipCli.run(['--force'])).toBe(0);
	});
});
