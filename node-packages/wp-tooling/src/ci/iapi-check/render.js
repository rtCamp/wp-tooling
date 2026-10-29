/**
 * Output rendering for iapi-check: text report, JSON, Markdown job summary,
 * GitHub annotations and step outputs. Pure string builders; nothing here
 * writes anywhere.
 *
 * File paths come from the repository, so they are untrusted: every output
 * neutralises them with the coverage-gate helpers (printable(), codeSpan(),
 * escapeTableCell(), annotation()), so a crafted name can't start a workflow
 * command or inject Markdown.
 */

'use strict';

const {
	annotation,
	codeSpan,
	escapeTableCell,
	plural,
	printable,
} = require('../coverage-gate/render');
const { SOURCE_URL, WP_RELEASE_DATE, WP_VERSION } = require('./rules');

const SUMMARY_HEADING = `### Interactivity API check for WordPress ${WP_VERSION}`;

/** Rows past this are counted, not listed: the job summary is capped at 1 MiB. */
const MAX_SUMMARY_ROWS = 200;

const SEVERITY_WIDTH = 'warning'.length;

/**
 * Number of distinct files with findings.
 *
 * @param {Object} result checkIapi() result.
 * @return {number} File count.
 */
function filesWithFindings(result) {
	return new Set(result.findings.map((finding) => finding.file)).size;
}

/**
 * One-line verdict shared by every output.
 *
 * @param {Object} result checkIapi() result.
 * @return {string} Verdict sentence.
 */
function verdictLine(result) {
	const scanned = `${plural(result.filesScanned, 'file')} scanned`;
	if (result.findings.length === 0) {
		return `No findings (${scanned}).`;
	}
	return `${plural(result.errors, 'error')} and ${plural(result.warnings, 'warning')} in ${plural(filesWithFindings(result), 'file')} (${scanned}).`;
}

/**
 * Render the text report: findings grouped by file, then the count line.
 * Every line starts with a fixed token or a digit (never a path), so the
 * Actions runner can't read a crafted path as `::command::`.
 *
 * @param {Object} result checkIapi() result.
 * @return {string} Plain text ending in a newline.
 */
function formatText(result) {
	const rows = [];
	let currentFile = null;
	for (const finding of result.findings) {
		if (finding.file !== currentFile) {
			currentFile = finding.file;
			rows.push(`  - ${printable(finding.file)}`);
		}
		rows.push(
			`      ${finding.line}:${finding.column}  ${finding.severity.padEnd(SEVERITY_WIDTH)}  ${finding.rule}  ${printable(finding.message)}`
		);
	}
	rows.push(`iapi-check: ${verdictLine(result)}`);
	return rows.join('\n') + '\n';
}

/**
 * Render the JSON report.
 *
 * @param {Object} result checkIapi() result.
 * @return {string} One JSON object and a newline.
 */
function formatJson(result) {
	return (
		JSON.stringify({
			filesScanned: result.filesScanned,
			errors: result.errors,
			warnings: result.warnings,
			findings: result.findings,
		}) + '\n'
	);
}

/**
 * Render one summary table row.
 *
 * @param {Object} finding
 * @return {string} Markdown table row.
 */
function summaryRow(finding) {
	const file = codeSpan(printable(escapeTableCell(finding.file)));
	const message = printable(escapeTableCell(finding.message));
	return `| ${file} | ${finding.line}:${finding.column} | ${finding.severity} | \`${finding.rule}\` | ${message} |`;
}

/**
 * Render the `$GITHUB_STEP_SUMMARY` Markdown.
 *
 * @param {Object}  result                   checkIapi() result.
 * @param {Object}  [options]
 * @param {boolean} [options.softFail=false] Note that errors were reported as warnings.
 * @return {string} Markdown ending in a newline.
 */
function formatSummary(result, { softFail = false } = {}) {
	let icon = '✅';
	if (result.errors > 0) {
		icon = '❌';
	} else if (result.warnings > 0) {
		icon = '⚠️';
	}
	const softFailNote =
		softFail && result.errors > 0
			? ' Reported as warnings because of --soft-fail.'
			: '';
	const rows = [
		SUMMARY_HEADING,
		'',
		`${icon} ${verdictLine(result)}${softFailNote}`,
		'',
	];
	if (result.findings.length === 0) {
		return rows.join('\n') + '\n';
	}
	const shown = result.findings.slice(0, MAX_SUMMARY_ROWS);
	rows.push(
		`WordPress ${WP_VERSION} (due ${WP_RELEASE_DATE}) removes these deprecated Interactivity API behaviors ([WordPress/gutenberg#84098](${SOURCE_URL})): errors stop working in ${WP_VERSION}, warnings are deprecated and break in a later release.`,
		'',
		'| File | Line:col | Severity | Rule | Message |',
		'|---|---:|---|---|---|',
		...shown.map(summaryRow),
		''
	);
	if (result.findings.length > shown.length) {
		rows.push(
			`${plural(result.findings.length - shown.length, 'more finding')} not listed; run \`npx wp-tooling iapi-check\` for all of them.`,
			''
		);
	}
	return rows.join('\n') + '\n';
}

/**
 * Build one annotation per finding.
 *
 * @param {Object}  result                   checkIapi() result.
 * @param {Object}  [options]
 * @param {string}  [options.prefix='']      Working dir relative to the repo root (`''` or `sub/dir/`), so annotations land on the right file.
 * @param {boolean} [options.softFail=false] Annotate every finding as a warning.
 * @return {string[]} Workflow command lines.
 */
function buildAnnotations(result, { prefix = '', softFail = false } = {}) {
	return result.findings.map((finding) =>
		annotation(softFail ? 'warning' : finding.severity, finding.message, {
			file: prefix + finding.file,
			line: finding.line,
			col: finding.column,
			title: `iapi-check: ${finding.rule}`,
		})
	);
}

/**
 * Step outputs for a result.
 *
 * @param {Object} result checkIapi() result.
 * @return {Object<string, number>} Output name → value.
 */
function stepOutputs(result) {
	return {
		findings: result.findings.length,
		errors: result.errors,
		warnings: result.warnings,
	};
}

module.exports = {
	buildAnnotations,
	formatJson,
	formatSummary,
	formatText,
	stepOutputs,
	verdictLine,
	MAX_SUMMARY_ROWS,
};
