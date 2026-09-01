'use strict';

jest.mock('child_process');
jest.mock('../../src/perf/resolve-module');
jest.mock('../../src/perf/collect-vitals');

const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const resolveModule = require('../../src/perf/resolve-module');
const collectVitalsModule = require('../../src/perf/collect-vitals');
const { runCli } = require('../../src/perf/run');

const FIXTURES = path.join(__dirname, 'fixtures');
const FIXTURE_CONFIG = path.join(FIXTURES, '.perfrc.json');
const PARTIAL_CONFIG = path.join(FIXTURES, 'partial.perfrc.json');
const MISSING_CONFIG = path.join(FIXTURES, 'does-not-exist.json');
const MALFORMED_CONFIG = path.join(FIXTURES, 'malformed.perfrc.json');

const GOOD_METRICS = {
	metrics: {
		LCP: { value: 1000, rating: 'good' },
		CLS: { value: 0.01, rating: 'good' },
		INP: null,
		FCP: { value: 500, rating: 'good' },
		TTFB: { value: 100, rating: 'good' },
	},
	attribution: { lcpElement: null, clsSources: [], inpTarget: null },
};

const GOOD_LHR = {
	categories: { performance: { score: 0.95 } },
	audits: {},
};

/**
 * Drive the mocked lighthouse + WP-CLI invocations for one test.
 *
 * @param {Object}  [o]
 * @param {boolean} [o.lighthouseAvailable=true] Whether the --version probe succeeds.
 * @param {*}       [o.lhr=GOOD_LHR]             Value returned by a real lighthouse run.
 * @param {boolean} [o.lighthouseRunThrows]      Whether the real lighthouse run throws.
 * @param {string}  [o.lighthouseRunReturn]      Raw stdout for a non-throwing lighthouse run.
 * @param {Object}  [o.serverResult]             `spawnSync` return value for the server layer.
 */
function mockChildProcess(o = {}) {
	const lighthouseAvailable = o.lighthouseAvailable !== false;
	execFileSync.mockImplementation((cmd, args) => {
		if (args.includes('--version')) {
			if (!lighthouseAvailable) {
				const err = new Error('command not found');
				err.stderr = 'command not found';
				throw err;
			}
			return '13.4.0\n';
		}
		if (o.lighthouseRunThrows) {
			const err = new Error('exited non-zero');
			err.stderr = 'Chrome crashed';
			throw err;
		}
		if (o.lighthouseRunReturn !== undefined) {
			return o.lighthouseRunReturn;
		}
		return JSON.stringify(o.lhr !== undefined ? o.lhr : GOOD_LHR);
	});
	spawnSync.mockReturnValue(
		o.serverResult !== undefined
			? o.serverResult
			: { stdout: '{}', stderr: '', status: 0 }
	);
}

describe('perf runCli', () => {
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

		resolveModule.requireModule.mockReturnValue({
			launch: jest.fn(),
			executablePath: jest.fn(() => '/chrome-for-testing'),
		});
		resolveModule.resolveModuleFile.mockReturnValue(
			path.join(FIXTURES, 'web-vitals.attribution.iife.js')
		);
		resolveModule.detectModule.mockReturnValue({
			available: true,
			version: '5.3.0',
			dir: '/project/node_modules/puppeteer',
			source: 'local',
		});

		collectVitalsModule.launchBrowser.mockResolvedValue({
			close: jest.fn(async () => {}),
		});
		collectVitalsModule.collectVitals.mockResolvedValue({
			...GOOD_METRICS,
		});

		mockChildProcess();
	});

	afterEach(() => {
		outSpy.mockRestore();
		errSpy.mockRestore();
	});

	test('--help prints usage and exits 0', async () => {
		expect(await runCli(['--help'])).toBe(0);
		expect(stdout.join('')).toMatch(/Usage: perf/);
	});

	test('unknown flag exits 2', async () => {
		expect(await runCli(['--bogus'])).toBe(2);
		expect(stderr.join('')).toMatch(/unknown argument/);
	});

	test('--url with no value exits 2', async () => {
		expect(await runCli(['--url'])).toBe(2);
		expect(stderr.join('')).toMatch(/missing value for --url/);
	});

	test('invalid --output exits 2', async () => {
		expect(
			await runCli(['--output', 'xml', '--config', FIXTURE_CONFIG])
		).toBe(2);
		expect(stderr.join('')).toMatch(/invalid --output/);
	});

	test('missing puppeteer exits 2 with the install hint', async () => {
		resolveModule.requireModule.mockReturnValue(null);
		expect(await runCli(['--config', FIXTURE_CONFIG])).toBe(2);
		expect(stderr.join('')).toMatch(/puppeteer not found/);
		expect(stderr.join('')).toMatch(/wp-tooling add setup\/perf/);
	});

	test('no config and no --url exits 2 (ENOURLS)', async () => {
		expect(await runCli(['--config', MISSING_CONFIG])).toBe(2);
		expect(stderr.join('')).toMatch(/no URLs to test/);
	});

	test('a malformed config exits 2 (EBADJSON), not 1', async () => {
		expect(await runCli(['--config', MALFORMED_CONFIG])).toBe(2);
		expect(stderr.join('')).toMatch(/invalid JSON/);
	});

	test('--url runs without any config file at all', async () => {
		const code = await runCli([
			'--config',
			MISSING_CONFIG,
			'--url',
			'http://localhost:8888/',
			'--output',
			'json',
		]);
		expect(code).toBe(0);
		const parsed = JSON.parse(stdout.join(''));
		expect(parsed.results[0].url).toBe('http://localhost:8888/');
		// Config-less: the server layer defaults to disabled.
		expect(parsed.results[0].server).toBeNull();
	});

	test('a clean run with both layers exits 0', async () => {
		mockChildProcess({
			lhr: GOOD_LHR,
			serverResult: {
				stdout: JSON.stringify({
					'WP_Query::get_posts': {
						ct: 3,
						wt: 41200,
						cpu: 38000,
						mu: 1048576,
						pmu: 1148576,
					},
				}),
				stderr: '[server-profile] path=/ resolved=home object_id=0',
				status: 0,
			},
		});
		const code = await runCli([
			'--config',
			FIXTURE_CONFIG,
			'--output',
			'json',
		]);
		expect(code).toBe(0);
		const parsed = JSON.parse(stdout.join(''));
		expect(parsed.summary.failedUrls).toBe(0);
		expect(parsed.summary.issues).toBe(0);
		expect(parsed.results[0].lighthouse.scores.performance).toBe(0.95);
		expect(parsed.results[0].server.top[0].fn).toBe('WP_Query::get_posts');
	});

	test('a poor metric exits 3', async () => {
		collectVitalsModule.collectVitals.mockResolvedValue({
			metrics: {
				...GOOD_METRICS.metrics,
				LCP: { value: 5000, rating: 'poor' },
			},
			attribution: GOOD_METRICS.attribution,
		});
		const code = await runCli([
			'--config',
			FIXTURE_CONFIG,
			'--output',
			'json',
		]);
		expect(code).toBe(3);
	});

	test('a page load failure is a run failure (exit 1), not an issue', async () => {
		collectVitalsModule.collectVitals.mockRejectedValue(
			new Error('net::ERR_CONNECTION_REFUSED')
		);
		const code = await runCli([
			'--config',
			FIXTURE_CONFIG,
			'--output',
			'json',
		]);
		expect(code).toBe(1);
		const parsed = JSON.parse(stdout.join(''));
		expect(parsed.summary.failedUrls).toBeGreaterThan(0);
		expect(stderr.join('')).toMatch(/failed to load/);

		// Lighthouse needs the same reachability as puppeteer, so it must be
		// skipped for a failed URL: only the initial --version probe ran, no
		// per-URL lighthouse invocation.
		const nonProbeCalls = execFileSync.mock.calls.filter(
			(call) => !call[1].includes('--version')
		);
		expect(nonProbeCalls).toHaveLength(0);
		// The server layer profiles via WP-CLI, not the browser, so it still
		// runs even though the frontend layer failed to load.
		expect(spawnSync).toHaveBeenCalled();
	});

	test('an empty web-vitals harvest is a run failure (exit 1), and lighthouse still runs for it', async () => {
		collectVitalsModule.collectVitals.mockResolvedValue({
			metrics: { LCP: null, CLS: null, INP: null, FCP: null, TTFB: null },
			attribution: { lcpElement: null, clsSources: [], inpTarget: null },
		});
		const code = await runCli([
			'--config',
			FIXTURE_CONFIG,
			'--output',
			'json',
		]);
		expect(code).toBe(1);
		const parsed = JSON.parse(stdout.join(''));
		expect(parsed.summary.passedUrls).toBe(0);
		expect(parsed.summary.failedUrls).toBeGreaterThan(0);
		expect(parsed.results[0].notes.join('')).toMatch(
			/web-vitals harvest returned no metrics/
		);

		// Unlike a scanError, the page loaded fine, so lighthouse still runs.
		const nonProbeCalls = execFileSync.mock.calls.filter(
			(call) => !call[1].includes('--version')
		);
		expect(nonProbeCalls.length).toBeGreaterThan(0);
	});

	test('--output text still renders the server section for a URL that failed to scan', async () => {
		mockChildProcess({
			serverResult: {
				stdout: JSON.stringify({
					'WP_Query::get_posts': {
						ct: 3,
						wt: 41200,
						cpu: 38000,
						mu: 1048576,
						pmu: 1148576,
					},
				}),
				stderr: '',
				status: 0,
			},
		});
		collectVitalsModule.collectVitals.mockRejectedValue(
			new Error('net::ERR_CONNECTION_REFUSED')
		);
		const code = await runCli([
			'--config',
			FIXTURE_CONFIG,
			'--output',
			'text',
		]);
		expect(code).toBe(1);
		const out = stdout.join('');
		expect(out).toMatch(/— scan failed/);
		expect(out).toMatch(/server top: WP_Query::get_posts/);
		expect(out).toMatch(/server note: profiled via/);
	});

	test('a lighthouse runtime failure degrades that layer without affecting the exit code', async () => {
		mockChildProcess({ lighthouseRunThrows: true });
		const code = await runCli([
			'--config',
			FIXTURE_CONFIG,
			'--output',
			'json',
		]);
		expect(code).toBe(0);
		const parsed = JSON.parse(stdout.join(''));
		expect(parsed.results[0].lighthouse).toBeNull();
		expect(parsed.results[0].notes.join('')).toMatch(/lighthouse: failed/);
		expect(stderr.join('')).toMatch(/lighthouse failed for/);
	});

	test('a server profile failure degrades that layer without affecting the exit code', async () => {
		mockChildProcess({
			serverResult: {
				stdout: 'PHP Fatal error: something exploded',
				stderr: '',
				status: 255,
			},
		});
		const code = await runCli([
			'--config',
			FIXTURE_CONFIG,
			'--output',
			'json',
		]);
		expect(code).toBe(0);
		const parsed = JSON.parse(stdout.join(''));
		expect(parsed.results[0].server.error).toMatch(/non-zero exit \(255\)/);
		expect(stderr.join('')).toMatch(/server profile failed for/);
	});

	test('lighthouse.enabled: false never probes lighthouse, and the disabled server layer never spawns', async () => {
		const code = await runCli([
			'--config',
			PARTIAL_CONFIG,
			'--output',
			'json',
		]);
		expect(code).toBe(0);
		expect(execFileSync).not.toHaveBeenCalled();
		expect(spawnSync).not.toHaveBeenCalled();
		const parsed = JSON.parse(stdout.join(''));
		expect(parsed.results[0].lighthouse).toBeNull();
		expect(parsed.results[0].server).toBeNull();
	});

	test('--dry-run resolves everything but runs nothing', async () => {
		const code = await runCli(['--dry-run', '--config', FIXTURE_CONFIG]);
		expect(code).toBe(0);
		const out = stdout.join('');
		expect(out).toMatch(/\[dry-run\] perf would run:/);
		expect(out).toMatch(/puppeteer:/);
		expect(out).toMatch(/lighthouse:.*not probed — dry run/);
		expect(out).toMatch(/server:/);

		// Dry-run must not probe lighthouse (or invoke anything else).
		// Filtered rather than asserting the raw total, so this doesn't
		// depend on perfect mock-call isolation from other test files
		// sharing the same auto-mocked child_process module.
		const versionProbes = execFileSync.mock.calls.filter((call) =>
			call[1].includes('--version')
		);
		expect(versionProbes).toHaveLength(0);
		expect(spawnSync).not.toHaveBeenCalled();
		expect(collectVitalsModule.launchBrowser).not.toHaveBeenCalled();
		expect(collectVitalsModule.collectVitals).not.toHaveBeenCalled();
	});
});
