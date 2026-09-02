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

/** Lighthouse audit score (0-1) below which an audit counts as "failing" and gets surfaced. */
const FAILING_AUDIT_SCORE_THRESHOLD = 0.9;

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
	if (!band || value <= band[0]) {
		return 'good';
	}
	if (value <= band[1]) {
		return 'needs-improvement';
	}
	return 'poor';
}

/**
 * Extract and rank an LHR's failing audits (score below the threshold).
 *
 * @param {Object} audits    Raw LHR `audits` map.
 * @param {number} topAudits Max entries to return.
 * @return {Object[]} Failing audits, ascending by score.
 */
function extractFailingAudits(audits, topAudits) {
	return Object.entries(audits)
		.filter(
			([, audit]) =>
				audit &&
				typeof audit.score === 'number' &&
				audit.score < FAILING_AUDIT_SCORE_THRESHOLD
		)
		.map(([id, audit]) => ({
			id,
			title: typeof audit.title === 'string' ? audit.title : id,
			score: audit.score,
			displayValue:
				typeof audit.displayValue === 'string'
					? audit.displayValue
					: null,
		}))
		.sort((a, b) => a.score - b.score)
		.slice(0, topAudits);
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

	return { scores, audits: extractFailingAudits(audits, topAudits) };
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
		for (const [fn, stat] of Object.entries(data)) {
			if (!stat || typeof stat !== 'object' || Array.isArray(stat)) {
				continue;
			}
			top.push({
				fn,
				calls: Number(stat.ct) || 0,
				wallMs: (Number(stat.wt) || 0) / 1000,
				cpuMs: (Number(stat.cpu) || 0) / 1000,
				memBytes: Number(stat.mu) || 0,
				peakMemBytes: Number(stat.pmu) || 0,
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
		const metric = metrics[name];
		if (!metric) {
			continue;
		}
		const band = THRESHOLDS[name];
		const unit = name === 'CLS' ? '' : 'ms';
		lines.push(
			`${name} ${metric.value}${unit} — ${metric.rating} (good ≤ ${band[0]}${unit}, poor > ${band[1]}${unit})`
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
 * Rate one measurable metric's raw vitals reading and produce a worst-issue
 * candidate when it isn't "good". Pulled out of `normalizePerf`'s per-URL
 * loop so rating, issue-counting and worst-tracking aren't nested three
 * levels inside a per-metric branch.
 *
 * @param {string}      name        Metric name.
 * @param {Object|null} vitalMetric Raw `{value, rating}` reading for this metric, or null/undefined.
 * @param {string}      url         URL this reading belongs to (for the worst-candidate).
 * @param {string}      cwvMode     `thresholds.cwv` mode.
 * @return {{metric: ({value: number, rating: string}|null), isIssue: boolean,
 *   worstCandidate: ({metric: string, url: string, value: number, rating: string, severity: number}|null)}}
 *   Normalised metric, whether it counts as an issue, and a worst-candidate (or null when not applicable).
 */
function rateMeasurableMetric(name, vitalMetric, url, cwvMode) {
	if (!vitalMetric || typeof vitalMetric.value !== 'number') {
		return { metric: null, isIssue: false, worstCandidate: null };
	}

	const rating = vitalMetric.rating || rateMetric(name, vitalMetric.value);
	let worstCandidate = null;
	if (rating !== 'good') {
		worstCandidate = {
			metric: name,
			url,
			value: vitalMetric.value,
			rating,
			severity: vitalMetric.value / THRESHOLDS[name][1],
		};
	}

	return {
		metric: { value: vitalMetric.value, rating },
		isIssue: isCwvIssue(rating, cwvMode),
		worstCandidate,
	};
}

/**
 * Build the per-URL result entry for a browser scan failure — empty metrics
 * and no assessment; the server layer (which runs independently of the
 * browser) is unaffected.
 *
 * @param {Object} raw Raw per-URL capture with a truthy `scanError`.
 * @return {Object} Result entry for `normalizePerf`'s `results[]`.
 */
function buildScanErrorResult(raw) {
	return {
		url: raw.url,
		scanError: raw.scanError,
		metrics: Object.fromEntries(METRIC_NAMES.map((name) => [name, null])),
		attribution: { lcpElement: null, clsSources: [], inpTarget: null },
		lighthouse: null,
		server: normalizeServer(raw.server),
		assessment: [],
		notes: raw.notes || [],
	};
}

/**
 * Build the per-URL result entry for a page that loaded successfully, and
 * fold its issue count / worst-candidate / pass-fail outcome into `totals`.
 *
 * @param {Object} raw        Raw per-URL capture (no `scanError`).
 * @param {Object} thresholds Resolved `thresholds` config section.
 * @param {Object} totals     Running summary totals, mutated in place.
 * @return {Object} Result entry for `normalizePerf`'s `results[]`.
 */
function buildUrlResult(raw, thresholds, totals) {
	const vitals = raw.vitals || { metrics: {}, attribution: {} };
	const metrics = {};
	let urlIssues = 0;

	for (const name of MEASURABLE_METRIC_NAMES) {
		const { metric, isIssue, worstCandidate } = rateMeasurableMetric(
			name,
			vitals.metrics[name],
			raw.url,
			thresholds.cwv
		);
		metrics[name] = metric;
		if (isIssue) {
			urlIssues++;
		}
		if (
			worstCandidate &&
			(!totals.worst || worstCandidate.severity > totals.worst.severity)
		) {
			totals.worst = worstCandidate;
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

	totals.issues += urlIssues;

	const notes = raw.notes ? [...raw.notes] : [];
	if (raw.vitalsError) {
		notes.push(raw.vitalsError);
		totals.failedUrls++;
	} else if (urlIssues === 0) {
		totals.passedUrls++;
	}

	return {
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
		notes,
	};
}

/**
 * Normalise raw per-URL perf capture into the final two-layer report.
 *
 * `raw.lighthouse` is expected to already be the extracted `{scores, audits}`
 * shape (or `null`), never a raw LHR.
 *
 * @param {Object[]} rawResults           Raw per-URL capture: `{ url, scanError,
 *                                        vitalsError, vitals, lighthouse, server, notes }`.
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
	const totals = { passedUrls: 0, failedUrls: 0, issues: 0, worst: null };

	for (const raw of rawResults || []) {
		if (raw.scanError) {
			totals.failedUrls++;
			results.push(buildScanErrorResult(raw));
			continue;
		}
		results.push(buildUrlResult(raw, thresholds, totals));
	}

	return {
		tool: 'web-vitals+lighthouse',
		summary: {
			urls: results.length,
			passedUrls: totals.passedUrls,
			failedUrls: totals.failedUrls,
			issues: totals.issues,
			worst: totals.worst
				? {
						metric: totals.worst.metric,
						url: totals.worst.url,
						value: totals.worst.value,
						rating: totals.worst.rating,
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
	MEASURABLE_METRIC_NAMES,
	SERVER_FIDELITY_NOTE,
};
