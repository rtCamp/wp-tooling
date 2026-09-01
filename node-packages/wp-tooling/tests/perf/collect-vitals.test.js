'use strict';

const {
	launchBrowser,
	collectVitals,
	buildResult,
} = require('../../src/perf/collect-vitals');

/**
 * Build a fake puppeteer `Page`, recording every call it receives.
 *
 * @param {Object} [o]
 * @param {Object} [o.harvested] Value `page.evaluate` resolves to (the harvested vitals).
 * @param {Error}  [o.gotoError] When set, `page.goto` rejects with this error.
 * @return {{page: Object, calls: Array}} The fake page and its call log.
 */
function fakePage(o = {}) {
	const calls = [];
	const page = {
		evaluateOnNewDocument: jest.fn(async (src) => {
			calls.push(['evaluateOnNewDocument', src]);
		}),
		goto: jest.fn(async (url, opts) => {
			calls.push(['goto', url, opts]);
			if (o.gotoError) {
				throw o.gotoError;
			}
		}),
		evaluate: jest.fn(async () => {
			calls.push(['evaluate']);
			return o.harvested !== undefined ? o.harvested : {};
		}),
		close: jest.fn(async () => {
			calls.push(['close']);
		}),
	};
	return { page, calls };
}

describe('launchBrowser', () => {
	test('launches headless with the given chrome args', async () => {
		const launch = jest.fn(async () => ({ marker: 'browser' }));
		const browser = await launchBrowser(
			{ launch },
			{ chromeArgs: ['--no-sandbox'] }
		);
		expect(browser).toEqual({ marker: 'browser' });
		expect(launch).toHaveBeenCalledWith({
			headless: true,
			args: ['--no-sandbox'],
		});
	});

	test('wraps a launch failure in RunnerError EBINFAIL', async () => {
		const launch = jest.fn(async () => {
			throw new Error('no chrome binary');
		});
		await expect(launchBrowser({ launch })).rejects.toMatchObject({
			code: 'EBINFAIL',
		});
	});
});

describe('collectVitals', () => {
	test('injects the script before navigating, then harvests and closes', async () => {
		const { page, calls } = fakePage({
			harvested: {
				LCP: {
					value: 2431.2,
					rating: 'good',
					attribution: { target: 'img.hero' },
				},
			},
		});
		const browser = { newPage: jest.fn(async () => page) };

		const result = await collectVitals(
			browser,
			'/* web-vitals iife */',
			'http://localhost:8888/',
			{ settleMs: 1, timeoutMs: 5000 }
		);

		expect(calls[0][0]).toBe('evaluateOnNewDocument');
		expect(calls[0][1]).toContain('/* web-vitals iife */');
		expect(calls[1]).toEqual([
			'goto',
			'http://localhost:8888/',
			{ waitUntil: 'networkidle2', timeout: 5000 },
		]);
		expect(calls[calls.length - 1][0]).toBe('close');

		expect(result.metrics.LCP).toEqual({ value: 2431.2, rating: 'good' });
		expect(result.attribution.lcpElement).toBe('img.hero');
	});

	test('an explicit 0 for settleMs/timeoutMs is respected, not defaulted', async () => {
		const { page, calls } = fakePage({ harvested: {} });
		const browser = { newPage: jest.fn(async () => page) };

		await collectVitals(browser, '/* iife */', 'http://localhost:8888/', {
			settleMs: 0,
			timeoutMs: 0,
		});

		expect(calls[1]).toEqual([
			'goto',
			'http://localhost:8888/',
			{ waitUntil: 'networkidle2', timeout: 0 },
		]);
	});

	test('a goto rejection propagates, but the page is still closed', async () => {
		const gotoError = new Error('net::ERR_CONNECTION_REFUSED');
		const { page, calls } = fakePage({ gotoError });
		const browser = { newPage: jest.fn(async () => page) };

		await expect(
			collectVitals(browser, '/* iife */', 'http://localhost:8888/', {
				settleMs: 1,
			})
		).rejects.toThrow('net::ERR_CONNECTION_REFUSED');

		expect(calls[calls.length - 1][0]).toBe('close');
	});
});

describe('buildResult', () => {
	test('maps present metrics and defaults missing ones to null', () => {
		const result = buildResult({
			LCP: {
				value: 2000,
				rating: 'good',
				attribution: { target: 'img' },
			},
			CLS: {
				value: 0.05,
				rating: 'good',
				attribution: { largestShiftTarget: 'div.banner' },
			},
		});
		expect(result.metrics).toEqual({
			LCP: { value: 2000, rating: 'good' },
			CLS: { value: 0.05, rating: 'good' },
			INP: null,
			FCP: null,
			TTFB: null,
		});
		expect(result.attribution).toEqual({
			lcpElement: 'img',
			clsSources: ['div.banner'],
			inpTarget: null,
		});
	});

	test('handles a completely empty harvest', () => {
		const result = buildResult({});
		expect(Object.values(result.metrics).every((m) => m === null)).toBe(
			true
		);
		expect(result.attribution).toEqual({
			lcpElement: null,
			clsSources: [],
			inpTarget: null,
		});
	});
});
