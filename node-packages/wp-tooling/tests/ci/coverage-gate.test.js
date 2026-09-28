'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
	computeGate,
	parseClover,
	parseLcov,
	parseDiffHunks,
	gitChangedLines,
	resolveGateBase,
	indexReportPaths,
	matchReportFile,
	inferFormat,
	formatRanges,
	formatSummary,
	runCli,
} = require('../../src/ci/coverage-gate');

const FIXTURES = path.join(__dirname, 'fixtures');
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

const GIT_ENV = {
	...process.env,
	GIT_AUTHOR_NAME: 'Test',
	GIT_AUTHOR_EMAIL: 'test@example.com',
	GIT_COMMITTER_NAME: 'Test',
	GIT_COMMITTER_EMAIL: 'test@example.com',
	// Ignore the contributor's system and global config (commit.gpgsign,
	// core.hooksPath, diff.renames, ...) so commits and diffs are reproducible.
	GIT_CONFIG_NOSYSTEM: '1',
	GIT_CONFIG_GLOBAL: os.devNull,
};

const TEMP_DIRS = [];

function tempDir(prefix) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	TEMP_DIRS.push(dir);
	return dir;
}

afterAll(() => {
	for (const dir of TEMP_DIRS) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

function sh(cwd, ...args) {
	return execFileSync('git', args, {
		cwd,
		env: GIT_ENV,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});
}

function write(root, rel, body) {
	const p = path.join(root, rel);
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, body);
}

/**
 * Temp repo: `main` holds the base tree, `feature` adds lines on top.
 * Returns the repo root and the base SHA.
 */
function makeRepo() {
	const root = tempDir('cov-gate-');
	sh(root, 'init', '-q', '-b', 'main');
	write(root, 'plugin/inc/Cache.php', '<?php\n// one\n// two\n// three\n');
	write(root, 'other/tool.php', '<?php\n// a\n');
	sh(root, 'add', '-A');
	sh(root, 'commit', '-q', '-m', 'base');
	const base = sh(root, 'rev-parse', 'HEAD').trim();
	sh(root, 'checkout', '-q', '-b', 'feature');
	write(
		root,
		'plugin/inc/Cache.php',
		'<?php\n// one\nif ( $x ) {\n\treturn 1;\n}\n// three\n'
	);
	write(root, 'plugin/inc/New.php', '<?php\necho 1;\n');
	write(root, 'other/tool.php', '<?php\n// a\n// b\n');
	sh(root, 'add', '-A');
	sh(root, 'commit', '-q', '-m', 'feature');
	return { root, base };
}

function captureOutput() {
	const out = [];
	const err = [];
	const o = jest
		.spyOn(process.stdout, 'write')
		.mockImplementation((s) => out.push(String(s)) || true);
	const e = jest
		.spyOn(process.stderr, 'write')
		.mockImplementation((s) => err.push(String(s)) || true);
	return {
		stdout: () => out.join(''),
		stderr: () => err.join(''),
		restore: () => {
			o.mockRestore();
			e.mockRestore();
		},
	};
}

test('@rtcamp/wp-tooling/ci exposes GateError and the unmeasured policies', () => {
	const ci = require('../../src/ci');
	expect(new ci.GateError('x')).toBeInstanceOf(Error);
	expect(ci.GateError).toBe(require('../../src/ci/coverage-gate').GateError);
	expect(ci.UNMEASURED_POLICIES).toEqual(['warn', 'fail', 'ignore']);
	expect(ci.DEFAULT_UNMEASURED_POLICY).toBe('warn');
});

describe('parseDiffHunks', () => {
	const changed = parseDiffHunks(fixture('diff-hunks.txt'));

	test('+c,d adds d lines, +c adds one, +c,0 (pure deletion) adds none', () => {
		expect([...changed.get('inc/Modules/Cache.php')]).toEqual([
			12, 13, 14, 23,
		]);
	});

	test('new file counts from line 1; deleted file is absent', () => {
		expect(changed.get('inc/New.php')).toEqual(new Set([1, 2]));
		expect(changed.has('inc/Deleted.php')).toBe(false);
	});

	test('rename keys by the new path', () => {
		expect(changed.get('inc/Renamed.php')).toEqual(new Set([4]));
		expect(changed.has('inc/Moved.php')).toBe(false);
	});

	test('C-quoted paths are unquoted, including octal and control escapes', () => {
		expect(changed.get('inc/Sp ace"q.php')).toEqual(new Set([1]));
		const quoted = parseDiffHunks(
			[
				'diff --git "a/caf\\303\\251.php" "b/caf\\303\\251.php"',
				'+++ "b/caf\\303\\251.php"',
				'@@ -1 +1 @@',
				'diff --git "a/a\\rb.php" "b/a\\rb.php"',
				'+++ "b/a\\rb.php"',
				'@@ -1 +1 @@',
			].join('\n')
		);
		expect([...quoted.keys()]).toEqual(['café.php', 'a\rb.php']);
	});

	test('an added line starting with "++ " is content, not a file header', () => {
		const diff = [
			'diff --git a/inc/A.php b/inc/A.php',
			'--- a/inc/A.php',
			'+++ b/inc/A.php',
			'@@ -1,0 +2,2 @@',
			'+++ counter',
			'+x',
			'@@ -9 +10 @@',
			'-a',
			'+b',
		].join('\n');
		const result = parseDiffHunks(diff);
		expect([...result.keys()]).toEqual(['inc/A.php']);
		expect(result.get('inc/A.php')).toEqual(new Set([2, 3, 10]));
	});

	test('a +++ header with no hunks (mode-only change) adds no file', () => {
		const diff = [
			'diff --git a/x.php b/x.php',
			'old mode 100644',
			'new mode 100755',
			'--- a/x.php',
			'+++ b/x.php',
		].join('\n');
		expect(parseDiffHunks(diff).size).toBe(0);
	});

	test('strips only the tab Git appends to a path with a space', () => {
		const diff = [
			'diff --git a/inc/Foo Bar.php b/inc/Foo Bar.php',
			'+++ b/inc/Foo Bar.php\t',
			'@@ -1 +1 @@',
			'diff --git a/inc/end  b/inc/end ',
			'+++ b/inc/end \t',
			'@@ -3 +3 @@',
		].join('\n');
		expect([...parseDiffHunks(diff).keys()]).toEqual([
			'inc/Foo Bar.php',
			'inc/end ',
		]);
	});

	test('an entry without a +++ header does not inherit the previous file', () => {
		const diff = [
			'diff --git a/inc/A.php b/inc/A.php',
			'+++ b/inc/A.php',
			'@@ -1 +1 @@',
			'diff --git a/logo.png b/logo.png',
			'Binary files a/logo.png and b/logo.png differ',
			'@@ -5 +5 @@',
		].join('\n');
		expect(parseDiffHunks(diff).get('inc/A.php')).toEqual(new Set([1]));
	});
});

describe('parseClover', () => {
	const report = parseClover(fixture('clover.xml'));
	const cache = '/var/www/html/wp-content/plugins/acme/inc/Modules/Cache.php';

	test('counts stmt and cond lines only, not method signatures', () => {
		expect([...report.get(cache).keys()]).toEqual([12, 13, 14, 22, 23]);
		expect(report.get(cache).has(10)).toBe(false);
	});

	test('keeps hit counts', () => {
		expect(report.get(cache).get(12)).toBe(1);
		expect(report.get(cache).get(22)).toBe(0);
	});

	test('decodes entities and handles attribute order and self-closing files', () => {
		const rd = '/var/www/html/wp-content/plugins/acme/inc/Modules/R&D.php';
		expect(report.get(rd).get(5)).toBe(3);
		expect(
			report.get('/var/www/html/wp-content/plugins/acme/inc/Empty.php')
				.size
		).toBe(0);
	});

	test('decodes numeric entities; one beyond Unicode stays as written', () => {
		const numeric = parseClover(
			'<file name="/x/&#x41;&#66;&#999999999;&#x110000;.php"><line num="1" type="stmt" count="2"/></file>'
		);
		expect([...numeric.keys()]).toEqual([
			'/x/AB&#999999999;&#x110000;.php',
		]);
	});
});

describe('parseLcov', () => {
	const report = parseLcov(fixture('lcov.info'));

	test('reads DA entries, including ones with a checksum', () => {
		const cart = report.get('/home/runner/work/acme/acme/src/js/cart.js');
		expect([...cart.entries()]).toEqual([
			[2, 1],
			[3, 1],
			[5, 0],
			[6, 0],
		]);
		expect(report.get('src/js/util.js').get(1)).toBe(4);
	});
});

describe('matchReportFile', () => {
	const match = (diffPath, paths, root) =>
		matchReportFile(diffPath, indexReportPaths(paths), root);

	test('matches container and relative paths by path-segment suffix', () => {
		const paths = ['/var/www/html/wp-content/plugins/acme/inc/Cache.php'];
		expect(match('inc/Cache.php', paths).match).toBe(paths[0]);
		expect(match('./inc/Cache.php', ['inc/Cache.php']).match).toBe(
			'inc/Cache.php'
		);
	});

	test('does not match a partial segment', () => {
		expect(match('inc/Cache.php', ['/x/myinc/Cache.php']).match).toBeNull();
	});

	test('ties break on the absolute path under root, else ambiguous', () => {
		const paths = ['/repo/inc/A.php', '/repo/vendor/x/inc/A.php'];
		expect(match('inc/A.php', paths, '/repo').match).toBe(
			'/repo/inc/A.php'
		);
		const tied = match('inc/A.php', paths, '/elsewhere');
		expect(tied.match).toBeNull();
		expect(tied.ambiguous).toEqual(paths);
	});
});

describe('computeGate', () => {
	function reportWith(file, executable, coveredCount) {
		const lines = new Map();
		for (let n = 1; n <= executable; n++) {
			lines.set(n, n <= coveredCount ? 1 : 0);
		}
		return new Map([[file, lines]]);
	}
	const changedAll = (file, count) =>
		new Map([
			[file, new Set(Array.from({ length: count }, (_, i) => i + 1))],
		]);

	test('8 of 10 at threshold 80 passes (at threshold is not below)', () => {
		const r = computeGate({
			changed: changedAll('inc/A.php', 10),
			report: reportWith('/abs/inc/A.php', 10, 8),
			threshold: 80,
		});
		expect(r).toMatchObject({
			changedLines: 10,
			coveredLines: 8,
			percent: 80,
			passed: true,
		});
	});

	test('7 of 10 at threshold 80 fails and lists missed lines', () => {
		const r = computeGate({
			changed: changedAll('inc/A.php', 10),
			report: reportWith('/abs/inc/A.php', 10, 7),
			threshold: 80,
		});
		expect(r.passed).toBe(false);
		expect(r.files[0].missed).toEqual([8, 9, 10]);
	});

	test('non-executable changed lines never enter the calculation', () => {
		const r = computeGate({
			changed: new Map([['inc/A.php', new Set([50, 51])]]),
			report: reportWith('/abs/inc/A.php', 10, 0),
			threshold: 80,
		});
		expect(r).toMatchObject({
			changedLines: 0,
			percent: null,
			passed: true,
		});
		expect(r.files[0]).toMatchObject({ executable: 0, missed: [] });
	});

	test('a fractional threshold passes exactly at it, and the percent is exact', () => {
		const at = computeGate({
			changed: changedAll('inc/A.php', 1500),
			report: reportWith('/abs/inc/A.php', 1500, 147),
			threshold: 9.8,
		});
		expect(at).toMatchObject({ percent: 9.8, passed: true });
		const round = computeGate({
			changed: changedAll('inc/A.php', 100),
			report: reportWith('/abs/inc/A.php', 100, 57),
			threshold: 57,
		});
		expect(round).toMatchObject({ percent: 57, passed: true });
	});

	test('non-source and excluded files are out of scope, never measured', () => {
		const r = computeGate({
			changed: new Map([
				['README.md', new Set([1])],
				['tests/php/CacheTest.php', new Set([1])],
				['src/cart.test.js', new Set([1])],
				['inc/A.php', new Set([1])],
			]),
			report: reportWith('/abs/inc/A.php', 1, 1),
			threshold: 80,
			format: 'clover',
		});
		expect(r.outOfScope).toEqual([
			'README.md',
			'src/cart.test.js',
			'tests/php/CacheTest.php',
		]);
		expect(r.files.map((entry) => entry.path)).toEqual(['inc/A.php']);
		expect(r.unmeasured).toEqual([]);
	});

	test.each([
		['default (warn)', undefined, true],
		['ignore', 'ignore', true],
		['fail', 'fail', false],
	])(
		'unmeasured file is listed, not counted; policy %s',
		(_label, unmeasuredPolicy, passed) => {
			const r = computeGate({
				changed: new Map([
					['inc/A.php', new Set([1])],
					['inc/New.php', new Set([1, 2])],
				]),
				report: reportWith('/abs/inc/A.php', 1, 1),
				threshold: 80,
				format: 'clover',
				unmeasuredPolicy,
			});
			expect(r).toMatchObject({
				unmeasured: ['inc/New.php'],
				changedLines: 1,
				passed,
			});
		}
	);

	test('fail policy also fails a PR that only adds unmeasured files', () => {
		const r = computeGate({
			changed: new Map([['inc/New.php', new Set([1, 2])]]),
			report: reportWith('/abs/inc/A.php', 1, 1),
			threshold: 80,
			format: 'clover',
			unmeasuredPolicy: 'fail',
		});
		expect(r).toMatchObject({ changedLines: 0, passed: false });
	});
});

describe('helpers', () => {
	test('formatRanges collapses runs', () => {
		expect(formatRanges([3, 4, 5, 9, 11, 12])).toBe('3-5, 9, 11-12');
		expect(formatRanges([])).toBe('');
	});

	test('inferFormat', () => {
		expect(inferFormat('coverage/clover.xml')).toBe('clover');
		expect(inferFormat('coverage/lcov.info')).toBe('lcov');
		expect(inferFormat('coverage/report.json')).toBeNull();
	});

	test('resolveGateBase prefers --base, then event base SHA, then GITHUB_BASE_REF', () => {
		const eventPath = path.join(tempDir('cov-evt-'), 'event.json');
		fs.writeFileSync(
			eventPath,
			JSON.stringify({ pull_request: { base: { sha: 'abc1234def' } } })
		);
		expect(resolveGateBase({ base: 'x', env: {} })).toBe('x');
		expect(
			resolveGateBase({
				env: { GITHUB_EVENT_PATH: eventPath, GITHUB_BASE_REF: 'main' },
			})
		).toBe('abc1234def');
		expect(resolveGateBase({ env: { GITHUB_BASE_REF: 'main' } })).toBe(
			'origin/main'
		);
		expect(resolveGateBase({ env: {} })).toBeNull();
	});

	test('resolveGateBase falls through a corrupt or missing event payload', () => {
		const eventPath = path.join(tempDir('cov-evt-'), 'event.json');
		fs.writeFileSync(eventPath, '{ not json');
		expect(
			resolveGateBase({ env: { GITHUB_EVENT_PATH: eventPath } })
		).toBeNull();
		expect(
			resolveGateBase({
				env: {
					GITHUB_EVENT_PATH: `${eventPath}.missing`,
					GITHUB_BASE_REF: 'main',
				},
			})
		).toBe('origin/main');
	});

	test('formatSummary names files, missed lines and unmeasured files', () => {
		const md = formatSummary(
			{
				files: [
					{
						path: 'inc/A.php',
						executable: 4,
						covered: 2,
						missed: [7, 8],
					},
				],
				unmeasured: ['inc/New|Old.php', 'inc/Dup.php'],
				ambiguous: [{ path: 'inc/Dup.php', candidates: ['/a', '/b'] }],
				outOfScope: ['README.md'],
				changedLines: 4,
				coveredLines: 2,
				percent: 50,
				passed: false,
			},
			80
		);
		expect(md).toContain('| `inc/A.php` | 4 | 2 | 50% | 7-8 |');
		expect(md).toContain('#### Not measured');
		expect(md).toContain('- `inc/New|Old.php`\n');
		expect(md).toContain('- `inc/Dup.php` (several report entries match');
		expect(md).toContain('1 other changed file not checked');
		expect(md).toContain('2 changed files not in the coverage report');
		expect(md).toContain('failed');
	});
});

describe('gitChangedLines (real git)', () => {
	let repo;
	beforeAll(() => {
		repo = makeRepo();
	});

	test('returns added/modified lines from the merge base', () => {
		const changed = gitChangedLines({ base: repo.base, cwd: repo.root });
		expect(changed.get('plugin/inc/Cache.php')).toEqual(new Set([3, 4, 5]));
		expect(changed.get('plugin/inc/New.php')).toEqual(new Set([1, 2]));
		expect(changed.get('other/tool.php')).toEqual(new Set([3]));
	});

	test('--relative scopes to the working dir and strips its prefix', () => {
		const changed = gitChangedLines({
			base: repo.base,
			cwd: path.join(repo.root, 'plugin'),
		});
		expect([...changed.keys()].sort()).toEqual([
			'inc/Cache.php',
			'inc/New.php',
		]);
		expect(changed.has('other/tool.php')).toBe(false);
		expect(changed.has('../other/tool.php')).toBe(false);
	});

	test('a missing base commit is an error naming fetch-depth', () => {
		expect(() =>
			gitChangedLines({ base: 'deadbeef', cwd: repo.root })
		).toThrow(/^git rev-parse failed .*fetch-depth: 0/);
	});

	test('a pure rename adds no lines even with diff.renames=false', () => {
		const root = tempDir('cov-rename-');
		write(
			root,
			'inc/Old.php',
			Array.from({ length: 20 }, (_, i) => `$x${i};\n`).join('')
		);
		sh(root, 'init', '-q', '-b', 'main');
		sh(root, 'add', '-A');
		sh(root, 'commit', '-q', '-m', 'base');
		const base = sh(root, 'rev-parse', 'HEAD').trim();
		sh(root, 'mv', 'inc/Old.php', 'inc/Moved.php');
		sh(root, 'commit', '-q', '-m', 'move');
		sh(root, 'config', 'diff.renames', 'false');
		expect(gitChangedLines({ base, cwd: root }).size).toBe(0);
	});
});

describe('runCli', () => {
	let repo;
	let io;
	beforeAll(() => {
		repo = makeRepo();
	});
	beforeEach(() => {
		io = captureOutput();
	});
	afterEach(() => {
		io.restore();
	});

	const CACHE = '/var/www/html/wp-content/plugins/plugin/inc/Cache.php';

	function writeReport(covered, fileNames = [CACHE]) {
		const lines = [3, 4, 5]
			.map(
				(n) =>
					`<line num="${n}" type="stmt" count="${covered.includes(n) ? 1 : 0}"/>`
			)
			.join('');
		const files = fileNames
			.map((name) => `<file name="${name}">${lines}</file>`)
			.join('');
		write(
			repo.root,
			'plugin/coverage/clover.xml',
			`<coverage><project>${files}</project></coverage>`
		);
	}

	/** Temp `$GITHUB_OUTPUT` / `$GITHUB_STEP_SUMMARY`, passed through the env seam. */
	function githubEnv() {
		const dir = tempDir('cov-gh-');
		const env = {
			GITHUB_OUTPUT: path.join(dir, 'out'),
			GITHUB_STEP_SUMMARY: path.join(dir, 'summary'),
		};
		return {
			env,
			output: () => fs.readFileSync(env.GITHUB_OUTPUT, 'utf8'),
			summary: () => fs.readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8'),
		};
	}

	const baseArgs = () => [
		'--report',
		'coverage/clover.xml',
		'--working-dir',
		path.join(repo.root, 'plugin'),
		'--base',
		repo.base,
	];

	/** Lines the runner would treat as workflow commands. */
	const workflowCommands = () =>
		io
			.stdout()
			.split('\n')
			.filter((line) => line.startsWith('::'));

	test('passes when changed lines are covered, text mode', () => {
		writeReport([3, 4, 5]);
		expect(runCli([...baseArgs(), '--threshold', '80'], { env: {} })).toBe(
			0
		);
		expect(io.stdout()).toContain(
			'3 of 3 changed executable lines covered'
		);
		expect(io.stdout()).toContain(
			'1 changed file not in the coverage report'
		);
		expect(io.stdout()).toContain('inc/New.php');
	});

	test('text mode counts out-of-scope files like the summary does', () => {
		writeReport([3, 4, 5]);
		expect(
			runCli([...baseArgs(), '--exclude', 'New\\.php$'], { env: {} })
		).toBe(0);
		expect(io.stdout()).toContain(
			'1 other changed file not checked: not a source type this report covers, or excluded.'
		);
		expect(io.stdout()).not.toContain('not measured');
	});

	test('fails below threshold and names missed lines', () => {
		writeReport([3]);
		expect(runCli(baseArgs(), { env: {} })).toBe(1);
		expect(io.stdout()).toMatch(/inc\/Cache\.php {2}1\/3 {2}missed: 4-5/);
	});

	test('github mode writes outputs, summary and annotations through env', () => {
		writeReport([3]);
		const gh = githubEnv();
		expect(runCli([...baseArgs(), '--output', 'github'], gh)).toBe(1);
		expect(gh.output()).toBe(
			'changed-lines=3\ncovered-lines=1\npercent=33.33\nunmeasured-files=1\npassed=false\n'
		);
		expect(gh.summary()).toContain(
			'| `inc/Cache.php` | 3 | 1 | 33.33% | 4-5 |'
		);
		expect(io.stdout()).toContain(
			'::warning file=plugin/inc/New.php::Changed file is missing'
		);
		expect(io.stdout()).toContain(
			'::warning file=plugin/inc/Cache.php,line=4::'
		);
		expect(io.stdout()).toContain('::error::');
	});

	test('--soft-fail exits 0 and annotates the failure as a warning', () => {
		writeReport([]);
		expect(
			runCli(
				[...baseArgs(), '--output', 'github', '--soft-fail'],
				githubEnv()
			)
		).toBe(0);
		expect(io.stdout()).not.toContain('::error');
		expect(io.stdout()).toMatch(/::warning::0 of 3 .* failed\./);
	});

	test('--unmeasured fail fails a fully covered PR that has an unmeasured file', () => {
		writeReport([3, 4, 5]);
		const gh = githubEnv();
		expect(
			runCli(
				[...baseArgs(), '--output', 'github', '--unmeasured', 'fail'],
				gh
			)
		).toBe(1);
		expect(io.stdout()).toContain('::error file=plugin/inc/New.php::');
		expect(gh.output()).toContain('passed=false');
	});

	test('--unmeasured ignore lists the file without annotating it', () => {
		writeReport([3, 4, 5]);
		const gh = githubEnv();
		expect(
			runCli(
				[...baseArgs(), '--output', 'github', '--unmeasured', 'ignore'],
				gh
			)
		).toBe(0);
		expect(io.stdout()).not.toContain('file=plugin/inc/New.php');
		expect(gh.summary()).toContain('- `inc/New.php`');
	});

	test('an ambiguous report match is annotated as such', () => {
		writeReport([3, 4, 5], [`/a${CACHE}`, `/b${CACHE}`]);
		expect(runCli([...baseArgs(), '--output', 'github'], githubEnv())).toBe(
			0
		);
		expect(io.stdout()).toContain(
			'::warning file=plugin/inc/Cache.php::Several coverage report entries match'
		);
	});

	test('--dry-run previews files and annotations without emitting workflow commands', () => {
		writeReport([3]);
		expect(
			runCli([...baseArgs(), '--output', 'github', '--dry-run'], {
				env: {},
			})
		).toBe(1);
		expect(io.stdout()).toContain(
			'[dry-run] would append to $GITHUB_OUTPUT'
		);
		expect(io.stdout()).toContain('[dry-run] would emit: ::error::');
		expect(workflowCommands()).toEqual([]);
	});

	test('github mode warns when $GITHUB_OUTPUT is unset', () => {
		writeReport([3, 4, 5]);
		expect(runCli([...baseArgs(), '--output', 'github'], { env: {} })).toBe(
			0
		);
		expect(io.stderr()).toContain('$GITHUB_OUTPUT is unset');
	});

	test('empty flag values count as not given', () => {
		writeReport([3, 4, 5]);
		expect(
			runCli(
				[
					...baseArgs(),
					'--threshold',
					'',
					'--format',
					'',
					'--output',
					'',
					'--exclude',
					'',
					'--unmeasured',
					'',
				],
				{ env: {} }
			)
		).toBe(0);
		expect(io.stdout()).toContain('threshold 80%');
	});

	test('no pull request base, github mode: notice (previewed under --dry-run), exit 0', () => {
		const args = [
			'--report',
			'coverage/clover.xml',
			'--working-dir',
			repo.root,
		];
		expect(runCli([...args, '--output', 'github'], githubEnv())).toBe(0);
		expect(io.stdout()).toContain('::notice::No pull request base');
		expect(
			runCli([...args, '--output', 'github', '--dry-run'], { env: {} })
		).toBe(0);
		expect(io.stdout()).toContain(
			'[dry-run] would emit: ::notice::No pull request base'
		);
	});

	test('no pull request base, text mode: message and exit 0', () => {
		expect(runCli(['--report', 'coverage/clover.xml'], { env: {} })).toBe(
			0
		);
		expect(io.stdout()).toContain('coverage gate skipped');
	});

	test('missing report exits 2', () => {
		expect(
			runCli(
				[
					'--report',
					'nope.xml',
					'--working-dir',
					repo.root,
					'--base',
					repo.base,
				],
				{ env: {} }
			)
		).toBe(2);
		expect(io.stderr()).toContain('cannot read coverage report');
	});

	test('missing report under github --soft-fail: warning annotation, exit 0', () => {
		expect(
			runCli(
				[
					'--report',
					'nope.xml',
					'--working-dir',
					repo.root,
					'--base',
					repo.base,
					'--output',
					'github',
					'--soft-fail',
				],
				githubEnv()
			)
		).toBe(0);
		expect(io.stdout()).toContain(
			'::warning::coverage-gate: cannot read coverage report'
		);
	});

	test('report with no files exits 2 and hints at the driver', () => {
		write(repo.root, 'empty.xml', '<coverage><project/></coverage>');
		expect(
			runCli(
				[
					'--report',
					'empty.xml',
					'--working-dir',
					repo.root,
					'--base',
					repo.base,
				],
				{ env: {} }
			)
		).toBe(2);
		expect(io.stderr()).toContain('--xdebug=coverage');
	});

	test.each([
		[[], '--report <path> is required'],
		[['--report', 'x.json'], 'cannot infer the format'],
		[['--report', 'x.xml', '--format', 'cobertura'], 'invalid --format'],
		[['--report', 'x.xml', '--output', 'json'], 'invalid --output'],
		[
			['--report', 'x.xml', '--unmeasured', 'maybe'],
			'invalid --unmeasured',
		],
		[['--report', 'x.xml', '--exclude', '('], 'invalid --exclude regex'],
		[['--report', 'x.xml', '--threshold', '101'], 'invalid --threshold'],
		[['--report', 'x.xml', '--threshold', '0x10'], 'invalid --threshold'],
		[['--report', 'x.xml', '--threshold', '1e1'], 'invalid --threshold'],
		[['--report', 'x.xml', '--threshold', '66.666'], 'invalid --threshold'],
		[
			['--report', 'x.xml', '--threshold', '-5'],
			'missing value for --threshold',
		],
		[
			['--report', 'x.xml', '--exclude', '--threshold', '80'],
			'missing value for --exclude',
		],
		[['--bogus'], 'unknown argument'],
	])('usage error exits 2: %j', (argv, reason) => {
		expect(runCli(argv, { env: {} })).toBe(2);
		expect(io.stderr()).toContain(reason);
	});

	test('a fractional threshold is accepted', () => {
		writeReport([3, 4]);
		expect(
			runCli([...baseArgs(), '--threshold', '66.5'], { env: {} })
		).toBe(0);
	});

	test('--help exits 0 and documents the uncovered-files requirement', () => {
		expect(runCli(['--help'])).toBe(0);
		expect(io.stdout()).toContain('processUncoveredFiles');
		expect(io.stdout()).toContain('collectCoverageFrom');
		expect(io.stdout()).toContain('uncommitted work is ignored');
	});
});

describe('runCli with an LCOV report', () => {
	let root;
	let base;
	let io;
	beforeAll(() => {
		root = tempDir('cov-lcov-');
		sh(root, 'init', '-q', '-b', 'main');
		write(root, 'src/cart.js', 'module.exports = 1;\n');
		sh(root, 'add', '-A');
		sh(root, 'commit', '-q', '-m', 'base');
		base = sh(root, 'rev-parse', 'HEAD').trim();
		write(
			root,
			'src/cart.js',
			'function add(a) {\n\tif (!a) {\n\t\treturn 0;\n\t}\n\treturn a;\n}\nmodule.exports = add;\n'
		);
		write(root, 'src/cart.test.js', "test('x', () => {});\n");
		sh(root, 'add', '-A');
		sh(root, 'commit', '-q', '-m', 'feature');
		write(
			root,
			'coverage/lcov.info',
			`SF:${root}/src/cart.js\nDA:2,1\nDA:3,0\nDA:5,1\nDA:7,1\nend_of_record\n`
		);
	});
	beforeEach(() => {
		io = captureOutput();
	});
	afterEach(() => {
		io.restore();
	});

	const args = () => [
		'--report',
		'coverage/lcov.info',
		'--working-dir',
		root,
		'--base',
		base,
	];

	test('gates on LCOV like Clover, inferring the format', () => {
		expect(runCli(args(), { env: {} })).toBe(1);
		expect(io.stdout()).toMatch(/src\/cart\.js {2}3\/4 {2}missed: 3/);
		expect(io.stdout()).not.toContain('cart.test.js');
	});

	test('--no-exclude brings test files back into scope', () => {
		expect(runCli([...args(), '--no-exclude'], { env: {} })).toBe(1);
		expect(io.stdout()).toContain(
			'not measured (missing from the report):'
		);
		expect(io.stdout()).toContain('src/cart.test.js');
	});
});
