'use strict';

jest.mock('child_process');

const path = require('path');
const { execFileSync } = require('child_process');
const { runCli } = require('../../src/a11y/run');

const FIXTURE_CONFIG = path.join(__dirname, 'fixtures', '.pa11yci.json');

const REPORT = {
	total: 1,
	passes: 0,
	errors: 1,
	results: {
		'http://localhost:8888/': [
			{
				code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
				type: 'error',
				typeCode: 1,
				message: 'Img element missing an alt attribute.',
				context: '<img src="/hero.jpg">',
				selector: 'html > body > img',
				runner: 'htmlcs',
			},
		],
	},
};

const CLEAN_REPORT = {
	total: 0,
	passes: 1,
	errors: 0,
	results: { 'http://localhost:8888/': [] },
};

const FAILED_REPORT = {
	total: 1,
	passes: 0,
	errors: 0,
	results: {
		'http://localhost:8888/': [
			{
				message:
					'net::ERR_CONNECTION_REFUSED at http://localhost:8888/',
			},
		],
	},
};

/** Error text used by both the thrown Error and its `.stderr`, for the mocked "binary not found" probe. */
const VERSION_PROBE_NOT_FOUND_ERROR = 'command not found';

/** Version string the mocked `--version` probe returns when the binary is available. */
const MOCK_VERSION = '3.1.0\n';

/**
 * Drive the mocked pa11y-ci binary.
 *
 * @param {Object}  [o]
 * @param {boolean} [o.available=true] Whether the --version probe succeeds.
 * @param {*}       [o.report=REPORT]  Report returned by the run.
 * @param {boolean} [o.runThrows]      Whether the run throws (violations / failure).
 * @param {string}  [o.runStdout]      stdout attached to a thrown run error.
 * @param {string}  [o.runStderr]      stderr attached to a thrown run error.
 * @param {string}  [o.runReturn]      Raw stdout returned by a non-throwing run.
 */
function mockBin(o = {}) {
	const available = o.available !== false;
	execFileSync.mockImplementation((cmd, args) => {
		if (args.includes('--version')) {
			return versionProbeResult(available);
		}
		return runResult(o);
	});
}

/**
 * Result of the mocked `--version` probe.
 *
 * @param {boolean} available Whether the probe should succeed.
 * @return {string} The version output, when available.
 * @throws {Error} When `available` is false.
 */
function versionProbeResult(available) {
	if (!available) {
		const err = new Error(VERSION_PROBE_NOT_FOUND_ERROR);
		err.stderr = VERSION_PROBE_NOT_FOUND_ERROR;
		throw err;
	}
	return MOCK_VERSION;
}

/**
 * Result of the mocked pa11y-ci run (everything but the `--version` probe).
 *
 * @param {Object} o `mockBin`'s options — see its JSDoc.
 * @return {string} Raw stdout for a non-throwing run.
 * @throws {Error} When `o.runThrows` is set.
 */
function runResult(o) {
	if (o.runThrows) {
		const err = new Error('exited non-zero');
		err.status = 2;
		err.stdout = o.runStdout !== undefined ? o.runStdout : '';
		err.stderr = o.runStderr !== undefined ? o.runStderr : '';
		throw err;
	}
	if (o.runReturn !== undefined) {
		return o.runReturn;
	}
	return JSON.stringify(o.report !== undefined ? o.report : REPORT);
}

describe('a11y runCli', () => {
	let stdout;
	let stderr;
	let outSpy;
	let errSpy;

	beforeEach(() => {
		stdout = [];
		stderr = [];
		outSpy = jest.spyOn(process.stdout, 'write').mockImplementation((c) => {
			stdout.push(c.toString());
			return true;
		});
		errSpy = jest.spyOn(process.stderr, 'write').mockImplementation((c) => {
			stderr.push(c.toString());
			return true;
		});
	});

	afterEach(() => {
		outSpy.mockRestore();
		errSpy.mockRestore();
	});

	test('--help prints usage and exits 0', () => {
		expect(runCli(['--help'])).toBe(0);
		expect(stdout.join('')).toMatch(/Usage: a11y/);
	});

	test('unknown flag exits 2', () => {
		expect(runCli(['--bogus'])).toBe(2);
		expect(stderr.join('')).toMatch(/unknown argument/);
	});

	test('invalid --output exits 2', () => {
		expect(runCli(['--output', 'xml', '--config', FIXTURE_CONFIG])).toBe(2);
		expect(stderr.join('')).toMatch(/invalid --output/);
	});

	test('--config with no value exits 2', () => {
		expect(runCli(['--config'])).toBe(2);
		expect(stderr.join('')).toMatch(/Missing value for --config/);
	});

	test('an unreadable config exits 2 (ENOURLS)', () => {
		expect(
			runCli(['--config', path.join(__dirname, 'nope.pa11yci.json')])
		).toBe(2);
		expect(stderr.join('')).toMatch(/no URLs to scan/);
	});

	test('missing pa11y-ci exits 2 with the install hint', () => {
		mockBin({ available: false });
		expect(runCli(['--config', FIXTURE_CONFIG])).toBe(2);
		expect(stderr.join('')).toMatch(/pa11y-ci not found/);
		expect(stderr.join('')).toMatch(/wp-tooling add setup\/pa11y/);
	});

	test('the resolved config path is handed to pa11y-ci via --config', () => {
		let runArgs;
		execFileSync.mockImplementation((cmd, args) => {
			if (args.includes('--version')) {
				return MOCK_VERSION;
			}
			runArgs = [...args];
			return JSON.stringify(CLEAN_REPORT);
		});
		expect(runCli(['--config', FIXTURE_CONFIG])).toBe(0);
		// Leading args depend on how the binary resolved (direct vs npx);
		// the runner's own contribution is the tail.
		expect(runArgs.slice(-3)).toEqual([
			'--json',
			'--config',
			FIXTURE_CONFIG,
		]);
	});

	test('violations found: exits 3 with a parseable JSON report', () => {
		mockBin({ runThrows: true, runStdout: JSON.stringify(REPORT) });
		const code = runCli(['--config', FIXTURE_CONFIG, '--output', 'json']);
		expect(code).toBe(3);
		const parsed = JSON.parse(stdout.join(''));
		expect(parsed.summary.violations).toBe(1);
		expect(parsed.results[0].violations[0].wcagCriterion).toBe('1.1.1');
	});

	test('clean run exits 0', () => {
		mockBin({ report: CLEAN_REPORT });
		const code = runCli(['--config', FIXTURE_CONFIG, '--output', 'json']);
		expect(code).toBe(0);
		expect(JSON.parse(stdout.join('')).summary.violations).toBe(0);
	});

	test('text mode prints a human summary', () => {
		mockBin({ report: CLEAN_REPORT });
		expect(runCli(['--config', FIXTURE_CONFIG])).toBe(0);
		expect(stdout.join('')).toMatch(/pa11y-ci \(WCAG2AA\)/);
	});

	test('unparseable output exits 1 (EBADJSON)', () => {
		mockBin({ runReturn: 'not json at all' });
		expect(runCli(['--config', FIXTURE_CONFIG])).toBe(1);
		expect(stderr.join('')).toMatch(/could not be parsed/);
	});

	test('a genuine run failure exits 1 (EBINFAIL)', () => {
		mockBin({
			runThrows: true,
			runStdout: '',
			runStderr: 'Chrome crashed',
		});
		expect(runCli(['--config', FIXTURE_CONFIG])).toBe(1);
		expect(stderr.join('')).toMatch(/failed to run/);
	});

	test('an unreachable URL is a run failure (exit 1), not a violation', () => {
		mockBin({ report: FAILED_REPORT });
		const code = runCli(['--config', FIXTURE_CONFIG, '--output', 'json']);
		expect(code).toBe(1);
		const parsed = JSON.parse(stdout.join(''));
		expect(parsed.summary.failedUrls).toBe(1);
		expect(parsed.summary.violations).toBe(0);
		expect(stderr.join('')).toMatch(/failed to load/);
	});

	test('a scan failure is reported in text mode', () => {
		mockBin({ report: FAILED_REPORT });
		expect(runCli(['--config', FIXTURE_CONFIG])).toBe(1);
		const out = stdout.join('');
		expect(out).toMatch(/scan failed/);
		expect(out).toMatch(/1 failed to load/);
	});

	test('--dry-run prints the plan and runs pa11y-ci not at all', () => {
		mockBin();
		const code = runCli(['--dry-run', '--config', FIXTURE_CONFIG]);
		expect(code).toBe(0);
		const out = stdout.join('');
		expect(out).toMatch(/\[dry-run\] a11y would run:/);
		expect(out).toMatch(/http:\/\/localhost:8888\//);
		expect(out).toContain(FIXTURE_CONFIG);
		expect(out).toMatch(/pa11y-ci/);
		// Only the --version probe ran; pa11y-ci itself was never invoked.
		expect(execFileSync.mock.calls).toHaveLength(1);
		expect(execFileSync.mock.calls[0][1]).toContain('--version');
	});
});
