'use strict';

const path = require('path');

const { runCli, parseArgs } = require('../../src/scaffolds/cli');
const cli = require('../../src/cli/index');

const FIXTURES = path.join(__dirname, 'fixtures');
const FIXTURES_MALFORMED = path.join(__dirname, 'fixtures-malformed');

describe('scaffolds-validate parseArgs()', () => {
	test('parses --help', () => {
		expect(parseArgs(['--help'])).toEqual({ help: true });
		expect(parseArgs(['-h'])).toEqual({ help: true });
	});

	test('parses a positional dir', () => {
		expect(parseArgs(['./bin/scaffolds'])).toEqual({
			dir: './bin/scaffolds',
		});
	});

	test('throws on unknown flag', () => {
		expect(() => parseArgs(['--bogus'])).toThrow(/unknown argument/);
	});

	test('rejects --dry-run as unknown (read-only command)', () => {
		expect(() => parseArgs(['--dry-run'])).toThrow(/unknown argument/);
	});

	test('throws on a second positional', () => {
		expect(() => parseArgs(['a', 'b'])).toThrow(
			/unexpected positional argument/
		);
	});
});

describe('scaffolds-validate runCli()', () => {
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

	test('--help prints usage and returns 0', async () => {
		const code = await runCli(['--help']);
		expect(code).toBe(0);
		expect(stdoutChunks.join('')).toMatch(/Usage: scaffolds-validate/);
	});

	test('missing <dir> returns 2 with stderr usage hint', async () => {
		const code = await runCli([]);
		expect(code).toBe(2);
		expect(stderrChunks.join('')).toMatch(/missing <dir>/);
	});

	test('unknown flag returns 2', async () => {
		const code = await runCli(['--nope']);
		expect(code).toBe(2);
		expect(stderrChunks.join('')).toMatch(/unknown argument/);
	});

	test('--dry-run returns 2 (read-only command, flag not supported)', async () => {
		const code = await runCli(['--dry-run', FIXTURES]);
		expect(code).toBe(2);
		expect(stderrChunks.join('')).toMatch(/unknown argument: --dry-run/);
	});

	test('valid fixtures return 0 with count line', async () => {
		const code = await runCli([FIXTURES]);
		expect(code).toBe(0);
		expect(stdoutChunks.join('')).toMatch(/3 scaffolds valid/);
	});

	test('missing directory returns 0 with zero count', async () => {
		const code = await runCli(['/does/not/exist']);
		expect(code).toBe(0);
		expect(stdoutChunks.join('')).toMatch(/0 scaffolds valid/);
	});

	test('malformed fixture returns 1 with file path in stderr', async () => {
		const code = await runCli([FIXTURES_MALFORMED]);
		expect(code).toBe(1);
		const stderr = stderrChunks.join('');
		expect(stderr).toMatch(/scaffolds-validate:/);
		expect(stderr).toMatch(
			new RegExp(path.join(FIXTURES_MALFORMED, 'scaffold\\.json'))
		);
	});
});

describe('cli dispatcher routes scaffolds-validate', () => {
	test('COMMANDS map contains scaffolds-validate', () => {
		expect(cli.COMMANDS['scaffolds-validate']).toBeDefined();
		expect(typeof cli.COMMANDS['scaffolds-validate'].run).toBe('function');
		expect(cli.COMMANDS['scaffolds-validate'].summary).toMatch(/scaffold/i);
	});

	test('main() routes scaffolds-validate --help and resolves 0', async () => {
		const stdoutSpy = jest
			.spyOn(process.stdout, 'write')
			.mockImplementation(() => true);
		try {
			const code = await cli.main(['scaffolds-validate', '--help']);
			expect(code).toBe(0);
		} finally {
			stdoutSpy.mockRestore();
		}
	});
});
