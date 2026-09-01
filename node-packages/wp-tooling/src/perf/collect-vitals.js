/**
 * Lab Core Web Vitals collection under headless Chromium.
 *
 * Takes the consumer-installed `puppeteer` module and an already-launched
 * browser as PARAMETERS rather than requiring them itself — this is what
 * keeps the module unit-testable with a hand-built fake browser/page and no
 * `jest.mock`. `run.js` is the only place that resolves the real module.
 *
 * LCP and CLS never "finalize" on a headless page with no user input, so the
 * web-vitals listeners are registered with `reportAllChanges: true` and we
 * harvest the latest reported candidate after a settle delay instead of
 * waiting for a finalization event that never arrives. INP requires a user
 * interaction that this collector never performs, so it is always `null`.
 */

'use strict';

const { RunnerError } = require('./errors');
const { METRIC_NAMES } = require('./normalize');

/**
 * Registers web-vitals attribution listeners and stashes the latest reading
 * for each metric on `window.__wpToolingVitals`, keyed by metric name.
 * Injected via `page.evaluateOnNewDocument` immediately after the web-vitals
 * attribution IIFE source, so `webVitals` is already a global when this runs.
 */
const REGISTER_SNIPPET = `
window.__wpToolingVitals = {};
(function () {
	var store = function (metric) {
		window.__wpToolingVitals[metric.name] = {
			value: metric.value,
			rating: metric.rating,
			attribution: {
				target: (metric.attribution && metric.attribution.target) || null,
				largestShiftTarget: (metric.attribution && metric.attribution.largestShiftTarget) || null,
				interactionTarget: (metric.attribution && metric.attribution.interactionTarget) || null,
			},
		};
	};
	var opts = { reportAllChanges: true };
	webVitals.onLCP(store, opts);
	webVitals.onCLS(store, opts);
	webVitals.onINP(store, opts);
	webVitals.onFCP(store, opts);
	webVitals.onTTFB(store, opts);
})();
`;

/**
 * Launch a headless browser via the consumer-installed puppeteer module.
 *
 * @param {Object}   puppeteer            Consumer-installed `puppeteer` module.
 * @param {Object}   [options]
 * @param {string[]} [options.chromeArgs] Extra Chrome launch args.
 * @return {Promise<Object>} A puppeteer `Browser` instance.
 * @throws {RunnerError} `EBINFAIL` when the browser fails to launch.
 */
async function launchBrowser(puppeteer, options = {}) {
	try {
		return await puppeteer.launch({
			headless: true,
			args: options.chromeArgs || [],
		});
	} catch (err) {
		const detail = (err && err.message ? err.message : '').toString();
		throw new RunnerError(
			'EBINFAIL',
			`headless Chromium failed to launch: ${detail}`,
			{ detail }
		);
	}
}

/**
 * Collect lab Core Web Vitals for one URL under an already-launched browser.
 *
 * @param {Object} browser                   Puppeteer `Browser` instance.
 * @param {string} scriptSource              The web-vitals attribution IIFE source.
 * @param {string} url                       Target URL.
 * @param {Object} [options]
 * @param {number} [options.settleMs=3000]   Time to wait after load before harvesting.
 * @param {number} [options.timeoutMs=30000] Navigation timeout.
 * @return {Promise<{metrics: Object, attribution: Object}>} Collected metrics + attribution.
 *   Rejects when the page fails to load (the caller records this as a per-URL scan error).
 */
async function collectVitals(browser, scriptSource, url, options = {}) {
	const settleMs = options.settleMs ?? 3000;
	const timeoutMs = options.timeoutMs ?? 30000;

	const page = await browser.newPage();
	try {
		await page.evaluateOnNewDocument(
			`${scriptSource}\n${REGISTER_SNIPPET}`
		);
		await page.goto(url, { waitUntil: 'networkidle2', timeout: timeoutMs });
		await new Promise((resolve) => {
			setTimeout(resolve, settleMs);
		});
		const raw = (await page.evaluate(() => window.__wpToolingVitals)) || {};
		return buildResult(raw);
	} finally {
		await page.close();
	}
}

/**
 * Shape the raw harvested vitals into `{ metrics, attribution }`.
 *
 * @param {Object} raw Harvested `window.__wpToolingVitals`.
 * @return {{metrics: Object, attribution: Object}} Shaped result.
 */
function buildResult(raw) {
	const metrics = {};
	for (const name of METRIC_NAMES) {
		const metric = raw[name];
		metrics[name] =
			metric && typeof metric.value === 'number'
				? { value: metric.value, rating: metric.rating || null }
				: null;
	}

	const lcpAttr = (raw.LCP && raw.LCP.attribution) || {};
	const clsAttr = (raw.CLS && raw.CLS.attribution) || {};
	const inpAttr = (raw.INP && raw.INP.attribution) || {};

	return {
		metrics,
		attribution: {
			lcpElement: lcpAttr.target || null,
			clsSources: clsAttr.largestShiftTarget
				? [clsAttr.largestShiftTarget]
				: [],
			inpTarget: inpAttr.interactionTarget || null,
		},
	};
}

module.exports = {
	launchBrowser,
	collectVitals,
	buildResult,
};
