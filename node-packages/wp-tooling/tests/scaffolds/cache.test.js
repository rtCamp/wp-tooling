'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { clear, runCli, parseArgs } = require('../../src/scaffolds/cache');

function makeTmpDir(prefix = 'wpt-cache-') {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('clear', () => {
	test('removes a populated cache directory', async () => {
		const dir = makeTmpDir();
		fs.writeFileSync(path.join(dir, 'a'), 'x');
		fs.writeFileSync(path.join(dir, 'b'), 'y');
		await clear(dir);
		expect(fs.existsSync(dir)).toBe(false);
	});

	test('is a no-op on a missing directory', async () => {
		const dir = path.join(os.tmpdir(), `wpt-cache-missing-${Date.now()}`);
		expect(fs.existsSync(dir)).toBe(false);
		await expect(clear(dir)).resolves.toBeUndefined();
	});
});

describe('parseArgs', () => {
	test('extracts the subaction', () => {
		expect(parseArgs(['clear'])).toMatchObject({
			action: 'clear',
			help: false,
		});
	});

	test('extracts --cache-dir <path>', () => {
		expect(parseArgs(['clear', '--cache-dir', '/tmp/x'])).toMatchObject({
			action: 'clear',
			cacheDir: '/tmp/x',
		});
	});

	test('extracts --cache-dir=<path>', () => {
		expect(parseArgs(['clear', '--cache-dir=/tmp/y'])).toMatchObject({
			action: 'clear',
			cacheDir: '/tmp/y',
		});
	});

	test('extracts --help', () => {
		expect(parseArgs(['--help'])).toMatchObject({ help: true });
	});

	test('throws on unexpected positional after the action', () => {
		expect(() => parseArgs(['clear', 'extra'])).toThrow(
			/Unexpected argument/
		);
	});
});

describe('runCli', () => {
	let stdoutSpy;
	let stderrSpy;

	beforeEach(() => {
		stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation();
		stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation();
	});

	afterEach(() => {
		stdoutSpy.mockRestore();
		stderrSpy.mockRestore();
	});

	test('clear --cache-dir succeeds on a populated dir', async () => {
		const dir = makeTmpDir();
		fs.writeFileSync(path.join(dir, 'a'), 'x');
		const code = await runCli(['clear', `--cache-dir=${dir}`]);
		expect(code).toBe(0);
		expect(fs.existsSync(dir)).toBe(false);
	});

	test('--help returns 0 and prints usage', async () => {
		const code = await runCli(['--help']);
		expect(code).toBe(0);
		expect(stdoutSpy).toHaveBeenCalled();
	});

	test('no subaction returns 1 and prints usage', async () => {
		const code = await runCli([]);
		expect(code).toBe(1);
	});

	test('unknown subaction returns 1 and writes to stderr', async () => {
		const code = await runCli(['warm']);
		expect(code).toBe(1);
		expect(stderrSpy).toHaveBeenCalledWith(
			expect.stringContaining('unknown subaction')
		);
	});
});
