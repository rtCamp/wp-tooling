/**
 * Normalise raw per-URL perf capture into the two-layer report the
 * performance skill consumes. Pure — no I/O — so it is unit-testable
 * against fixtures, mirroring `src/a11y/normalize.js`.
 *
 * Normalised shape:
 *   { tool: 'web-vitals+lighthouse',
 *     summary: { urls, passedUrls, failedUrls, issues, worst },
 *     results: [ { url, scanError, metrics: { LCP, CLS, INP, FCP, TTFB },
 *       attribution, lighthouse, server, assessment, notes } ] }
 *
 * A URL puppeteer could not load is a scan failure, not an issue: its entry
 * carries `scanError` with empty metrics, and counts towards
 * `summary.failedUrls` rather than `summary.issues` — the same split a11y
 * makes for `net::ERR_*` load failures.
 */

'use strict';

/** good/needs-improvement/poor band edges, keyed by metric name. */
const THRESHOLDS = {
	LCP: [2500, 4000],
	FCP: [1800, 3000],
	TTFB: [800, 1800],
	CLS: [0.1, 0.25],
	INP: [200, 500],
};

/** All lab metric names, derived from THRESHOLDS so the two stay in sync. */
const METRIC_NAMES = Object.keys(THRESHOLDS);

/** Metrics this collector actually measures — INP never is (no interaction is performed). */
const MEASURABLE_METRIC_NAMES = METRIC_NAMES.filter((name) => name !== 'INP');

/** Fidelity caveat surfaced on every server-profile result (epic task 03). */
const SERVER_FIDELITY_NOTE =
	'profiled via `wp eval-file` in CLI context — representative for hot functions and N+1s, not a real HTTP request (routing/superglobals differ and it will not reflect web-server/opcache warmth).';

/**
 * Rate a metric value against its good/needs-improvement/poor band. Used as
 * a fallback when the web-vitals library did not supply its own `rating`.
 *
 * @param {string} name  Metric name (LCP, FCP, TTFB, CLS, INP).
 * @param {number} value Metric value.
 * @return {'good'|'needs-improvement'|'poor'} Rating.
 */
function rateMetric(name, value) {
	const band = THRESHOLDS[name];
	if (!band) {
		return 'good';
	}
	if (value <= band[0]) {
		return 'good';
	}
	if (value <= band[1]) {
		return 'needs-improvement';
	}
	return 'poor';
}

/**
 * Extract Lighthouse category scores + top failing audits from a raw LHR.
 *
 * @param {Object|null} lhr                   Raw Lighthouse result.
 * @param {Object}      [options]
 * @param {number}      [options.topAudits=5] Max failing audits to report.
 * @return {{scores: Object<string,number>, audits: Object[]}|null} Extracted layer, or null.
 */
function extractLighthouse(lhr, options = {}) {
	if (!lhr || typeof lhr !== 'object') {
		return null;
	}
	const topAudits = options.topAudits || 5;
	const categories =
		lhr.categories && typeof lhr.categories === 'object'
			? lhr.categories
			: {};
	const scores = {};
	for (const [id, cat] of Object.entries(categories)) {
		if (cat && typeof cat.score === 'number') {
			scores[id] = cat.score;
		}
	}

	const audits =
		lhr.audits && typeof lhr.audits === 'object' ? lhr.audits : {};
	const failing = Object.entries(audits)
		.filter(([, a]) => a && typeof a.score === 'number' && a.score < 0.9)
		.map(([id, a]) => ({
			id,
			title: typeof a.title === 'string' ? a.title : id,
			score: a.score,
			displayValue:
				typeof a.displayValue === 'string' ? a.displayValue : null,
		}))
		.sort((a, b) => a.score - b.score)
		.slice(0, topAudits);

	return { scores, audits: failing };
}

/**
 * Normalise one server-profile.js result into the report's `server` section.
 *
 * @param {{data: *, diagnostic: (string|null), error: (string|null)}|null} result
 *                                                                                 Raw result from `server-profile.js`'s `runServerProfile`, or `null` when the layer is disabled.
 * @return {Object|null} Normalised `server` section, or `null` when the layer is disabled.
 */
function normalizeServer(result) {
	if (!result) {
		return null;
	}
	const { data, diagnostic, error } = result;
	const top = [];
	if (data && typeof data === 'object' && !Array.isArray(data)) {
		for (const [fn, m] of Object.entries(data)) {
			top.push({
				fn,
				calls: Number(m.ct) || 0,
				wallMs: (Number(m.wt) || 0) / 1000,
				cpuMs: (Number(m.cpu) || 0) / 1000,
				memBytes: Number(m.mu) || 0,
				peakMemBytes: Number(m.pmu) || 0,
			});
		}
	}

	let note = SERVER_FIDELITY_NOTE;
	if (!error && top.length === 0) {
		note = `${SERVER_FIDELITY_NOTE} No hotspots captured — the xhprof/tideways_xhprof PHP extension may not be loaded in the WP-CLI environment, or rtcamp/wp-dev-tools is not installed.`;
	}

	return { top, note, diagnostic, error: error || null };
}

/**
 * Determine whether a rating counts as an issue under the configured
 * `thresholds.cwv` mode.
 *
 * @param {string} rating Metric rating.
 * @param {string} mode   `thresholds.cwv` mode ('poor'|'needs-improvement'|'never').
 * @return {boolean} True when the rating counts as an issue.
 */
function isCwvIssue(rating, mode) {
	if (mode === 'never') {
		return false;
	}
	if (mode === 'needs-improvement') {
		return rating === 'poor' || rating === 'needs-improvement';
	}
	return rating === 'poor';
}

/**
 * Build the per-URL human-readable `assessment` lines.
 *
 * @param {Object}      metrics    Normalised metrics for the URL.
 * @param {Object|null} lighthouse Extracted lighthouse layer for the URL.
 * @param {Object}      thresholds Resolved `thresholds` config section.
 * @return {string[]} Assessment lines.
 */
function buildAssessment(metrics, lighthouse, thresholds) {
	const lines = [];
	for (const name of MEASURABLE_METRIC_NAMES) {
		const m = metrics[name];
		if (!m) {
			continue;
		}
		const band = THRESHOLDS[name];
		const unit = name === 'CLS' ? '' : 'ms';
		lines.push(
			`${name} ${m.value}${unit} — ${m.rating} (good ≤ ${band[0]}${unit}, poor > ${band[1]}${unit})`
		);
	}
	lines.push('INP: not measurable in lab (no interaction performed)');
	if (
		lighthouse &&
		typeof lighthouse.scores.performance === 'number' &&
		typeof thresholds.lighthousePerformance === 'number'
	) {
		const perf = lighthouse.scores.performance;
		const verdict =
			perf < thresholds.lighthousePerformance
				? 'below threshold'
				: 'above threshold';
		lines.push(
			`lighthouse performance ${perf} — ${verdict} ${thresholds.lighthousePerformance}`
		);
	}
	return lines;
}

/**
 * Normalise raw per-URL perf capture into the final two-layer report.
 *
 * `raw.lighthouse` is expected to already be the extracted `{scores, audits}`
 * shape (or `null`), never a raw LHR.
 *
 * @param {Object[]} rawResults           Raw per-URL capture: `{ url, scanError,
 *                                        vitals, lighthouse, server, notes }`.
 * @param {Object}   [options]
 * @param {Object}   [options.thresholds] Resolved `thresholds` config section.
 * @return {Object} Normalised report.
 */
function normalizePerf(rawResults, options = {}) {
	const thresholds = options.thresholds || {
		cwv: 'poor',
		lighthousePerformance: 0.5,
	};

	const results = [];
	let passedUrls = 0;
	let failedUrls = 0;
	let issues = 0;
	let worst = null;

	for (const raw of rawResults || []) {
		if (raw.scanError) {
			failedUrls++;
			results.push({
				url: raw.url,
				scanError: raw.scanError,
				metrics: Object.fromEntries(
					METRIC_NAMES.map((name) => [name, null])
				),
				attribution: {
					lcpElement: null,
					clsSources: [],
					inpTarget: null,
				},
				lighthouse: null,
				server: normalizeServer(raw.server),
				assessment: [],
				notes: raw.notes || [],
			});
			continue;
		}

		const vitals = raw.vitals || { metrics: {}, attribution: {} };
		const metrics = {};
		let urlIssues = 0;

		for (const name of MEASURABLE_METRIC_NAMES) {
			const m = vitals.metrics[name];
			if (m && typeof m.value === 'number') {
				const rating = m.rating || rateMetric(name, m.value);
				metrics[name] = { value: m.value, rating };
				if (isCwvIssue(rating, thresholds.cwv)) {
					urlIssues++;
				}
				if (rating !== 'good') {
					const severity = m.value / THRESHOLDS[name][1];
					if (!worst || severity > worst.severity) {
						worst = {
							metric: name,
							url: raw.url,
							value: m.value,
							rating,
							severity,
						};
					}
				}
			} else {
				metrics[name] = null;
			}
		}
		metrics.INP = null;

		const lighthouse = raw.lighthouse;
		if (
			lighthouse &&
			typeof lighthouse.scores.performance === 'number' &&
			typeof thresholds.lighthousePerformance === 'number' &&
			lighthouse.scores.performance < thresholds.lighthousePerformance
		) {
			urlIssues++;
		}

		issues += urlIssues;
		if (urlIssues === 0) {
			passedUrls++;
		}

		results.push({
			url: raw.url,
			scanError: null,
			metrics,
			attribution: vitals.attribution || {
				lcpElement: null,
				clsSources: [],
				inpTarget: null,
			},
			lighthouse,
			server: normalizeServer(raw.server),
			assessment: buildAssessment(metrics, lighthouse, thresholds),
			notes: raw.notes || [],
		});
	}

	return {
		tool: 'web-vitals+lighthouse',
		summary: {
			urls: results.length,
			passedUrls,
			failedUrls,
			issues,
			worst: worst
				? {
						metric: worst.metric,
						url: worst.url,
						value: worst.value,
						rating: worst.rating,
					}
				: null,
		},
		results,
	};
}

module.exports = {
	normalizePerf,
	rateMetric,
	extractLighthouse,
	normalizeServer,
	THRESHOLDS,
	METRIC_NAMES,
	SERVER_FIDELITY_NOTE,
};
