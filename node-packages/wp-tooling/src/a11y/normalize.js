/**
 * Normalise pa11y-ci `--json` output into a stable shape the a11y skill and
 * tests depend on. Pure — no child process, no I/O — so it is unit-testable
 * against a fixture.
 *
 * pa11y-ci raw shape:
 *   { total, passes, errors, results: { "<url>": [ { code, type, typeCode,
 *     message, context, selector, runner, runnerExtras } ] } }
 *
 * Normalised shape:
 *   { tool, standard, summary: { urls, violations, errors, warnings, notices,
 *     passedUrls, failedUrls }, results: [ { url, scanError, violations: [ {
 *     id, wcagCriterion, impact, runner, message, selector, context,
 *     domHints } ] } ] }
 *
 * A URL pa11y-ci could not load (e.g. `net::ERR_CONNECTION_REFUSED`) is a
 * scan failure, not a violation: its entry carries `scanError` (the load
 * error message) with an empty `violations`, and it counts towards
 * `summary.failedUrls` rather than the violation totals.
 */

'use strict';

/** pa11y `type` → normalised `impact`. */
const IMPACT_BY_TYPE = { error: 'error', warning: 'warning', notice: 'notice' };

/** Sort order for violations within a URL (lower ranks sort first). */
const IMPACT_RANK = { error: 0, warning: 1, notice: 2 };

/**
 * Normalise a full pa11y-ci report.
 *
 * @param {Object} raw                Parsed pa11y-ci `--json` output.
 * @param {Object} [options]
 * @param {string} [options.standard] Standard label for the report (default WCAG2AA).
 * @return {Object} The normalised report.
 */
function normalizeA11y(raw, options = {}) {
	const standard = options.standard || 'WCAG2AA';
	const resultsMap =
		raw && raw.results && typeof raw.results === 'object'
			? raw.results
			: {};

	const results = [];
	let violations = 0;
	let errors = 0;
	let warnings = 0;
	let notices = 0;
	let passedUrls = 0;
	let failedUrls = 0;

	const urls = Object.keys(resultsMap).sort();
	for (const url of urls) {
		const issues = Array.isArray(resultsMap[url]) ? resultsMap[url] : [];
		const loadFailures = issues.filter(isScanError);
		const normViolations = issues
			.filter((issue) => !isScanError(issue))
			.map(normalizeIssue)
			.sort(compareViolations);

		const scanError =
			loadFailures.length > 0 ? loadFailures[0].message : null;
		if (scanError) {
			failedUrls++;
		} else if (normViolations.length === 0) {
			passedUrls++;
		}
		for (const v of normViolations) {
			violations++;
			if (v.impact === 'error') {
				errors++;
			} else if (v.impact === 'warning') {
				warnings++;
			} else if (v.impact === 'notice') {
				notices++;
			}
		}

		results.push({ url, scanError, violations: normViolations });
	}

	return {
		tool: 'pa11y-ci',
		standard,
		summary: {
			urls: urls.length,
			violations,
			errors,
			warnings,
			notices,
			passedUrls,
			failedUrls,
		},
		results,
	};
}

/**
 * Detect a URL-level load failure. pa11y-ci reports one as a bare
 * `{ message }` entry with none of the fields a real issue carries
 * (`code`, `type`, `runner`).
 *
 * @param {Object} issue Raw pa11y results entry.
 * @return {boolean} True when the entry is a load failure, not an issue.
 */
function isScanError(issue) {
	return (
		issue !== null &&
		typeof issue === 'object' &&
		issue.code === undefined &&
		issue.type === undefined &&
		issue.runner === undefined &&
		typeof issue.message === 'string'
	);
}

/**
 * Normalise a single pa11y issue.
 *
 * @param {Object} issue Raw pa11y issue.
 * @return {Object} Normalised violation.
 */
function normalizeIssue(issue) {
	const code = typeof issue.code === 'string' ? issue.code : '';
	const type = typeof issue.type === 'string' ? issue.type : 'error';
	const context = typeof issue.context === 'string' ? issue.context : '';
	const selector = typeof issue.selector === 'string' ? issue.selector : '';

	return {
		id: code,
		wcagCriterion: parseWcagCriterion(code),
		impact: IMPACT_BY_TYPE[type] || 'error',
		runner: typeof issue.runner === 'string' ? issue.runner : null,
		message: typeof issue.message === 'string' ? issue.message : '',
		selector,
		context,
		domHints: extractDomHints(context, selector),
	};
}

/**
 * Extract the WCAG success-criterion number from an HTMLCS code such as
 * `WCAG2AA.Principle1.Guideline1_1.1_1_1.H37` → `1.1.1`. Returns `null` for
 * codes that carry no criterion (e.g. axe rule ids like `image-alt`).
 *
 * @param {string} code pa11y issue code.
 * @return {string|null} Dotted criterion, or null.
 */
function parseWcagCriterion(code) {
	const m = /(\d+)_(\d+)_(\d+)/.exec(code || '');
	if (!m) {
		return null;
	}
	return `${m[1]}.${m[2]}.${m[3]}`;
}

/**
 * Regex-extract identifying tokens from the issue's context HTML + selector so
 * the skill can grep the repo for the source that rendered the node without
 * re-parsing HTML itself.
 *
 * @param {string} context  Issue context HTML snippet.
 * @param {string} selector Issue CSS selector.
 * @return {{tagName: string|null, classList: string[], idAttr: string|null,
 *   attrs: Object<string,string>}} Extracted hints.
 */
function extractDomHints(context, selector) {
	const hints = { tagName: null, classList: [], idAttr: null, attrs: {} };

	const tagFromContext = /^\s*<\s*([a-zA-Z][\w-]*)/.exec(context || '');
	if (tagFromContext) {
		hints.tagName = tagFromContext[1].toLowerCase();
	} else {
		const segments = (selector || '')
			.split('>')
			.map((s) => s.trim())
			.filter(Boolean);
		const last = segments[segments.length - 1] || '';
		const tagFromSelector = /^([a-zA-Z][\w-]*)/.exec(last);
		if (tagFromSelector) {
			hints.tagName = tagFromSelector[1].toLowerCase();
		}
	}

	const openTag = /<[^>]*>/.exec(context || '');
	if (openTag) {
		const attrRe =
			/([a-zA-Z_:][-\w:.]*)\s*=\s*"([^"]*)"|([a-zA-Z_:][-\w:.]*)\s*=\s*'([^']*)'/g;
		let m;
		while ((m = attrRe.exec(openTag[0])) !== null) {
			const name = (m[1] || m[3]).toLowerCase();
			const value = m[2] !== undefined ? m[2] : m[4];
			if (name === 'class') {
				hints.classList = value.split(/\s+/).filter(Boolean);
			} else if (name === 'id') {
				hints.idAttr = value;
			} else {
				hints.attrs[name] = value;
			}
		}
	}

	return hints;
}

/**
 * Deterministic ordering: by impact, then id, then selector.
 *
 * @param {Object} a First violation.
 * @param {Object} b Second violation.
 * @return {number} Comparator result.
 */
function compareViolations(a, b) {
	const ra = a.impact in IMPACT_RANK ? IMPACT_RANK[a.impact] : 9;
	const rb = b.impact in IMPACT_RANK ? IMPACT_RANK[b.impact] : 9;
	if (ra !== rb) {
		return ra - rb;
	}
	if (a.id !== b.id) {
		return a.id < b.id ? -1 : 1;
	}
	if (a.selector !== b.selector) {
		return a.selector < b.selector ? -1 : 1;
	}
	return 0;
}

module.exports = {
	normalizeA11y,
	normalizeIssue,
	isScanError,
	parseWcagCriterion,
	extractDomHints,
};
