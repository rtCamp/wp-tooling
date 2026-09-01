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

const {
	WCAG_CRITERION_RE,
	TAG_FROM_CONTEXT_RE,
	TAG_FROM_SELECTOR_RE,
	OPEN_TAG_RE,
	ATTR_RE,
} = require('./regex');

/** pa11y `type` → normalised `impact`. */
const IMPACT_BY_TYPE = { error: 'error', warning: 'warning', notice: 'notice' };

/** Sort order for violations within a URL (lower ranks sort first). */
const IMPACT_RANK = { error: 0, warning: 1, notice: 2 };

/** Rank for an impact outside the known set — sorts after error/warning/notice. */
const UNKNOWN_IMPACT_RANK = 9;

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
	const impactCounts = { error: 0, warning: 0, notice: 0 };
	const counts = { violations: 0, passedUrls: 0, failedUrls: 0 };

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
			counts.failedUrls++;
		} else if (normViolations.length === 0) {
			counts.passedUrls++;
		}
		for (const violation of normViolations) {
			counts.violations++;
			if (violation.impact in impactCounts) {
				impactCounts[violation.impact]++;
			}
		}

		results.push({ url, scanError, violations: normViolations });
	}

	return {
		tool: 'pa11y-ci',
		standard,
		summary: {
			urls: urls.length,
			violations: counts.violations,
			errors: impactCounts.error,
			warnings: impactCounts.warning,
			notices: impactCounts.notice,
			passedUrls: counts.passedUrls,
			failedUrls: counts.failedUrls,
		},
		results,
	};
}

/**
 * Detect a URL-level load failure. pa11y-ci reports one as a bare
 * `{ message }` entry — no other field at all — unlike a real issue, which
 * always carries `code`/`type`/`runner`/etc. Checking "message is the only
 * key" matches that documented shape directly, rather than checking that a
 * few issue-only fields happen to be undefined.
 *
 * @param {Object} issue Raw pa11y results entry.
 * @return {boolean} True when the entry is a load failure, not an issue.
 */
function isScanError(issue) {
	return (
		issue !== null &&
		typeof issue === 'object' &&
		typeof issue.message === 'string' &&
		Object.keys(issue).length === 1
	);
}

/**
 * Coerce a possibly-missing/non-string raw field to a string.
 *
 * @param {*}      value      Raw field value.
 * @param {string} [fallback] Value to use when `value` isn't a string.
 * @return {string} `value` when it's a string, else `fallback`.
 */
function stringField(value, fallback = '') {
	return typeof value === 'string' ? value : fallback;
}

/**
 * Normalise a single pa11y issue.
 *
 * @param {Object} issue Raw pa11y issue.
 * @return {Object} Normalised violation.
 */
function normalizeIssue(issue) {
	const code = stringField(issue.code);
	const context = stringField(issue.context);
	const selector = stringField(issue.selector);

	return {
		id: code,
		wcagCriterion: parseWcagCriterion(code),
		impact: IMPACT_BY_TYPE[stringField(issue.type)] || 'error',
		runner: stringField(issue.runner, null),
		message: stringField(issue.message),
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
	const match = WCAG_CRITERION_RE.exec(code || '');
	if (!match) {
		return null;
	}
	return `${match[1]}.${match[2]}.${match[3]}`;
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
	const hints = {
		tagName: tagNameFrom(context, selector),
		classList: [],
		idAttr: null,
		attrs: {},
	};

	const openTag = OPEN_TAG_RE.exec(context || '');
	if (!openTag) {
		return hints;
	}

	// Global regex shared across calls (see regex.js) — reset before every
	// scan so a previous call's position doesn't cause missed attributes.
	ATTR_RE.lastIndex = 0;
	let attrMatch;
	while ((attrMatch = ATTR_RE.exec(openTag[0])) !== null) {
		const name = (attrMatch[1] || attrMatch[3]).toLowerCase();
		const value = attrMatch[2] !== undefined ? attrMatch[2] : attrMatch[4];
		assignAttr(hints, name, value);
	}

	return hints;
}

/**
 * Resolve the element's tag name: prefer the context HTML's own opening
 * tag, falling back to the last segment of the CSS selector when the
 * context has none.
 *
 * @param {string} context  Issue context HTML snippet.
 * @param {string} selector Issue CSS selector.
 * @return {string|null} Lowercased tag name, or null if neither has one.
 */
function tagNameFrom(context, selector) {
	const tagFromContext = TAG_FROM_CONTEXT_RE.exec(context || '');
	if (tagFromContext) {
		return tagFromContext[1].toLowerCase();
	}

	const segments = (selector || '')
		.split('>')
		.map((s) => s.trim())
		.filter(Boolean);
	const last = segments[segments.length - 1] || '';
	const tagFromSelector = TAG_FROM_SELECTOR_RE.exec(last);
	return tagFromSelector ? tagFromSelector[1].toLowerCase() : null;
}

/**
 * Assign one parsed `name="value"` attribute onto `hints`, routing `class`
 * and `id` to their dedicated fields and everything else into `attrs`.
 *
 * @param {Object} hints Hints object being built (mutated in place).
 * @param {string} name  Lowercased attribute name.
 * @param {string} value Attribute value.
 * @return {void}
 */
function assignAttr(hints, name, value) {
	if (name === 'class') {
		hints.classList = value.split(/\s+/).filter(Boolean);
		return;
	}
	if (name === 'id') {
		hints.idAttr = value;
		return;
	}
	hints.attrs[name] = value;
}

/**
 * Deterministic ordering: by impact, then id, then selector.
 *
 * @param {Object} violationA First violation.
 * @param {Object} violationB Second violation.
 * @return {number} Comparator result.
 */
function compareViolations(violationA, violationB) {
	const rankA = IMPACT_RANK[violationA.impact] ?? UNKNOWN_IMPACT_RANK;
	const rankB = IMPACT_RANK[violationB.impact] ?? UNKNOWN_IMPACT_RANK;
	if (rankA !== rankB) {
		return rankA - rankB;
	}
	if (violationA.id !== violationB.id) {
		return violationA.id < violationB.id ? -1 : 1;
	}
	if (violationA.selector !== violationB.selector) {
		return violationA.selector < violationB.selector ? -1 : 1;
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
