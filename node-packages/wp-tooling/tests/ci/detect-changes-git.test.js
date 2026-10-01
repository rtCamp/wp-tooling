'use strict';

/**
 * detect-changes against real git repositories: how the diff base is resolved
 * in pull request and push mode, what a failed diff does with and without
 * --strict, and that a crafted file list cannot forge a step output.
 */

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
	detectChanges,
	runCli,
	formatGithubLine,
	DetectChangesError,
} = require('../../src/ci/detect-changes');

const GIT_ENV = {
	GIT_AUTHOR_NAME: 'Test',
	GIT_AUTHOR_EMAIL: 'test@example.com',
	GIT_COMMITTER_NAME: 'Test',
	GIT_COMMITTER_EMAIL: 'test@example.com',
	GIT_CONFIG_NOSYSTEM: '1',
};

const ENV_KEYS = ['GITHUB_BASE_REF', 'GITHUB_EVENT_PATH', 'GITHUB_OUTPUT'];

const tempDirs = [];
let savedEnv;
let savedCwd;
let stderrChunks;

function git(cwd, ...args) {
	return execFileSync('git', args, {
		cwd,
		encoding: 'utf8',
		env: { ...process.env, ...GIT_ENV },
		stdio: ['ignore', 'pipe', 'pipe'],
	}).trim();
}

function makeTmpDir(prefix) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

function commitFile(repo, file, body, message) {
	fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
	fs.writeFileSync(path.join(repo, file), body);
	git(repo, 'add', '--', file);
	git(repo, 'commit', '-q', '-m', message);
	return git(repo, 'rev-parse', 'HEAD');
}

/**
 * A working repo with an `origin` remote (a local bare repo) holding `main`,
 * and a `feature` branch checked out one commit ahead of it.
 */
function makePullRequestRepo() {
	const remote = makeTmpDir('dc-remote-');
	git(remote, 'init', '-q', '--bare', '-b', 'main');
	const repo = makeTmpDir('dc-repo-');
	git(repo, 'init', '-q', '-b', 'main');
	commitFile(repo, 'README.md', 'base\n', 'base');
	git(repo, 'remote', 'add', 'origin', remote);
	git(repo, 'push', '-q', 'origin', 'main');
	git(repo, 'checkout', '-q', '-b', 'feature');
	commitFile(repo, 'src/feature.js', 'module.exports = 1;\n', 'feature js');
	commitFile(repo, 'inc/Feature.php', '<?php\n', 'feature php');
	return repo;
}

/**
 * Parse $GITHUB_OUTPUT the way the runner does: `key=value` lines and
 * `key<<DELIM` blocks; a key set twice keeps the last value.
 *
 * @param {string} text File contents.
 * @return {Object<string, string>} Outputs.
 */
function parseGithubOutput(text) {
	const out = {};
	const lines = text.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const heredoc = /^([^=<]+)<<(.+)$/.exec(line);
		if (heredoc) {
			const [, key, delimiter] = heredoc;
			const body = [];
			i++;
			while (i < lines.length && lines[i] !== delimiter) {
				body.push(lines[i]);
				i++;
			}
			out[key] = body.join('\n');
			continue;
		}
		const eq = line.indexOf('=');
		if (eq > 0) {
			out[line.slice(0, eq)] = line.slice(eq + 1);
		}
	}
	return out;
}

beforeEach(() => {
	savedCwd = process.cwd();
	savedEnv = {};
	for (const key of ENV_KEYS) {
		savedEnv[key] = process.env[key];
		delete process.env[key];
	}
	stderrChunks = [];
	jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
		stderrChunks.push(String(chunk));
		return true;
	});
	jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => {
	process.chdir(savedCwd);
	for (const key of ENV_KEYS) {
		if (savedEnv[key] === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = savedEnv[key];
		}
	}
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe('detectChanges against a git repository', () => {
	test('pull request mode diffs HEAD against origin/<GITHUB_BASE_REF>', () => {
		const repo = makePullRequestRepo();
		process.chdir(repo);
		process.env.GITHUB_BASE_REF = 'main';

		const result = detectChanges({ includeFiles: true });

		expect(result['total-files']).toEqual([
			'inc/Feature.php',
			'src/feature.js',
		]);
		expect(result['php-count']).toBe(1);
		expect(result['js-count']).toBe(1);
	});

	test('push mode diffs against the event payload before SHA', () => {
		const repo = makeTmpDir('dc-push-');
		git(repo, 'init', '-q', '-b', 'main');
		const before = commitFile(repo, 'README.md', 'one\n', 'one');
		commitFile(repo, 'style.scss', 'a{}\n', 'two');
		commitFile(repo, 'plugin.php', '<?php\n', 'three');
		git(repo, 'remote', 'add', 'origin', repo);
		process.chdir(repo);
		const event = path.join(makeTmpDir('dc-event-'), 'event.json');
		fs.writeFileSync(event, JSON.stringify({ before }));
		process.env.GITHUB_EVENT_PATH = event;

		const result = detectChanges({ includeFiles: true });

		// Both commits pushed since `before` count, not just the last one.
		expect(result['total-files']).toEqual(['plugin.php', 'style.scss']);
	});

	test('a new-branch push (all-zero before SHA) falls back to HEAD~1', () => {
		const repo = makeTmpDir('dc-newbranch-');
		git(repo, 'init', '-q', '-b', 'main');
		commitFile(repo, 'README.md', 'one\n', 'one');
		commitFile(repo, 'a.js', '1;\n', 'two');
		commitFile(repo, 'b.php', '<?php\n', 'three');
		git(repo, 'remote', 'add', 'origin', repo);
		process.chdir(repo);
		const event = path.join(makeTmpDir('dc-event-'), 'event.json');
		fs.writeFileSync(event, JSON.stringify({ before: '0'.repeat(40) }));
		process.env.GITHUB_EVENT_PATH = event;

		const result = detectChanges({ includeFiles: true });

		expect(result['total-files']).toEqual(['b.php']);
	});

	test('an explicit base wins over the environment', () => {
		const repo = makePullRequestRepo();
		process.chdir(repo);
		process.env.GITHUB_BASE_REF = 'does-not-exist';
		const base = git(repo, 'rev-parse', 'HEAD~1');

		const result = detectChanges({ base, includeFiles: true });

		expect(result['total-files']).toEqual(['inc/Feature.php']);
	});

	test('a failed diff is soft by default: no changes plus a stderr note', () => {
		const repo = makePullRequestRepo();
		process.chdir(repo);

		const result = detectChanges({ base: 'no-such-ref' });

		expect(result['total-count']).toBe(0);
		expect(stderrChunks.join('')).toMatch(
			/git diff failed against "no-such-ref"[\s\S]*Treating as no changes/
		);
	});

	test('strict mode throws DetectChangesError instead', () => {
		const repo = makePullRequestRepo();
		process.chdir(repo);

		let thrown;
		try {
			detectChanges({ base: 'no-such-ref', strict: true });
		} catch (err) {
			thrown = err;
		}

		expect(thrown).toBeInstanceOf(DetectChangesError);
		expect(thrown.code).toBe('EDIFFFAIL');
		expect(thrown.base).toBe('no-such-ref');
		expect(thrown.message).toMatch(/git diff failed against "no-such-ref"/);
	});

	test('a pull request base that cannot be fetched fails strict mode', () => {
		const repo = makePullRequestRepo();
		process.chdir(repo);
		process.env.GITHUB_BASE_REF = 'gone';

		expect(() => detectChanges({ strict: true })).toThrow(
			DetectChangesError
		);
		expect(stderrChunks.join('')).toMatch(/git fetch origin gone failed/);
	});
});

describe('runCli --strict', () => {
	test('exits 1, writes no outputs and keeps the "git diff failed" wording', () => {
		const repo = makePullRequestRepo();
		process.chdir(repo);
		const outPath = path.join(makeTmpDir('dc-out-'), 'output');
		fs.writeFileSync(outPath, '');
		process.env.GITHUB_OUTPUT = outPath;

		const code = runCli([
			'--strict',
			'--base',
			'no-such-ref',
			'--output',
			'github',
		]);

		expect(code).toBe(1);
		expect(fs.readFileSync(outPath, 'utf8')).toBe('');
		// rtCamp/wp-shared-workflows greps for this phrase; keep it stable.
		expect(stderrChunks.join('')).toMatch(
			/git diff failed against "no-such-ref"[\s\S]*--strict/
		);
	});

	test('passes through normally when the diff works', () => {
		const repo = makePullRequestRepo();
		process.chdir(repo);
		process.env.GITHUB_BASE_REF = 'main';
		const outPath = path.join(makeTmpDir('dc-out-'), 'output');
		fs.writeFileSync(outPath, '');
		process.env.GITHUB_OUTPUT = outPath;

		expect(runCli(['--strict', '--output', 'github'])).toBe(0);
		expect(
			parseGithubOutput(fs.readFileSync(outPath, 'utf8'))
		).toMatchObject({
			'total-count': '2',
			'php-count': '1',
			'js-count': '1',
		});
	});
});

describe('GitHub output heredocs', () => {
	test('a crafted file list cannot close the heredoc and forge a count', () => {
		const list = path.join(makeTmpDir('dc-list-'), 'files.txt');
		// The old fixed delimiter, then a file whose name is a forged output.
		fs.writeFileSync(
			list,
			['inc/Plugin.php', 'EOF_WP_TOOLING', 'php-count=0', ''].join('\n')
		);
		const outPath = path.join(makeTmpDir('dc-out-'), 'output');
		fs.writeFileSync(outPath, '');
		process.env.GITHUB_OUTPUT = outPath;

		expect(
			runCli(['--files', list, '--include-files', '--output', 'github'])
		).toBe(0);
		const outputs = parseGithubOutput(fs.readFileSync(outPath, 'utf8'));

		expect(outputs['php-count']).toBe('1');
		expect(outputs['total-files'].split('\n')).toEqual([
			'inc/Plugin.php',
			'EOF_WP_TOOLING',
			'php-count=0',
		]);
	});

	test('every multi-line output gets its own random delimiter', () => {
		const first = formatGithubLine('a-files', ['x.php']);
		const second = formatGithubLine('a-files', ['x.php']);

		const delimiter = (block) =>
			/<<(ghadelim_[0-9a-f]{32})\n/.exec(block)[1];
		expect(delimiter(first)).not.toBe(delimiter(second));
	});

	test('draws a new delimiter when a value line equals the first one', () => {
		const clash = Buffer.alloc(16, 0xab);
		const fresh = Buffer.alloc(16, 0xcd);
		jest.spyOn(crypto, 'randomBytes')
			.mockImplementationOnce(() => clash)
			.mockImplementationOnce(() => fresh);
		const clashing = `ghadelim_${clash.toString('hex')}`;

		const block = formatGithubLine('x-files', [clashing, 'b.php']);

		expect(block).toBe(
			`x-files<<ghadelim_${fresh.toString('hex')}\n${clashing}\nb.php\nghadelim_${fresh.toString('hex')}`
		);
	});

	test('scalars and empty lists stay on one line', () => {
		expect(formatGithubLine('php-count', 3)).toBe('php-count=3');
		expect(formatGithubLine('php-files', [])).toBe('php-files=');
	});
});

test('@rtcamp/wp-tooling/ci exposes DetectChangesError', () => {
	const ci = require('../../src/ci');
	expect(ci.DetectChangesError).toBe(DetectChangesError);
	expect(new ci.DetectChangesError('x')).toBeInstanceOf(Error);
});
