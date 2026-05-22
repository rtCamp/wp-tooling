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

	test('installs both hooks with the executable bit set', async () => {
		const repo = tmpRepo(register);
		const results = await installHooks(repo);

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

	test('injects the version header right after the shebang', async () => {
		const repo = tmpRepo(register);
		const [first] = await installHooks(repo);
		const body = fs.readFileSync(first.dest, 'utf8');
		const lines = body.split('\n');
		expect(lines[0]).toBe('#!/usr/bin/env sh');
		expect(lines[1]).toBe(`# wp-tooling install-hooks v${PKG.version}`);
	});

	test('skips when a hook already exists, prints the right reason', async () => {
		const repo = tmpRepo(register);
		const hooksDir = resolveHooksDir(repo);
		const dest = path.join(hooksDir, 'commit-msg');
		fs.writeFileSync(dest, '#!/bin/sh\n# already here\n', { mode: 0o755 });

		const results = await installHooks(repo);
		const commitMsg = results.find((r) => r.name === 'commit-msg');
		expect(commitMsg.status).toBe('skipped');
		expect(commitMsg.reason).toBe('exists');
		// File contents must be untouched.
		expect(fs.readFileSync(dest, 'utf8')).toContain('# already here');
	});

	test('detects Husky-managed hooks and tags the skip reason', async () => {
		const repo = tmpRepo(register);
		const hooksDir = resolveHooksDir(repo);
		const dest = path.join(hooksDir, 'pre-commit');
		fs.writeFileSync(
			dest,
			'#!/bin/sh\n. "$(dirname -- "$0")/_/husky.sh"\nnpm test\n',
			{ mode: 0o755 }
		);

		const results = await installHooks(repo);
		const preCommit = results.find((r) => r.name === 'pre-commit');
		expect(preCommit.status).toBe('skipped');
		expect(preCommit.reason).toBe('husky');
	});

	test('--force overwrites existing hooks', async () => {
		const repo = tmpRepo(register);
		const hooksDir = resolveHooksDir(repo);
		const dest = path.join(hooksDir, 'commit-msg');
		fs.writeFileSync(dest, '#!/bin/sh\n# stale\n');

		const results = await installHooks(repo, { force: true });
		const commitMsg = results.find((r) => r.name === 'commit-msg');
		expect(commitMsg.status).toBe('installed');
		const body = fs.readFileSync(dest, 'utf8');
		expect(body).toContain('Conventional Commits validator');
		expect(body).not.toContain('# stale');
	});

	test('--dry-run plans without touching the filesystem', async () => {
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

		const results = await installHooks(repo, { dryRun: true });
		for (const r of results) {
			expect(r.status).toBe('would-install');
			expect(fs.existsSync(r.dest)).toBe(false);
		}
	});

	test('throws a clear error outside a git repository', async () => {
		const bare = tmpDir(register);
		await expect(installHooks(bare)).rejects.toThrow(
			/not a git repository/i
		);
	});

	test('resolves the hooks dir when .git is a file (separate git dir)', async () => {
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

		const results = await installHooks(workTree);
		const resolvedGitDir = fs.realpathSync(gitDir);
		for (const r of results) {
			expect(r.status).toBe('installed');
			expect(fs.realpathSync(r.dest).startsWith(resolvedGitDir)).toBe(
				true
			);
			expect(fs.existsSync(r.dest)).toBe(true);
		}
	});

	test('onConflict callback receives the conflict info per template', async () => {
		const repo = tmpRepo(register);
		const hooksDir = resolveHooksDir(repo);
		fs.writeFileSync(
			path.join(hooksDir, 'commit-msg'),
			'#!/bin/sh\n# existing\n',
			{ mode: 0o755 }
		);
		fs.writeFileSync(
			path.join(hooksDir, 'pre-commit'),
			'#!/bin/sh\n. "$(dirname -- "$0")/_/husky.sh"\n',
			{ mode: 0o755 }
		);

		const seen = [];
		await installHooks(repo, {
			onConflict: async (info) => {
				seen.push({ name: info.name, reason: info.reason });
				return false;
			},
		});

		expect(seen).toEqual([
			{ name: 'commit-msg', reason: 'exists' },
			{ name: 'pre-commit', reason: 'husky' },
		]);
	});

	test('onConflict returning true overwrites the existing hook', async () => {
		const repo = tmpRepo(register);
		const hooksDir = resolveHooksDir(repo);
		const dest = path.join(hooksDir, 'commit-msg');
		fs.writeFileSync(dest, '#!/bin/sh\n# stale\n');

		const results = await installHooks(repo, {
			onConflict: async () => true,
		});
		const commitMsg = results.find((r) => r.name === 'commit-msg');
		expect(commitMsg.status).toBe('installed');
		expect(fs.readFileSync(dest, 'utf8')).toContain(
			'Conventional Commits validator'
		);
	});

	test('--force bypasses the onConflict callback entirely', async () => {
		const repo = tmpRepo(register);
		const hooksDir = resolveHooksDir(repo);
		fs.writeFileSync(
			path.join(hooksDir, 'commit-msg'),
			'#!/bin/sh\n# stale\n'
		);

		let called = 0;
		const results = await installHooks(repo, {
			force: true,
			onConflict: async () => {
				called++;
				return false;
			},
		});

		expect(called).toBe(0);
		expect(results.every((r) => r.status === 'installed')).toBe(true);
	});

	test('--dry-run reports skips for conflicts without consulting onConflict', async () => {
		const repo = tmpRepo(register);
		const hooksDir = resolveHooksDir(repo);
		fs.writeFileSync(
			path.join(hooksDir, 'commit-msg'),
			'#!/bin/sh\n# stale\n'
		);

		let called = 0;
		const results = await installHooks(repo, {
			dryRun: true,
			onConflict: async () => {
				called++;
				return true;
			},
		});

		expect(called).toBe(0);
		const commitMsg = results.find((r) => r.name === 'commit-msg');
		expect(commitMsg.status).toBe('skipped');
		expect(commitMsg.reason).toBe('exists');
	});

	test('onBeforeWrite / onAfterWrite fire around each successful install', async () => {
		const repo = tmpRepo(register);
		const events = [];

		await installHooks(repo, {
			onBeforeWrite: ({ name }) => events.push(['before', name]),
			onAfterWrite: ({ name, error }) =>
				events.push(['after', name, error ? 'fail' : 'ok']),
		});

		expect(events).toEqual([
			['before', 'commit-msg'],
			['after', 'commit-msg', 'ok'],
			['before', 'pre-commit'],
			['after', 'pre-commit', 'ok'],
		]);
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
	let stdinIsTTYBackup;

	beforeEach(() => {
		cwdBackup = process.cwd();
		// Pin `process.stdin.isTTY` to false for the whole runCli suite.
		// Other test files (e.g. UI password / select tests) set it to true
		// inside a try/finally; if jest schedules them in the same worker our
		// "non-TTY skip" assertion would otherwise see a leaked TTY value and
		// hang on `confirm() -> readLine()`.
		stdinIsTTYBackup = Object.getOwnPropertyDescriptor(
			process.stdin,
			'isTTY'
		);
		Object.defineProperty(process.stdin, 'isTTY', {
			value: false,
			configurable: true,
		});
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
		if (stdinIsTTYBackup) {
			Object.defineProperty(process.stdin, 'isTTY', stdinIsTTYBackup);
		} else {
			delete process.stdin.isTTY;
		}
		stdoutSpy.mockRestore();
		stderrSpy.mockRestore();
		while (created.length) {
			const dir = created.pop();
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test('--help exits 0 and prints usage', async () => {
		const code = await runCli(['--help']);
		expect(code).toBe(0);
		expect(stdoutChunks.join('')).toMatch(/Usage: install-hooks/);
	});

	test('-h exits 0 and prints usage', async () => {
		const code = await runCli(['-h']);
		expect(code).toBe(0);
		expect(stdoutChunks.join('')).toMatch(/Usage: install-hooks/);
	});

	test('unknown flag exits 2 with a stderr message', async () => {
		const code = await runCli(['--bogus']);
		expect(code).toBe(2);
		expect(stderrChunks.join('')).toMatch(/unknown argument: --bogus/);
	});

	test('runs end-to-end inside a git repo, prints `installed` lines', async () => {
		const repo = tmpRepo(register);
		process.chdir(repo);
		const code = await runCli([]);
		expect(code).toBe(0);
		const out = stdoutChunks.join('');
		// Spinner prints `installing <name>` then `+ installed <name>` in
		// non-TTY mode -- both contain `installed <name>` substring matching.
		expect(out).toMatch(/installed\s+commit-msg/);
		expect(out).toMatch(/installed\s+pre-commit/);
	});

	test('--dry-run prints planned actions, writes nothing', async () => {
		const repo = tmpRepo(register);
		const hooksDir = resolveHooksDir(repo);
		for (const name of TEMPLATES) {
			const dest = path.join(hooksDir, name);
			if (fs.existsSync(dest)) {
				fs.unlinkSync(dest);
			}
		}
		process.chdir(repo);

		const code = await runCli(['--dry-run']);
		expect(code).toBe(0);
		expect(stdoutChunks.join('')).toMatch(/\[dry-run]\s+would install/);
		for (const name of TEMPLATES) {
			expect(fs.existsSync(path.join(hooksDir, name))).toBe(false);
		}
	});

	test('outside a git repo exits 1 with a clear stderr message', async () => {
		const bare = tmpDir(register);
		process.chdir(bare);
		const code = await runCli([]);
		expect(code).toBe(1);
		expect(stderrChunks.join('')).toMatch(/not a git repository/i);
	});

	test('non-TTY conflict skips without prompting (CI-safe)', async () => {
		const repo = tmpRepo(register);
		const hooksDir = resolveHooksDir(repo);
		fs.writeFileSync(
			path.join(hooksDir, 'pre-commit'),
			'#!/bin/sh\n. "$(dirname -- "$0")/_/husky.sh"\n',
			{ mode: 0o755 }
		);
		process.chdir(repo);

		// process.stdin.isTTY is undefined in jest -> non-TTY path -> skip
		// without prompting. The test confirms the CI fast-path is intact.
		const code = await runCli([]);
		expect(code).toBe(0);
		expect(stdoutChunks.join('')).toMatch(
			/skipped\s+pre-commit.*Husky-managed/
		);
	});
});
