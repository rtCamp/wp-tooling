/**
 * Tests for src/scaffolds/add.js (library + CLI).
 *
 * Argument parsing and the non-interactive code path. The interactive
 * path is tested separately because it loads the TTY UI; here we only
 * verify the engine-driven non-interactive surface and JSON output.
 */

'use strict';

const fs = require('fs/promises');
const fssync = require('fs');
const os = require('os');
const path = require('path');

const add = require('../../src/scaffolds/add');
const { ScaffoldError } = require('../../src/scaffolds/errors');

function makeTmpDir() {
	return fssync.mkdtempSync(path.join(os.tmpdir(), 'wp-tooling-add-'));
}

// Build a minimal project layout: cwd/bin/scaffolds/test/echo/{scaffold.json,templates/...}.
async function buildProjectWithScaffold(cwd) {
	const scaffoldDir = path.join(cwd, 'bin', 'scaffolds', 'test', 'echo');
	await fs.mkdir(path.join(scaffoldDir, 'templates'), { recursive: true });
	await fs.writeFile(
		path.join(scaffoldDir, 'scaffold.json'),
		JSON.stringify({
			slug: 'echo',
			category: 'test',
			name: 'Echo',
			description: 'Echoes a value into a file.',
			source: 'template',
			inputs: [
				{ key: 'value', description: 'Value to echo', required: true },
			],
			files: [{ src: 'templates/out.txt.mustache', dest: 'out.txt' }],
		}),
		'utf8'
	);
	await fs.writeFile(
		path.join(scaffoldDir, 'templates/out.txt.mustache'),
		'value={{value}}\n',
		'utf8'
	);
}

describe('add command argument parsing', () => {
	// Indirectly tested via the run() invocations below; this block focuses on edge cases
	// we cannot reach by run(), like `--help`.
	it('exits 0 on --help without doing work', async () => {
		const originalOut = process.stdout.write.bind(process.stdout);
		let captured = '';
		process.stdout.write = (chunk) => {
			captured += chunk;
			return true;
		};
		const code = await add.runCli(['--help']);
		process.stdout.write = originalOut;
		expect(code).toBe(0);
		expect(captured).toContain('Usage: wp-tooling add');
	});

	it('exits 1 when scaffold id is missing', async () => {
		const originalOut = process.stdout.write.bind(process.stdout);
		const originalErr = process.stderr.write.bind(process.stderr);
		process.stdout.write = () => true;
		process.stderr.write = () => true;
		const code = await add.runCli(['--non-interactive']);
		process.stdout.write = originalOut;
		process.stderr.write = originalErr;
		expect(code).toBe(1);
	});

	// The missing/flag-shaped-value contract is pinned in cli-support.test.js;
	// here we only confirm add wires it in (input flags + runCli handling).
	it('still accepts --flag=value for values starting with --', () => {
		const opts = add.parseArgs(['wp/cli', '--description=--weird']);
		expect(opts.inputs.description).toBe('--weird');
	});

	it('exits 1 (not interactive hang) on a parse error', async () => {
		const originalOut = process.stdout.write.bind(process.stdout);
		const originalErr = process.stderr.write.bind(process.stderr);
		let stderr = '';
		process.stdout.write = () => true;
		process.stderr.write = (chunk) => {
			stderr += chunk;
			return true;
		};
		const code = await add.runCli(['wp/cli', '--name', '--json']);
		process.stdout.write = originalOut;
		process.stderr.write = originalErr;
		expect(code).toBe(1);
		expect(stderr).toContain('Missing value for --name');
	});
});

describe('formatErrorPayload', () => {
	it('keeps EBADSCAFFOLD file + errors fields (documented payload)', () => {
		const err = new ScaffoldError('EBADSCAFFOLD', 'Invalid scaffold', {
			file: '/path/scaffold.json',
			errors: ['files[0].dest: must be a non-empty string'],
		});
		const payload = add.formatErrorPayload(err);
		expect(payload).toMatchObject({
			code: 'EBADSCAFFOLD',
			file: '/path/scaffold.json',
			errors: ['files[0].dest: must be a non-empty string'],
		});
	});
});

describe('add command non-interactive flow', () => {
	it('writes files in non-interactive mode', async () => {
		const cwd = makeTmpDir();
		await buildProjectWithScaffold(cwd);
		const originalOut = process.stdout.write.bind(process.stdout);
		process.stdout.write = () => true;
		const code = await add.runCli([
			'test/echo',
			'--non-interactive',
			'--cwd',
			cwd,
			'--value=hello',
		]);
		process.stdout.write = originalOut;
		expect(code).toBe(0);
		const wrote = await fs.readFile(path.join(cwd, 'out.txt'), 'utf8');
		expect(wrote).toBe('value=hello\n');
	});

	it('emits a single JSON line on --json', async () => {
		const cwd = makeTmpDir();
		await buildProjectWithScaffold(cwd);
		const originalWrite = process.stdout.write.bind(process.stdout);
		let captured = '';
		process.stdout.write = (chunk) => {
			captured += chunk;
			return true;
		};
		const code = await add.runCli([
			'test/echo',
			'--json',
			'--cwd',
			cwd,
			'--value=hi',
		]);
		process.stdout.write = originalWrite;
		expect(code).toBe(0);
		const lines = captured.trim().split('\n');
		expect(lines).toHaveLength(1);
		const result = JSON.parse(lines[0]);
		expect(result.scaffold.id).toBe('test/echo');
		expect(result.engine.wrote).toEqual(['out.txt']);
	});

	it('--dry-run does not write files', async () => {
		const cwd = makeTmpDir();
		await buildProjectWithScaffold(cwd);
		const originalOut = process.stdout.write.bind(process.stdout);
		process.stdout.write = () => true;
		const code = await add.runCli([
			'test/echo',
			'--non-interactive',
			'--dry-run',
			'--cwd',
			cwd,
			'--value=hi',
		]);
		process.stdout.write = originalOut;
		expect(code).toBe(0);
		await expect(fs.access(path.join(cwd, 'out.txt'))).rejects.toThrow();
	});

	it('emits structured error JSON on --json for missing input', async () => {
		const cwd = makeTmpDir();
		await buildProjectWithScaffold(cwd);
		const originalErr = process.stderr.write.bind(process.stderr);
		let captured = '';
		process.stderr.write = (chunk) => {
			captured += chunk;
			return true;
		};
		const code = await add.runCli(['test/echo', '--json', '--cwd', cwd]);
		process.stderr.write = originalErr;
		expect(code).toBe(1);
		const result = JSON.parse(captured.trim().split('\n').pop());
		expect(result.code).toBe('EMISSINGINPUT');
		expect(result.missing).toEqual(['value']);
	});

	it('emits ENOSCAFFOLD JSON for unknown id', async () => {
		const cwd = makeTmpDir();
		await buildProjectWithScaffold(cwd);
		const originalErr = process.stderr.write.bind(process.stderr);
		let captured = '';
		process.stderr.write = (chunk) => {
			captured += chunk;
			return true;
		};
		const code = await add.runCli(['no/such', '--json', '--cwd', cwd]);
		process.stderr.write = originalErr;
		expect(code).toBe(1);
		const result = JSON.parse(captured.trim().split('\n').pop());
		expect(result.code).toBe('ENOSCAFFOLD');
		expect(result.available).toContain('test/echo');
	});
});

describe('engine core is not coupled to TTY UI', () => {
	it('non-interactive code path does not require the TTY UI kit', async () => {
		// If `src/cli/commands/add.js` eagerly loaded TTY UI at top-level, this test would still
		// pass (the UI is in @rtcamp/wp-tooling on disk), but the eager-load is exactly what
		// we want to avoid. We at least assert that registry execute() works without it.
		const { ScaffoldRegistry } = require('../../src/scaffolds/registry');
		// Verify the engine module did not transitively load the TTY UI.
		expect(
			require.cache[require.resolve('../../src/scaffolds/registry')]
		).toBeDefined();
		// The UI module would be in require.cache if it had been loaded by registry.
		const uiPath = require.resolve('../../src/ui');
		const beforeKeys = Object.keys(require.cache).length;
		// Construct a registry from a real scaffold to exercise the engine path.
		const tmp = makeTmpDir();
		const sDir = path.join(tmp, 'a');
		await fs.mkdir(sDir, { recursive: true });
		await fs.writeFile(
			path.join(sDir, 'scaffold.json'),
			JSON.stringify({
				slug: 'a',
				name: 'A',
				description: 'A',
				source: 'package',
				files: [],
			}),
			'utf8'
		);
		const r = new ScaffoldRegistry({ projectDir: tmp });
		await r.scan();
		const dst = makeTmpDir();
		await r.execute('a', {}, { dryRun: true, cwd: dst });
		// If TTY UI was loaded somewhere in the engine, this assertion fails:
		expect(require.cache[uiPath]).toBeUndefined();
		expect(Object.keys(require.cache).length).toBeGreaterThanOrEqual(
			beforeKeys
		);
	});
});
