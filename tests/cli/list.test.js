/**
 * Tests for bin/commands/list.js.
 *
 * Covers default human output, --json output shape, filters (--category, --origin),
 * and validation of the --origin enum.
 */

'use strict';

const fs = require('fs/promises');
const fssync = require('fs');
const os = require('os');
const path = require('path');

const list = require('../../bin/commands/list');

function makeTmpDir() {
	return fssync.mkdtempSync(path.join(os.tmpdir(), 'wp-tooling-list-'));
}

async function writeProjectScaffold(cwd, id, name) {
	const [category, slug] = id.split('/');
	const dir = path.join(cwd, 'bin', 'scaffolds', category, slug);
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(
		path.join(dir, 'scaffold.json'),
		JSON.stringify({
			slug,
			category,
			name,
			description: `${name} description.`,
			source: 'template',
			files: [],
		}),
		'utf8'
	);
}

async function withStdoutCapture(fn) {
	let captured = '';
	// eslint-disable-next-line @wordpress/no-unused-vars-before-return -- needed for finally{} restore.
	const original = process.stdout.write.bind(process.stdout);
	process.stdout.write = (chunk) => {
		captured += chunk;
		return true;
	};
	try {
		const code = await fn();
		return { code, stdout: captured };
	} finally {
		process.stdout.write = original;
	}
}

describe('list command help / parsing', () => {
	it('--help prints usage and exits 0', async () => {
		const originalLog = console.log;
		let captured = '';
		console.log = (s) => {
			captured += s;
		};
		const code = await list.run(['--help']);
		console.log = originalLog;
		expect(code).toBe(0);
		expect(captured).toContain('Usage: wp-tooling list');
	});

	it('rejects --origin with invalid value', async () => {
		const originalErr = console.error;
		let captured = '';
		console.error = (s) => {
			captured += s;
		};
		const code = await list.run(['--origin=neither']);
		console.error = originalErr;
		expect(code).toBe(1);
		expect(captured).toMatch(/--origin must be/);
	});
});

describe('list command, human output (default catalogue only)', () => {
	it('lists all bundled scaffolds with categories', async () => {
		const cwd = makeTmpDir(); // empty project, only bundled defaults
		const { code, stdout } = await withStdoutCapture(() =>
			list.run(['--cwd', cwd])
		);
		expect(code).toBe(0);
		expect(stdout).toContain('Available scaffolds');
		expect(stdout).toContain('wp/cli');
		expect(stdout).toContain('utility/cache');
		expect(stdout).toContain('ci/cd-wporg');
		expect(stdout).toContain('block/dynamic');
	});

	it('shows kind: package for source: package scaffolds', async () => {
		const cwd = makeTmpDir();
		const { code, stdout } = await withStdoutCapture(() =>
			list.run(['--cwd', cwd, '--category=utility'])
		);
		expect(code).toBe(0);
		expect(stdout).toContain('package');
	});
});

describe('list command, --json output', () => {
	it('emits a single JSON line on stdout', async () => {
		const cwd = makeTmpDir();
		const { code, stdout } = await withStdoutCapture(() =>
			list.run(['--cwd', cwd, '--json'])
		);
		expect(code).toBe(0);
		const lines = stdout.trim().split('\n');
		expect(lines).toHaveLength(1);
		const parsed = JSON.parse(lines[0]);
		expect(parsed.scaffolds).toBeInstanceOf(Array);
		expect(parsed.scaffolds.length).toBeGreaterThan(0);
	});

	it('JSON entries carry the expected shape and counts', async () => {
		const cwd = makeTmpDir();
		const { code, stdout } = await withStdoutCapture(() =>
			list.run(['--cwd', cwd, '--json', '--category=utility'])
		);
		expect(code).toBe(0);
		const parsed = JSON.parse(stdout.trim());
		const cache = parsed.scaffolds.find((s) => s.id === 'utility/cache');
		expect(cache).toBeDefined();
		expect(cache).toMatchObject({
			id: 'utility/cache',
			slug: 'cache',
			category: 'utility',
			kind: 'package',
			origin: 'default',
		});
		expect(typeof cache.name).toBe('string');
		expect(typeof cache.description).toBe('string');
		expect(cache.counts).toMatchObject({
			inputs: expect.any(Number),
			wiring: expect.any(Number),
			tests: expect.any(Number),
			secrets: expect.any(Number),
		});
		expect(cache.counts.inputs).toBeGreaterThanOrEqual(2);
		expect(cache.counts.wiring).toBeGreaterThanOrEqual(1);
	});

	it('reports secrets for the WPORG workflow scaffold', async () => {
		const cwd = makeTmpDir();
		const { code, stdout } = await withStdoutCapture(() =>
			list.run(['--cwd', cwd, '--json', '--category=ci'])
		);
		expect(code).toBe(0);
		const parsed = JSON.parse(stdout.trim());
		const wporg = parsed.scaffolds.find((s) => s.id === 'ci/cd-wporg');
		expect(wporg).toBeDefined();
		expect(wporg.counts.secrets).toBe(2);
	});
});

describe('list command, two-directory merge', () => {
	it('shows project-local scaffolds alongside defaults', async () => {
		const cwd = makeTmpDir();
		await writeProjectScaffold(cwd, 'custom/widget', 'Custom Widget');
		const { code, stdout } = await withStdoutCapture(() =>
			list.run(['--cwd', cwd, '--json'])
		);
		expect(code).toBe(0);
		const parsed = JSON.parse(stdout.trim());
		const projectIds = parsed.scaffolds
			.filter((s) => s.origin === 'project')
			.map((s) => s.id);
		expect(projectIds).toContain('custom/widget');
	});

	it('--origin=project shows ONLY project scaffolds', async () => {
		const cwd = makeTmpDir();
		await writeProjectScaffold(cwd, 'custom/widget', 'Custom Widget');
		const { code, stdout } = await withStdoutCapture(() =>
			list.run(['--cwd', cwd, '--json', '--origin=project'])
		);
		expect(code).toBe(0);
		const parsed = JSON.parse(stdout.trim());
		expect(parsed.scaffolds).toHaveLength(1);
		expect(parsed.scaffolds[0].id).toBe('custom/widget');
		expect(parsed.scaffolds[0].origin).toBe('project');
	});

	it('--category filter narrows the listing', async () => {
		const cwd = makeTmpDir();
		const { code, stdout } = await withStdoutCapture(() =>
			list.run(['--cwd', cwd, '--json', '--category=block'])
		);
		expect(code).toBe(0);
		const parsed = JSON.parse(stdout.trim());
		expect(parsed.scaffolds.every((s) => s.category === 'block')).toBe(
			true
		);
	});

	it('empty filter returns an empty scaffolds array (not an error)', async () => {
		const cwd = makeTmpDir();
		const { code, stdout } = await withStdoutCapture(() =>
			list.run(['--cwd', cwd, '--json', '--category=nonexistent'])
		);
		expect(code).toBe(0);
		const parsed = JSON.parse(stdout.trim());
		expect(parsed.scaffolds).toEqual([]);
	});
});
