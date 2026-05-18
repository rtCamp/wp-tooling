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

	test('no args prints top-level usage and exits 0', async () => {
		const code = await cli.main([]);
		expect(code).toBe(0);
		const out = stdoutChunks.join('');
		expect(out).toMatch(/Usage: wp-tooling/);
		expect(out).toMatch(/detect-changes/);
	});

	test('--help prints top-level usage', async () => {
		const code = await cli.main(['--help']);
		expect(code).toBe(0);
		expect(stdoutChunks.join('')).toMatch(/Usage: wp-tooling/);
	});

	test('-h prints top-level usage', async () => {
		const code = await cli.main(['-h']);
		expect(code).toBe(0);
		expect(stdoutChunks.join('')).toMatch(/Usage: wp-tooling/);
	});

	test('--version prints package version and exits 0', async () => {
		const code = await cli.main(['--version']);
		expect(code).toBe(0);
		expect(stdoutChunks.join('').trim()).toBe(PKG.version);
	});

	test('-v prints package version', async () => {
		const code = await cli.main(['-v']);
		expect(code).toBe(0);
		expect(stdoutChunks.join('').trim()).toBe(PKG.version);
	});

	test('unknown top-level flag exits 2 with stderr message', async () => {
		const code = await cli.main(['--bogus']);
		expect(code).toBe(2);
		expect(stderrChunks.join('')).toMatch(/unknown option "--bogus"/);
	});

	test('unknown subcommand exits 2 with stderr message', async () => {
		const code = await cli.main(['frobnicate']);
		expect(code).toBe(2);
		expect(stderrChunks.join('')).toMatch(/unknown command "frobnicate"/);
	});

	test('routes detect-changes --help to its runCli', async () => {
		const code = await cli.main(['detect-changes', '--help']);
		expect(code).toBe(0);
		expect(stdoutChunks.join('')).toMatch(/Usage: detect-changes/);
	});

	test('routes detect-changes through to its runCli with args', async () => {
		const f = tmpFile('files.txt', 'src/a.js\nsrc/b.scss\n');
		try {
			const code = await cli.main([
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

	test('detect-changes propagates a usage-error exit code', async () => {
		const code = await cli.main(['detect-changes', '--output', 'xml']);
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

describe('cli loadCommands()', () => {
	let tmpDir;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-tooling-cmds-'));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function writeCommand(filename, body) {
		fs.writeFileSync(path.join(tmpDir, filename), body);
	}

	test('discovers a valid command module and indexes it by name', () => {
		writeCommand(
			'demo.js',
			`'use strict';
module.exports = { name: 'demo', summary: 'Demo command', run: () => 0 };`
		);

		const registry = cli.loadCommands(tmpDir);

		expect(Object.keys(registry)).toEqual(['demo']);
		expect(registry.demo.summary).toBe('Demo command');
		expect(typeof registry.demo.run).toBe('function');
	});

	test('ignores non-.js files in the commands directory', () => {
		writeCommand(
			'ok.js',
			`'use strict';
module.exports = { name: 'ok', summary: '', run: () => 0 };`
		);
		writeCommand('README.md', '# notes — not a command');
		writeCommand('helper.txt', 'ignore me');

		const registry = cli.loadCommands(tmpDir);

		expect(Object.keys(registry)).toEqual(['ok']);
	});

	test('throws a clear error when a module is missing required fields', () => {
		writeCommand(
			'broken.js',
			`'use strict';
module.exports = { summary: 'no name or run' };`
		);

		expect(() => cli.loadCommands(tmpDir)).toThrow(
			/invalid command module "broken\.js"/
		);
	});

	test('throws when two modules register the same name', () => {
		writeCommand(
			'a.js',
			`'use strict';
module.exports = { name: 'dup', summary: 'first', run: () => 0 };`
		);
		writeCommand(
			'b.js',
			`'use strict';
module.exports = { name: 'dup', summary: 'second', run: () => 0 };`
		);

		expect(() => cli.loadCommands(tmpDir)).toThrow(
			/duplicate command "dup"/
		);
	});

	test('returns entries in deterministic (sorted) order', () => {
		writeCommand(
			'zeta.js',
			`'use strict';
module.exports = { name: 'zeta', summary: '', run: () => 0 };`
		);
		writeCommand(
			'alpha.js',
			`'use strict';
module.exports = { name: 'alpha', summary: '', run: () => 0 };`
		);
		writeCommand(
			'mu.js',
			`'use strict';
module.exports = { name: 'mu', summary: '', run: () => 0 };`
		);

		const registry = cli.loadCommands(tmpDir);

		expect(Object.keys(registry)).toEqual(['alpha', 'mu', 'zeta']);
	});
});
