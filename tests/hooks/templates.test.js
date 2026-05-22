'use strict';

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(
	__dirname,
	'..',
	'..',
	'src',
	'hooks',
	'templates'
);

/**
 * Extract the Conventional Commits regex literal from the commit-msg
 * template. Keeping a single source of truth means a stray edit to the
 * shell script's pattern is caught by this test.
 *
 * @return {RegExp} Compiled pattern equivalent to the shell `pattern=...` line.
 */
function extractCommitMsgPattern() {
	const body = fs.readFileSync(
		path.join(TEMPLATES_DIR, 'commit-msg'),
		'utf8'
	);
	const match = body.match(/^pattern='(.+)'$/m);
	if (!match) {
		throw new Error('could not find pattern= line in commit-msg template');
	}
	return new RegExp(match[1]);
}

describe('commit-msg template', () => {
	const pattern = extractCommitMsgPattern();

	test.each([
		'feat: add Logger',
		'fix: handle empty CHANGELOG',
		'docs: update README',
		'feat(utilities): add Logger',
		'fix(release): handle empty CHANGELOG',
		'feat(ui)!: breaking change to wizard',
		'chore(deps): bump eslint',
		'ci(detect-changes): cover edge case',
		'refactor(scaffolds): inline registry scan',
		'revert: feat(ui): add wizard',
		'revert(release): restore prior tag',
	])('accepts %p', (subject) => {
		expect(pattern.test(subject)).toBe(true);
	});

	test.each([
		'wip',
		'WIP: x',
		'feat:',
		'feat: ',
		'feat(): no scope chars allowed empty',
		'random commit message',
		'Feat: capitalised type',
		'feature: not in type list',
	])('rejects %p', (subject) => {
		expect(pattern.test(subject)).toBe(false);
	});

	test('shell bypasses cover merge / revert / fixup / squash', () => {
		const body = fs.readFileSync(
			path.join(TEMPLATES_DIR, 'commit-msg'),
			'utf8'
		);
		// All four bypass prefixes appear in the case statement.
		expect(body).toMatch(/"Merge "\*/);
		expect(body).toMatch(/"Revert "\*/);
		expect(body).toMatch(/"fixup! "\*/);
		expect(body).toMatch(/"squash! "\*/);
	});
});

describe('commit-msg template (end-to-end against /bin/sh)', () => {
	const commitMsg = path.join(TEMPLATES_DIR, 'commit-msg');

	function runHook(message) {
		const msgFile = path.join(
			require('os').tmpdir(),
			`commit-msg-${Date.now()}-${Math.random().toString(36).slice(2)}`
		);
		fs.writeFileSync(msgFile, `${message}\n`);
		try {
			const result = spawnSync('/bin/sh', [commitMsg, msgFile], {
				encoding: 'utf8',
			});
			return {
				status: result.status,
				stdout: result.stdout,
				stderr: result.stderr,
			};
		} finally {
			fs.unlinkSync(msgFile);
		}
	}

	test('exits 0 for a valid Conventional Commit subject', () => {
		expect(runHook('feat(hooks): add installer').status).toBe(0);
	});

	test('exits 1 for an invalid subject and prints guidance', () => {
		const r = runHook('wip');
		expect(r.status).toBe(1);
		expect(r.stdout).toMatch(/Conventional Commits/);
	});

	test('exits 0 for merge commits', () => {
		expect(runHook('Merge branch foo').status).toBe(0);
	});

	test('exits 0 for revert commits', () => {
		expect(runHook('Revert "feat: x"').status).toBe(0);
	});

	test('exits 0 for fixup! commits', () => {
		expect(runHook('fixup! feat: add thing').status).toBe(0);
	});
});

describe('pre-commit template', () => {
	const preCommit = path.join(TEMPLATES_DIR, 'pre-commit');

	test('no-ops when package.json is absent', () => {
		const cwd = fs.mkdtempSync(
			path.join(require('os').tmpdir(), 'precommit-')
		);
		try {
			const r = spawnSync('/bin/sh', [preCommit], {
				cwd,
				encoding: 'utf8',
			});
			expect(r.status).toBe(0);
		} finally {
			fs.rmSync(cwd, { recursive: true, force: true });
		}
	});

	test('no-ops when package.json has no lint:staged script', () => {
		const cwd = fs.mkdtempSync(
			path.join(require('os').tmpdir(), 'precommit-')
		);
		fs.writeFileSync(
			path.join(cwd, 'package.json'),
			JSON.stringify({ scripts: { test: 'jest' } })
		);
		try {
			const r = spawnSync('/bin/sh', [preCommit], {
				cwd,
				encoding: 'utf8',
			});
			expect(r.status).toBe(0);
		} finally {
			fs.rmSync(cwd, { recursive: true, force: true });
		}
	});

	test('does not false-positive when "lint:staged" appears only as a string', () => {
		const cwd = fs.mkdtempSync(
			path.join(require('os').tmpdir(), 'precommit-')
		);
		fs.writeFileSync(
			path.join(cwd, 'package.json'),
			JSON.stringify({
				description: 'see "lint:staged" docs for details',
				scripts: { test: 'jest' },
			})
		);
		try {
			const r = spawnSync('/bin/sh', [preCommit], {
				cwd,
				encoding: 'utf8',
			});
			expect(r.status).toBe(0);
		} finally {
			fs.rmSync(cwd, { recursive: true, force: true });
		}
	});

	test('runs the lint:staged script when defined', () => {
		const cwd = fs.mkdtempSync(
			path.join(require('os').tmpdir(), 'precommit-')
		);
		const marker = path.join(cwd, 'fired.txt');
		fs.writeFileSync(
			path.join(cwd, 'package.json'),
			JSON.stringify({
				scripts: {
					'lint:staged': `node -e "require('fs').writeFileSync('${marker.replace(/\\/g, '\\\\')}', 'ok')"`,
				},
			})
		);
		try {
			const r = spawnSync('/bin/sh', [preCommit], {
				cwd,
				encoding: 'utf8',
			});
			expect(r.status).toBe(0);
			expect(fs.existsSync(marker)).toBe(true);
		} finally {
			fs.rmSync(cwd, { recursive: true, force: true });
		}
	});

	test('propagates a non-zero exit from the lint:staged script', () => {
		const cwd = fs.mkdtempSync(
			path.join(require('os').tmpdir(), 'precommit-')
		);
		fs.writeFileSync(
			path.join(cwd, 'package.json'),
			JSON.stringify({
				scripts: { 'lint:staged': 'node -e "process.exit(3)"' },
			})
		);
		try {
			const r = spawnSync('/bin/sh', [preCommit], {
				cwd,
				encoding: 'utf8',
			});
			expect(r.status).not.toBe(0);
		} finally {
			fs.rmSync(cwd, { recursive: true, force: true });
		}
	});
});

/**
 * Optional: lint both templates with shellcheck. Skipped automatically when
 * the binary isn't on `PATH`, which is the common case on dev laptops. CI
 * is expected to install shellcheck and exercise this branch.
 */
describe('shellcheck (optional)', () => {
	let shellcheckAvailable = false;
	try {
		execFileSync('shellcheck', ['--version'], { stdio: 'ignore' });
		shellcheckAvailable = true;
	} catch (_err) {
		shellcheckAvailable = false;
	}

	const maybeTest = shellcheckAvailable ? test : test.skip;

	maybeTest('commit-msg passes shellcheck -s sh', () => {
		const r = spawnSync(
			'shellcheck',
			['-s', 'sh', path.join(TEMPLATES_DIR, 'commit-msg')],
			{ encoding: 'utf8' }
		);
		expect(r.status).toBe(0);
	});

	maybeTest('pre-commit passes shellcheck -s sh', () => {
		const r = spawnSync(
			'shellcheck',
			['-s', 'sh', path.join(TEMPLATES_DIR, 'pre-commit')],
			{ encoding: 'utf8' }
		);
		expect(r.status).toBe(0);
	});
});
