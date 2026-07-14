'use strict';

const fs = require('fs');
const path = require('path');

const {
	normalizePerf,
	rateMetric,
	extractLighthouse,
	normalizeServer,
	SERVER_FIDELITY_NOTE,
} = require('../../src/perf/normalize');

const LHR = JSON.parse(
	fs.readFileSync(
		path.join(__dirname, 'fixtures', 'lighthouse-lhr.json'),
		'utf8'
	)
);
const XHPROF = JSON.parse(
	fs.readFileSync(path.join(__dirname, 'fixtures', 'xhprof.json'), 'utf8')
);

describe('rateMetric', () => {
	test('rates LCP against its band', () => {
		expect(rateMetric('LCP', 2000)).toBe('good');
		expect(rateMetric('LCP', 3000)).toBe('needs-improvement');
		expect(rateMetric('LCP', 5000)).toBe('poor');
	});

	test('rates CLS against its (unitless) band', () => {
		expect(rateMetric('CLS', 0.05)).toBe('good');
		expect(rateMetric('CLS', 0.2)).toBe('needs-improvement');
		expect(rateMetric('CLS', 0.4)).toBe('poor');
	});

	test('defaults to good for an unknown metric name', () => {
		expect(rateMetric('BOGUS', 999999)).toBe('good');
	});
});

describe('extractLighthouse', () => {
	test('returns null for a missing or malformed LHR', () => {
		expect(extractLighthouse(null)).toBeNull();
		expect(extractLighthouse('nope')).toBeNull();
	});

	test('extracts category scores and the top failing audits, ascending by score', () => {
		const extracted = extractLighthouse(LHR);
		expect(extracted.scores).toEqual({ performance: 0.87 });
		expect(extracted.audits.map((a) => a.id)).toEqual([
			'uses-long-cache-ttl',
			'render-blocking-resources',
			'unused-css-rules',
		]);
		expect(extracted.audits[0]).toEqual({
			id: 'uses-long-cache-ttl',
			title: 'Uses efficient cache policy on static assets',
			score: 0.2,
			displayValue: '3 resources found',
		});
	});

	test('excludes passing (>= 0.9) and non-numeric-score audits', () => {
		const extracted = extractLighthouse(LHR);
		const ids = extracted.audits.map((a) => a.id);
		expect(ids).not.toContain('viewport');
		expect(ids).not.toContain('largest-contentful-paint');
		expect(ids).not.toContain('third-party-summary');
	});

	test('respects a custom topAudits cap', () => {
		expect(extractLighthouse(LHR, { topAudits: 1 })).toEqual({
			scores: { performance: 0.87 },
			audits: [
				{
					id: 'uses-long-cache-ttl',
					title: 'Uses efficient cache policy on static assets',
					score: 0.2,
					displayValue: '3 resources found',
				},
			],
		});
	});
});

describe('normalizeServer', () => {
	test('returns null when the layer is disabled', () => {
		expect(normalizeServer(null)).toBeNull();
	});

	test('maps a bare function map to top[], converting µs to ms and preserving order', () => {
		const normalized = normalizeServer({
			data: XHPROF,
			diagnostic: '[server-profile] path=/ resolved=home object_id=0',
			error: null,
		});
		expect(normalized.top.map((f) => f.fn)).toEqual([
			'WP_Query::get_posts',
			'WPDB::query',
			'the_content',
		]);
		expect(normalized.top[0]).toEqual({
			fn: 'WP_Query::get_posts',
			calls: 3,
			wallMs: 41.2,
			cpuMs: 38,
			memBytes: 1048576,
			peakMemBytes: 1148576,
		});
		expect(normalized.note).toBe(SERVER_FIDELITY_NOTE);
		expect(normalized.diagnostic).toBe(
			'[server-profile] path=/ resolved=home object_id=0'
		);
	});

	test('an empty array (no backend) is not an error but gets a guidance note', () => {
		const normalized = normalizeServer({
			data: [],
			diagnostic: null,
			error: null,
		});
		expect(normalized.top).toEqual([]);
		expect(normalized.error).toBeNull();
		expect(normalized.note).toMatch(/xhprof\/tideways_xhprof/);
	});

	test('an invocation failure carries the error and skips the empty-backend guidance', () => {
		const normalized = normalizeServer({
			data: null,
			diagnostic: null,
			error: 'no parseable output (exit code 255)',
		});
		expect(normalized.top).toEqual([]);
		expect(normalized.error).toBe('no parseable output (exit code 255)');
		expect(normalized.note).toBe(SERVER_FIDELITY_NOTE);
	});
});

describe('normalizePerf', () => {
	test('a scan error counts towards failedUrls, not issues, with empty metrics', () => {
		const report = normalizePerf([
			{
				url: 'http://localhost:8888/',
				scanError: 'net::ERR_CONNECTION_REFUSED',
				vitals: null,
				lighthouse: null,
				server: null,
				notes: [],
			},
		]);
		expect(report.summary).toEqual({
			urls: 1,
			passedUrls: 0,
			failedUrls: 1,
			issues: 0,
			worst: null,
		});
		const [result] = report.results;
		expect(result.metrics).toEqual({
			LCP: null,
			CLS: null,
			INP: null,
			FCP: null,
			TTFB: null,
		});
		expect(result.assessment).toEqual([]);
	});

	test('a clean URL with good metrics counts as passed with zero issues', () => {
		const report = normalizePerf([
			{
				url: 'http://localhost:8888/',
				scanError: null,
				vitals: {
					metrics: {
						LCP: { value: 2000, rating: 'good' },
						CLS: { value: 0.02, rating: 'good' },
						FCP: { value: 800, rating: 'good' },
						TTFB: { value: 200, rating: 'good' },
					},
					attribution: {
						lcpElement: null,
						clsSources: [],
						inpTarget: null,
					},
				},
				lighthouse: null,
				server: null,
				notes: [],
			},
		]);
		expect(report.summary.passedUrls).toBe(1);
		expect(report.summary.issues).toBe(0);
		expect(report.summary.worst).toBeNull();
		expect(report.results[0].metrics.INP).toBeNull();
	});

	test('INP is always forced to null even if the raw vitals carried a value', () => {
		const report = normalizePerf([
			{
				url: 'http://localhost:8888/',
				scanError: null,
				vitals: {
					metrics: { INP: { value: 150, rating: 'good' } },
					attribution: {},
				},
				lighthouse: null,
				server: null,
				notes: [],
			},
		]);
		expect(report.results[0].metrics.INP).toBeNull();
		expect(report.results[0].assessment).toContain(
			'INP: not measurable in lab (no interaction performed)'
		);
	});

	test('a poor metric is counted as an issue under the default (poor) threshold mode', () => {
		const report = normalizePerf(
			[
				{
					url: 'http://localhost:8888/',
					scanError: null,
					vitals: {
						metrics: { LCP: { value: 5000, rating: 'poor' } },
						attribution: {},
					},
					lighthouse: null,
					server: null,
					notes: [],
				},
			],
			{ thresholds: { cwv: 'poor', lighthousePerformance: 0.5 } }
		);
		expect(report.summary.issues).toBe(1);
		expect(report.summary.passedUrls).toBe(0);
		expect(report.summary.worst).toEqual({
			metric: 'LCP',
			url: 'http://localhost:8888/',
			value: 5000,
			rating: 'poor',
		});
	});

	test('needs-improvement only counts as an issue under the needs-improvement threshold mode', () => {
		const raw = [
			{
				url: 'http://localhost:8888/',
				scanError: null,
				vitals: {
					metrics: {
						LCP: { value: 3000, rating: 'needs-improvement' },
					},
					attribution: {},
				},
				lighthouse: null,
				server: null,
				notes: [],
			},
		];
		expect(
			normalizePerf(raw, { thresholds: { cwv: 'poor' } }).summary.issues
		).toBe(0);
		expect(
			normalizePerf(raw, { thresholds: { cwv: 'needs-improvement' } })
				.summary.issues
		).toBe(1);
		expect(
			normalizePerf(raw, { thresholds: { cwv: 'never' } }).summary.issues
		).toBe(0);
	});

	test('worst is chosen by severity (value / poor-threshold) across URLs and metrics', () => {
		const report = normalizePerf([
			{
				url: 'http://a/',
				scanError: null,
				// LCP poor threshold is 4000ms; 4400 / 4000 = 1.1
				vitals: {
					metrics: { LCP: { value: 4400, rating: 'poor' } },
					attribution: {},
				},
				lighthouse: null,
				server: null,
				notes: [],
			},
			{
				url: 'http://b/',
				scanError: null,
				// CLS poor threshold is 0.25; 0.4 / 0.25 = 1.6 -- worse.
				vitals: {
					metrics: { CLS: { value: 0.4, rating: 'poor' } },
					attribution: {},
				},
				lighthouse: null,
				server: null,
				notes: [],
			},
		]);
		expect(report.summary.worst).toEqual({
			metric: 'CLS',
			url: 'http://b/',
			value: 0.4,
			rating: 'poor',
		});
	});

	test('a lighthouse performance score below threshold is an issue', () => {
		// normalizePerf expects raw.lighthouse already extracted, not a raw LHR.
		const report = normalizePerf(
			[
				{
					url: 'http://localhost:8888/',
					scanError: null,
					vitals: {
						metrics: { LCP: { value: 1000, rating: 'good' } },
						attribution: {},
					},
					lighthouse: extractLighthouse(LHR),
					server: null,
					notes: [],
				},
			],
			{ thresholds: { cwv: 'poor', lighthousePerformance: 0.9 } }
		);
		expect(report.summary.issues).toBe(1);
		expect(report.results[0].lighthouse.scores.performance).toBe(0.87);
		expect(
			report.results[0].assessment.some((line) =>
				line.includes('below threshold')
			)
		).toBe(true);
	});

	test('the server section threads through normalizeServer unchanged in shape', () => {
		const report = normalizePerf([
			{
				url: 'http://localhost:8888/',
				scanError: null,
				vitals: {
					metrics: { LCP: { value: 1000, rating: 'good' } },
					attribution: {},
				},
				lighthouse: null,
				server: { data: XHPROF, diagnostic: null, error: null },
				notes: [],
			},
		]);
		expect(report.results[0].server.top[0].fn).toBe('WP_Query::get_posts');
	});

	test('carries per-URL notes through untouched', () => {
		const report = normalizePerf([
			{
				url: 'http://localhost:8888/',
				scanError: null,
				vitals: {
					metrics: { LCP: { value: 1000, rating: 'good' } },
					attribution: {},
				},
				lighthouse: null,
				server: null,
				notes: ['lighthouse: failed — Chrome crashed'],
			},
		]);
		expect(report.results[0].notes).toEqual([
			'lighthouse: failed — Chrome crashed',
		]);
	});
});
