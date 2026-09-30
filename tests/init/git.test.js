/**
 * Tests for installGitHooks -- it installs the native hooks and wires the
 * `prepare` script, preserving any existing non-Husky prepare.
 */
'use strict';

jest.mock('child_process', () => {
	const actual = jest.requireActual('child_process');
	return { ...actual, execFileSync: jest.fn(actual.execFileSync) };
});
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { installGitHooks, initRepo, commitAll } = require('../../src/init/git');

const noopUi = {
	spinner: () => ({ start() {}, succeed() {}, fail() {} }),
	warn() {},
	success() {},
	info() {},
	error() {},
};

/**
 * Create a git-initialised tmp repo with the given package.json, returning its
 * path. Registered for cleanup.
 *
 * @param {Function} register Cleanup registrar.
 * @param {Object}   pkg      package.json contents to write.
 * @return {string} Repo path.
 */
function tmpRepo(register, pkg) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-git-'));
	execFileSync('git', ['init', '--quiet', dir], { stdio: 'ignore' });
	fs.writeFileSync(
		path.join(dir, 'package.json'),
		JSON.stringify(pkg, null, '\t')
	);
	register(dir);
	return dir;
}

const readPrepare = (dir) =>
	JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).scripts
		.prepare;

describe('installGitHooks', () => {
	const created = [];
	const register = (p) => created.push(p);

	afterEach(() => {
		while (created.length) {
			fs.rmSync(created.pop(), { recursive: true, force: true });
		}
	});

	it('installs both native hooks and uses no Husky', async () => {
		const dir = tmpRepo(register, { name: 'x', scripts: {} });

		const ok = await installGitHooks(dir, noopUi);

		expect(ok).toBe(true);
		expect(fs.existsSync(path.join(dir, '.git/hooks/commit-msg'))).toBe(
			true
		);
		expect(fs.existsSync(path.join(dir, '.git/hooks/pre-commit'))).toBe(
			true
		);
		expect(fs.existsSync(path.join(dir, '.husky'))).toBe(false);
	});

	it('preserves an existing non-Husky prepare by chaining', async () => {
		const dir = tmpRepo(register, {
			name: 'x',
			scripts: { prepare: 'npm run sync-ai' },
		});

		await installGitHooks(dir, noopUi);

		expect(readPrepare(dir)).toBe(
			'npm run sync-ai && wp-tooling install-hooks || true'
		);
	});

	it('replaces a Husky prepare and is idempotent', async () => {
		const dir = tmpRepo(register, {
			name: 'x',
			scripts: { prepare: 'husky' },
		});

		await installGitHooks(dir, noopUi);
		expect(readPrepare(dir)).toBe('wp-tooling install-hooks || true');

		// Second run must not double-append the hook command.
		await installGitHooks(dir, noopUi);
		expect(readPrepare(dir)).toBe('wp-tooling install-hooks || true');
	});

	it('skips cleanly when the directory is not a git repo', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-git-bare-'));
		register(dir);

		expect(await installGitHooks(dir, noopUi)).toBe(false);
	});
});

describe('Git operation failures', () => {
	let root;
	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'init-git-failure-'));
	});
	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
	});
	test.each([
		['init', (dir) => initRepo(dir, noopUi)],
		['commit', (dir) => commitAll(dir, 'Initial commit', noopUi)],
	])('%s propagates command failures', (_name, operation) => {
		execFileSync.mockImplementationOnce(() => {
			throw new Error('command failed');
		});
		expect(() => operation(root)).toThrow(/command failed/);
	});
	test('hook setup rejects when prepare cannot be written', async () => {
		execFileSync('git', ['init', '--quiet', root]);
		fs.writeFileSync(path.join(root, 'package.json'), '{broken');
		await expect(installGitHooks(root, noopUi)).rejects.toThrow(
			/Git hook installation failed/
		);
	});
});
