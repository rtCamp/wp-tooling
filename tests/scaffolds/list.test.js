/**
 * Tests for src/scaffolds/list.js (library + CLI).
 *
 * Covers default human output, --json output shape, filters (--category, --origin),
 * and validation of the --origin enum.
 */

'use strict';

const fs = require('fs/promises');
const fssync = require('fs');
const os = require('os');
const path = require('path');

const list = require('../../src/scaffolds/list');

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
		const { code, stdout } = await withStdoutCapture(() =>
			list.runCli(['--help'])
		);
		expect(code).toBe(0);
		expect(stdout).toContain('Usage: wp-tooling list');
	});

	it('rejects --origin with invalid value', async () => {
		const originalErr = process.stderr.write.bind(process.stderr);
		let captured = '';
		process.stderr.write = (chunk) => {
			captured += chunk;
			return true;
		};
		const code = await list.runCli(['--origin=neither']);
		process.stderr.write = originalErr;
		expect(code).toBe(1);
		expect(captured).toMatch(/--origin must be/);
	});
});

describe('list command, human output (default catalogue only)', () => {
	it('lists all bundled scaffolds with categories', async () => {
		const cwd = makeTmpDir(); // empty project, only bundled defaults
		const { code, stdout } = await withStdoutCapture(() =>
			list.runCli(['--cwd', cwd])
		);
		expect(code).toBe(0);
		expect(stdout).toContain('Available scaffolds');
		expect(stdout).toContain('wp/cli');
		expect(stdout).toContain('wp/cpt');
		expect(stdout).toContain('wp/module');
		expect(stdout).toContain('ci/cd-wporg');
		expect(stdout).toContain('wp/block-dynamic');
	});

	it('groups scaffolds by category in the human output', async () => {
		const cwd = makeTmpDir();
		const { code, stdout } = await withStdoutCapture(() =>
			list.runCli(['--cwd', cwd, '--category=wp'])
		);
		expect(code).toBe(0);
		expect(stdout).toContain('wp/');
		expect(stdout).not.toContain('ci/');
	});
});

describe('list command, --json output', () => {
	it('emits a single JSON line on stdout', async () => {
		const cwd = makeTmpDir();
		const { code, stdout } = await withStdoutCapture(() =>
			list.runCli(['--cwd', cwd, '--json'])
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
			list.runCli(['--cwd', cwd, '--json', '--category=wp'])
		);
		expect(code).toBe(0);
		const parsed = JSON.parse(stdout.trim());
		const cpt = parsed.scaffolds.find((s) => s.id === 'wp/cpt');
		expect(cpt).toBeDefined();
		expect(cpt).toMatchObject({
			id: 'wp/cpt',
			slug: 'cpt',
			category: 'wp',
			kind: 'template',
			origin: 'default',
		});
		expect(typeof cpt.name).toBe('string');
		expect(typeof cpt.description).toBe('string');
		expect(cpt.counts).toMatchObject({
			inputs: expect.any(Number),
			wiring: expect.any(Number),
			tests: expect.any(Number),
			secrets: expect.any(Number),
		});
		expect(cpt.counts.inputs).toBeGreaterThanOrEqual(2);
		expect(cpt.counts.wiring).toBeGreaterThanOrEqual(1);
	});

	it('reports secrets for the WPORG workflow scaffold', async () => {
		const cwd = makeTmpDir();
		const { code, stdout } = await withStdoutCapture(() =>
			list.runCli(['--cwd', cwd, '--json', '--category=ci'])
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
			list.runCli(['--cwd', cwd, '--json'])
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
			list.runCli(['--cwd', cwd, '--json', '--origin=project'])
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
			list.runCli(['--cwd', cwd, '--json', '--category=block'])
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
			list.runCli(['--cwd', cwd, '--json', '--category=nonexistent'])
		);
		expect(code).toBe(0);
		const parsed = JSON.parse(stdout.trim());
		expect(parsed.scaffolds).toEqual([]);
	});
});
