'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const cli = require('../../src/cli/index');
const PKG = require('../../package.json');

function tmpFile(name, body) {
	const p = path.join(
		os.tmpdir(),
		`cli-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`
	);
	fs.writeFileSync(p, body);
	return p;
}

describe('cli main()', () => {
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

	test('no args prints top-level usage and exits 0', () => {
		const code = cli.main([]);
		expect(code).toBe(0);
		const out = stdoutChunks.join('');
		expect(out).toMatch(/Usage: wp-tooling/);
		expect(out).toMatch(/detect-changes/);
	});

	test('--help prints top-level usage', () => {
		const code = cli.main(['--help']);
		expect(code).toBe(0);
		expect(stdoutChunks.join('')).toMatch(/Usage: wp-tooling/);
	});

	test('-h prints top-level usage', () => {
		const code = cli.main(['-h']);
		expect(code).toBe(0);
		expect(stdoutChunks.join('')).toMatch(/Usage: wp-tooling/);
	});

	test('--version prints package version and exits 0', () => {
		const code = cli.main(['--version']);
		expect(code).toBe(0);
		expect(stdoutChunks.join('').trim()).toBe(PKG.version);
	});

	test('-v prints package version', () => {
		const code = cli.main(['-v']);
		expect(code).toBe(0);
		expect(stdoutChunks.join('').trim()).toBe(PKG.version);
	});

	test('unknown top-level flag exits 2 with stderr message', () => {
		const code = cli.main(['--bogus']);
		expect(code).toBe(2);
		expect(stderrChunks.join('')).toMatch(/unknown option "--bogus"/);
	});

	test('unknown subcommand exits 2 with stderr message', () => {
		const code = cli.main(['frobnicate']);
		expect(code).toBe(2);
		expect(stderrChunks.join('')).toMatch(/unknown command "frobnicate"/);
	});

	test('routes detect-changes --help to its runCli', () => {
		const code = cli.main(['detect-changes', '--help']);
		expect(code).toBe(0);
		expect(stdoutChunks.join('')).toMatch(/Usage: detect-changes/);
	});

	test('routes detect-changes through to its runCli with args', () => {
		const f = tmpFile('files.txt', 'src/a.js\nsrc/b.scss\n');
		try {
			const code = cli.main([
				'detect-changes',
				'--files',
				f,
				'--output',
				'json',
			]);
			expect(code).toBe(0);
			const parsed = JSON.parse(stdoutChunks.join(''));
			expect(parsed['total-count']).toBe(2);
			expect(parsed['js-count']).toBe(1);
			expect(parsed['css-count']).toBe(1);
		} finally {
			fs.unlinkSync(f);
		}
	});

	test('detect-changes propagates a usage-error exit code', () => {
		const code = cli.main(['detect-changes', '--output', 'xml']);
		expect(code).toBe(2);
		expect(stderrChunks.join('')).toMatch(/invalid --output/);
	});
});

describe('cli COMMANDS registry', () => {
	test('detect-changes is registered with a summary and run handler', () => {
		expect(cli.COMMANDS['detect-changes']).toBeDefined();
		expect(typeof cli.COMMANDS['detect-changes'].summary).toBe('string');
		expect(typeof cli.COMMANDS['detect-changes'].run).toBe('function');
	});
});
