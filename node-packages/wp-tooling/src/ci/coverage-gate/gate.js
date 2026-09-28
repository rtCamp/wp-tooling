/**
 * The gate itself: intersect changed lines with a coverage report and decide.
 */

'use strict';

const path = require('path');

const DEFAULT_THRESHOLD = 80;

/**
 * What a changed source file missing from the report does to the verdict:
 * `warn` lists it and annotates a warning, `fail` fails the gate, `ignore`
 * lists it without an annotation. It never counts as covered either way.
 */
const UNMEASURED_POLICIES = ['warn', 'fail', 'ignore'];
const DEFAULT_UNMEASURED_POLICY = 'warn';

/**
 * Source files each report format can describe. Changed files outside these
 * are never looked up in the report, so a README edit is not "not measured".
 */
const SOURCE_PATTERNS = {
	clover: /\.php$/,
	lcov: /\.[cm]?[jt]sx?$/,
};

/**
 * Default exclude regex: test and dependency paths, which sit outside any
 * sensible coverage scope and would otherwise all surface as "not measured".
 */
const DEFAULT_EXCLUDE =
	/(?:^|\/)(?:tests?|__tests__|__mocks__|vendor|node_modules)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;

/**
 * Share of `covered` in `total` as a percentage, floored to two decimals so a
 * displayed 80% never hides a 79.996% that failed. Scales before dividing:
 * `(57 / 100) * 10000` is 5699.999…, which would floor to 56.99.
 *
 * @param {number} covered
 * @param {number} total
 * @return {number|null} Percentage, or `null` when `total` is 0.
 */
function toPercent(covered, total) {
	return total === 0 ? null : Math.floor((covered * 10000) / total) / 100;
}

/**
 * Normalise a path for comparison: forward slashes, no leading `./`.
 *
 * @param {string} filePath
 * @return {string} Normalised path.
 */
function normalisePath(filePath) {
	return filePath.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
}

/**
 * Pre-normalise report paths once so matching doesn't redo it per changed file.
 *
 * @param {string[]} reportPaths Paths as written in the report.
 * @return {Array<{ reportPath: string, normalised: string }>} Lookup entries.
 */
function indexReportPaths(reportPaths) {
	return reportPaths.map((reportPath) => ({
		reportPath,
		normalised: normalisePath(reportPath),
	}));
}

/**
 * Find the report entry for a changed file.
 *
 * Report paths are rarely repo-relative: Clover from wp-env carries container
 * paths (`/var/www/html/wp-content/plugins/<slug>/inc/Foo.php`), LCOV carries
 * absolute runner paths. A report path matches when it equals the diff path or
 * ends with `/<diff path>`. When several match, one that resolves to the same
 * absolute path under `root` wins; otherwise the match is ambiguous.
 *
 * @param {string}                                            diffPath Path relative to the working dir.
 * @param {Array<{ reportPath: string, normalised: string }>} index    From indexReportPaths().
 * @param {string}                                            [root]   Absolute working dir, used to break ties.
 * @return {{ match: string|null, ambiguous: string[] }} The matching report path, or the tied candidates.
 */
function matchReportFile(diffPath, index, root) {
	const target = normalisePath(diffPath);
	const candidates = index.filter(
		({ normalised }) =>
			normalised === target || normalised.endsWith(`/${target}`)
	);
	if (candidates.length <= 1) {
		return { match: candidates[0]?.reportPath ?? null, ambiguous: [] };
	}
	const absolute = root && normalisePath(path.resolve(root, diffPath));
	const exact = candidates.find(({ normalised }) => normalised === absolute);
	if (exact) {
		return { match: exact.reportPath, ambiguous: [] };
	}
	return {
		match: null,
		ambiguous: candidates.map(({ reportPath }) => reportPath),
	};
}

/**
 * Measure one changed file against its report hits.
 *
 * @param {string}              file
 * @param {Set<number>}         changedLines
 * @param {Map<number, number>} hits
 * @return {{ path: string, executable: number, covered: number, missed: number[] }} Per-file tally.
 */
function measureFile(file, changedLines, hits) {
	const executable = [...changedLines]
		.filter((lineNo) => hits.has(lineNo))
		.sort((a, b) => a - b);
	const missed = executable.filter((lineNo) => hits.get(lineNo) <= 0);
	return {
		path: file,
		executable: executable.length,
		covered: executable.length - missed.length,
		missed,
	};
}

/**
 * Intersect changed lines with the coverage report.
 *
 * Only changed lines the report marks executable enter the calculation. A
 * changed source file absent from the report is listed as unmeasured and
 * never counted as covered. The gate passes when nothing executable changed,
 * or when the covered share is at or above the threshold (below fails) — and,
 * under the `fail` policy, no changed source file is unmeasured. The threshold
 * is compared in whole hundredths of a percent, in integers, so a share
 * exactly at it passes (8 of 10 at 80, 147 of 1500 at 9.8).
 *
 * @param {Object}                           options
 * @param {Map<string, Set<number>>}         options.changed            Path → changed lines.
 * @param {Map<string, Map<number, number>>} options.report             Report path → line → hits.
 * @param {number}                           options.threshold          Minimum percentage (0-100, two decimals at most).
 * @param {string}                           [options.format]           `clover` or `lcov`; limits which files are looked up.
 * @param {RegExp|null}                      [options.exclude]          Changed paths to skip entirely.
 * @param {string}                           [options.root]             Absolute working dir, for tie-breaking matches.
 * @param {string}                           [options.unmeasuredPolicy] `warn` (default), `fail` or `ignore`.
 * @return {Object} `{ files, unmeasured, ambiguous, outOfScope, changedLines, coveredLines, percent, passed }`.
 */
function computeGate({
	changed,
	report,
	threshold,
	format,
	exclude = DEFAULT_EXCLUDE,
	root,
	unmeasuredPolicy = DEFAULT_UNMEASURED_POLICY,
}) {
	const index = indexReportPaths([...report.keys()]);
	const sourcePattern = SOURCE_PATTERNS[format];
	const isInScope = (file) =>
		(!sourcePattern || sourcePattern.test(file)) &&
		(!exclude || !exclude.test(file));

	const changedFiles = [...changed.keys()].sort();
	const outOfScope = changedFiles.filter((file) => !isInScope(file));
	const files = [];
	const unmeasured = [];
	const ambiguous = [];
	for (const file of changedFiles.filter(isInScope)) {
		const found = matchReportFile(file, index, root);
		if (found.match) {
			files.push(
				measureFile(file, changed.get(file), report.get(found.match))
			);
			continue;
		}
		unmeasured.push(file);
		if (found.ambiguous.length > 0) {
			ambiguous.push({ path: file, candidates: found.ambiguous });
		}
	}

	const changedLines = files.reduce(
		(sum, entry) => sum + entry.executable,
		0
	);
	const coveredLines = files.reduce((sum, entry) => sum + entry.covered, 0);
	const thresholdHundredths = Math.round(threshold * 100);
	const meetsThreshold =
		changedLines === 0 ||
		coveredLines * 10000 >= thresholdHundredths * changedLines;
	const unmeasuredFails =
		unmeasuredPolicy === 'fail' && unmeasured.length > 0;
	return {
		files,
		unmeasured,
		ambiguous,
		outOfScope,
		changedLines,
		coveredLines,
		percent: toPercent(coveredLines, changedLines),
		passed: meetsThreshold && !unmeasuredFails,
	};
}

module.exports = {
	computeGate,
	indexReportPaths,
	matchReportFile,
	toPercent,
	DEFAULT_EXCLUDE,
	DEFAULT_THRESHOLD,
	DEFAULT_UNMEASURED_POLICY,
	UNMEASURED_POLICIES,
};
