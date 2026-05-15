'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
	installHooks,
	runCli,
	resolveHooksDir,
	injectVersionHeader,
	looksLikeHusky,
	TEMPLATES,
} = require('../../src/hooks/install');
const PKG = require('../../package.json');

/**
 * Create a fresh tmp dir, `git init` it, and return the absolute path.
 * The directory is registered for cleanup in `afterEach`.
 *
 * @param {Function} register Push the created dir onto the cleanup list.
 * @return {string} Absolute path to the new repository's working tree.
 */
function tmpRepo(register) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-'));
	execFileSync('git', ['init', '--quiet', dir], { stdio: 'ignore' });
	register(dir);
	return dir;
}

/**
 * Create a fresh tmp dir without `git init`. Registered for cleanup.
 *
 * @param {Function} register Push the created dir onto the cleanup list.
 * @return {string} Absolute path to the empty directory.
 */
function tmpDir(register) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-bare-'));
	register(dir);
	return dir;
}

describe('installHooks', () => {
	const created = [];
	const register = (p) => created.push(p);

	afterEach(() => {
		while (created.length) {
			const dir = created.pop();
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test('installs both hooks with the executable bit set', () => {
		const repo = tmpRepo(register);
		const results = installHooks(repo);

		expect(results.map((r) => r.name).sort()).toEqual(
			[...TEMPLATES].sort()
		);
		for (const r of results) {
			expect(r.status).toBe('installed');
			expect(fs.existsSync(r.dest)).toBe(true);
			// Throws if the file isn't executable for the current user.
			expect(() =>
				fs.accessSync(r.dest, fs.constants.X_OK)
			).not.toThrow();
		}
	});

	test('injects the version header right after the shebang', () => {
		const repo = tmpRepo(register);
		const [first] = installHooks(repo);
		const body = fs.readFileSync(first.dest, 'utf8');
		const lines = body.split('\n');
		expect(lines[0]).toBe('#!/usr/bin/env sh');
		expect(lines[1]).toBe(`# wp-tooling install-hooks v${PKG.version}`);
	});

	test('skips when a hook already exists, prints the right reason', () => {
		const repo = tmpRepo(register);
		const hooksDir = resolveHooksDir(repo);
		const dest = path.join(hooksDir, 'commit-msg');
		fs.writeFileSync(dest, '#!/bin/sh\n# already here\n', { mode: 0o755 });

		const results = installHooks(repo);
		const commitMsg = results.find((r) => r.name === 'commit-msg');
		expect(commitMsg.status).toBe('skipped');
		expect(commitMsg.reason).toBe('exists');
		// File contents must be untouched.
		expect(fs.readFileSync(dest, 'utf8')).toContain('# already here');
	});

	test('detects Husky-managed hooks and tags the skip reason', () => {
		const repo = tmpRepo(register);
		const hooksDir = resolveHooksDir(repo);
		const dest = path.join(hooksDir, 'pre-commit');
		fs.writeFileSync(
			dest,
			'#!/bin/sh\n. "$(dirname -- "$0")/_/husky.sh"\nnpm test\n',
			{ mode: 0o755 }
		);

		const results = installHooks(repo);
		const preCommit = results.find((r) => r.name === 'pre-commit');
		expect(preCommit.status).toBe('skipped');
		expect(preCommit.reason).toBe('husky');
	});

	test('--force overwrites existing hooks', () => {
		const repo = tmpRepo(register);
		const hooksDir = resolveHooksDir(repo);
		const dest = path.join(hooksDir, 'commit-msg');
		fs.writeFileSync(dest, '#!/bin/sh\n# stale\n');

		const results = installHooks(repo, { force: true });
		const commitMsg = results.find((r) => r.name === 'commit-msg');
		expect(commitMsg.status).toBe('installed');
		const body = fs.readFileSync(dest, 'utf8');
		expect(body).toContain('Conventional Commits validator');
		expect(body).not.toContain('# stale');
	});

	test('--dry-run plans without touching the filesystem', () => {
		const repo = tmpRepo(register);
		const hooksDir = resolveHooksDir(repo);
		// Clear the .sample stubs git init leaves behind so we can detect
		// any writes the installer would make.
		for (const name of TEMPLATES) {
			const dest = path.join(hooksDir, name);
			if (fs.existsSync(dest)) {
				fs.unlinkSync(dest);
			}
		}

		const results = installHooks(repo, { dryRun: true });
		for (const r of results) {
			expect(r.status).toBe('would-install');
			expect(fs.existsSync(r.dest)).toBe(false);
		}
	});

	test('throws a clear error outside a git repository', () => {
		const bare = tmpDir(register);
		expect(() => installHooks(bare)).toThrow(/not a git repository/i);
	});

	test('resolves the hooks dir when .git is a file (separate git dir)', () => {
		const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-sep-'));
		register(parent);
		const workTree = path.join(parent, 'work');
		const gitDir = path.join(parent, 'separate-git');
		execFileSync(
			'git',
			['init', '--quiet', '--separate-git-dir', gitDir, workTree],
			{ stdio: 'ignore' }
		);
		// Sanity: `.git` inside workTree should be a file pointer, not a dir.
		expect(fs.statSync(path.join(workTree, '.git')).isFile()).toBe(true);

		const results = installHooks(workTree);
		const resolvedGitDir = fs.realpathSync(gitDir);
		for (const r of results) {
			expect(r.status).toBe('installed');
			expect(fs.realpathSync(r.dest).startsWith(resolvedGitDir)).toBe(
				true
			);
			expect(fs.existsSync(r.dest)).toBe(true);
		}
	});
});

describe('injectVersionHeader', () => {
	test('inserts the header between the shebang and the body', () => {
		const out = injectVersionHeader(
			'#!/usr/bin/env sh\necho hi\n',
			'1.2.3'
		);
		expect(out).toBe(
			'#!/usr/bin/env sh\n# wp-tooling install-hooks v1.2.3\necho hi\n'
		);
	});

	test('returns the body unchanged when there is no newline', () => {
		expect(injectVersionHeader('no-newline', '1.0.0')).toBe('no-newline');
	});
});

describe('looksLikeHusky', () => {
	test('matches the `.husky/` directory marker', () => {
		expect(looksLikeHusky('. "$(dirname "$0")/_/.husky/_/h"')).toBe(true);
	});
	test('matches the husky.sh sourcing marker', () => {
		expect(looksLikeHusky('. "$(dirname -- "$0")/_/husky.sh"')).toBe(true);
	});
	test('returns false for arbitrary hook scripts', () => {
		expect(looksLikeHusky('#!/bin/sh\nnpm run lint\n')).toBe(false);
	});
});

describe('install-hooks runCli', () => {
	const created = [];
	const register = (p) => created.push(p);
	let cwdBackup;
	let stdoutChunks;
	let stderrChunks;
	let stdoutSpy;
	let stderrSpy;

	beforeEach(() => {
		cwdBackup = process.cwd();
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
		process.chdir(cwdBackup);
		stdoutSpy.mockRestore();
		stderrSpy.mockRestore();
		while (created.length) {
			const dir = created.pop();
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test('--help exits 0 and prints usage', () => {
		const code = runCli(['--help']);
		expect(code).toBe(0);
		expect(stdoutChunks.join('')).toMatch(/Usage: install-hooks/);
	});

	test('-h exits 0 and prints usage', () => {
		const code = runCli(['-h']);
		expect(code).toBe(0);
		expect(stdoutChunks.join('')).toMatch(/Usage: install-hooks/);
	});

	test('unknown flag exits 2 with a stderr message', () => {
		const code = runCli(['--bogus']);
		expect(code).toBe(2);
		expect(stderrChunks.join('')).toMatch(/unknown argument: --bogus/);
	});

	test('runs end-to-end inside a git repo, prints `installed` lines', () => {
		const repo = tmpRepo(register);
		process.chdir(repo);
		const code = runCli([]);
		expect(code).toBe(0);
		const out = stdoutChunks.join('');
		expect(out).toMatch(/installed\s+commit-msg/);
		expect(out).toMatch(/installed\s+pre-commit/);
	});

	test('--dry-run prints planned actions, writes nothing', () => {
		const repo = tmpRepo(register);
		const hooksDir = resolveHooksDir(repo);
		for (const name of TEMPLATES) {
			const dest = path.join(hooksDir, name);
			if (fs.existsSync(dest)) {
				fs.unlinkSync(dest);
			}
		}
		process.chdir(repo);

		const code = runCli(['--dry-run']);
		expect(code).toBe(0);
		expect(stdoutChunks.join('')).toMatch(/\[dry-run]\s+would install/);
		for (const name of TEMPLATES) {
			expect(fs.existsSync(path.join(hooksDir, name))).toBe(false);
		}
	});

	test('outside a git repo exits 1 with a clear stderr message', () => {
		const bare = tmpDir(register);
		process.chdir(bare);
		const code = runCli([]);
		expect(code).toBe(1);
		expect(stderrChunks.join('')).toMatch(/not a git repository/i);
	});

	test('skipped existing hook reports the Husky hint on stdout', () => {
		const repo = tmpRepo(register);
		const hooksDir = resolveHooksDir(repo);
		fs.writeFileSync(
			path.join(hooksDir, 'pre-commit'),
			'#!/bin/sh\n. "$(dirname -- "$0")/_/husky.sh"\n',
			{ mode: 0o755 }
		);
		process.chdir(repo);

		const code = runCli([]);
		expect(code).toBe(0);
		expect(stdoutChunks.join('')).toMatch(
			/skipped\s+pre-commit.*Husky-managed/
		);
	});
});
