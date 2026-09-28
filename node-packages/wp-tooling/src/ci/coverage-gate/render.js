/**
 * Output rendering: text report, Markdown job summary, GitHub annotations and
 * step outputs. Pure string builders — nothing here writes anywhere.
 *
 * File paths come from the pull request, so they are untrusted: every output
 * neutralises them (see printable(), codeSpan(), escapeData()) so a crafted
 * name can't start a workflow command or inject Markdown/HTML.
 */

'use strict';

const { toPercent, DEFAULT_UNMEASURED_POLICY } = require('./gate');

const SUMMARY_HEADING = '### Changed-line coverage';
const EMPTY_CELL = '—';

const UNMEASURED_NOTE =
	'These changed files are missing from the coverage report, so they are not counted. A file no test loads is left out unless PHPUnit includes uncovered files (`processUncoveredFiles="true"` on PHPUnit 9, `<source>` on 10+) or Jest sets `collectCoverageFrom`.';

/**
 * Collapse sorted line numbers into ranges: `[3,4,5,9]` → `3-5, 9`.
 *
 * @param {number[]} lines Sorted ascending.
 * @return {string} Comma-separated ranges.
 */
function formatRanges(lines) {
	const ranges = [];
	let start = 0;
	while (start < lines.length) {
		let end = start;
		while (end + 1 < lines.length && lines[end + 1] === lines[end] + 1) {
			end++;
		}
		ranges.push(
			start === end ? `${lines[start]}` : `${lines[start]}-${lines[end]}`
		);
		start = end + 1;
	}
	return ranges.join(', ');
}

/**
 * Pluralise a count: `1 file`, `2 files`.
 *
 * @param {number} count
 * @param {string} noun  Singular form.
 * @return {string} Count and noun.
 */
function plural(count, noun) {
	return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * One-line verdict shared by every output.
 *
 * @param {Object} result    computeGate() result.
 * @param {number} threshold
 * @return {string} Verdict sentence.
 */
function verdictLine(result, threshold) {
	const parts = [
		result.changedLines === 0
			? 'No measured executable lines changed'
			: `${result.coveredLines} of ${result.changedLines} changed executable lines covered (${result.percent}%); threshold ${threshold}%`,
	];
	if (result.unmeasured.length > 0) {
		parts.push(
			`${plural(result.unmeasured.length, 'changed file')} not in the coverage report`
		);
	}
	return `${parts.join('; ')} — ${result.passed ? 'passed' : 'failed'}.`;
}

/**
 * Make a path safe to print on one line: control characters (newlines
 * included) become visible `\xNN` escapes.
 *
 * @param {string} text
 * @return {string} Text with no control characters.
 */
function printable(text) {
	return String(text).replace(
		/\p{Cc}/gu,
		(char) => `\\x${char.codePointAt(0).toString(16).padStart(2, '0')}`
	);
}

/**
 * Escape a Markdown table cell. Backslashes are escaped too, so a `\` right
 * before a `|` can't cancel the pipe's escape and split the cell.
 *
 * @param {string} text
 * @return {string} Text with `\` and `|` escaped.
 */
function escapeTableCell(text) {
	return String(text).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

/**
 * Wrap text in a Markdown code span that its own backticks can't close: the
 * fence is one backtick longer than the longest run inside, padded with a
 * space when the text starts or ends with a backtick or space.
 *
 * @param {string} text Printable text (no line breaks).
 * @return {string} Code span.
 */
function codeSpan(text) {
	const longestRun = (text.match(/`+/g) ?? []).reduce(
		(longest, run) => Math.max(longest, run.length),
		0
	);
	const fence = '`'.repeat(longestRun + 1);
	const pad = /^[` ]|[` ]$/.test(text) ? ' ' : '';
	return `${fence}${pad}${text}${pad}${fence}`;
}

/**
 * Render one per-file row of the summary table.
 *
 * @param {Object} entry computeGate() `files[]` entry.
 * @return {string} Markdown table row.
 */
function summaryRow(entry) {
	const percent = toPercent(entry.covered, entry.executable);
	const percentCell = percent === null ? EMPTY_CELL : `${percent}%`;
	const missedCell = formatRanges(entry.missed) || EMPTY_CELL;
	const pathCell = codeSpan(printable(escapeTableCell(entry.path)));
	return `| ${pathCell} | ${entry.executable} | ${entry.covered} | ${percentCell} | ${missedCell} |`;
}

/**
 * Render one "Not measured" list item, flagging ambiguous matches.
 *
 * @param {string}   file
 * @param {string[]} ambiguousPaths Changed paths that matched several report entries.
 * @return {string} Markdown list item.
 */
function unmeasuredItem(file, ambiguousPaths) {
	const note = ambiguousPaths.includes(file)
		? ' (several report entries match; ambiguous)'
		: '';
	return `- ${codeSpan(printable(file))}${note}`;
}

/**
 * Count of changed files the gate did not look at, shared by every output.
 *
 * @param {Object} result computeGate() result.
 * @return {string} Sentence naming the out-of-scope count.
 */
function outOfScopeLine(result) {
	return `${plural(result.outOfScope.length, 'other changed file')} not checked: not a source type this report covers, or excluded.`;
}

/**
 * Render the `$GITHUB_STEP_SUMMARY` Markdown.
 *
 * @param {Object} result    computeGate() result.
 * @param {number} threshold
 * @return {string} Markdown ending in a newline.
 */
function formatSummary(result, threshold) {
	const icon = result.passed ? '✅' : '❌';
	const rows = [
		SUMMARY_HEADING,
		'',
		`${icon} ${verdictLine(result, threshold)}`,
		'',
	];
	if (result.files.length > 0) {
		rows.push(
			'| File | Changed executable lines | Covered | % | Missed lines |',
			'|---|---:|---:|---:|---|',
			...result.files.map(summaryRow),
			''
		);
	}
	if (result.unmeasured.length > 0) {
		const ambiguousPaths = result.ambiguous.map((item) => item.path);
		rows.push(
			'#### Not measured',
			'',
			UNMEASURED_NOTE,
			'',
			...result.unmeasured.map((file) =>
				unmeasuredItem(file, ambiguousPaths)
			),
			''
		);
	}
	if (result.outOfScope.length > 0) {
		rows.push(outOfScopeLine(result), '');
	}
	return rows.join('\n') + '\n';
}

/**
 * Render the Markdown summary for a skipped gate.
 *
 * @param {string} message Why it was skipped.
 * @return {string} Markdown ending in a newline.
 */
function formatSkipSummary(message) {
	return `${SUMMARY_HEADING}\n\n${message}\n`;
}

/**
 * Render the text-mode report. Every line starts with a fixed token (never a
 * path), so the Actions runner can't read a crafted path as `::command::`.
 *
 * @param {Object} result    computeGate() result.
 * @param {number} threshold
 * @return {string} Plain text ending in a newline.
 */
function formatText(result, threshold) {
	const rows = [`coverage-gate: ${verdictLine(result, threshold)}`];
	for (const entry of result.files) {
		const missed = entry.missed.length
			? `  missed: ${formatRanges(entry.missed)}`
			: '';
		rows.push(
			`  - ${printable(entry.path)}  ${entry.covered}/${entry.executable}${missed}`
		);
	}
	if (result.unmeasured.length > 0) {
		rows.push(
			'not measured (missing from the report):',
			...result.unmeasured.map((file) => `  - ${printable(file)}`)
		);
	}
	if (result.outOfScope.length > 0) {
		rows.push(outOfScopeLine(result));
	}
	return rows.join('\n') + '\n';
}

/**
 * Escape a workflow-command message.
 *
 * @param {string} value
 * @return {string} Escaped value.
 */
function escapeData(value) {
	return String(value)
		.replace(/%/g, '%25')
		.replace(/\r/g, '%0D')
		.replace(/\n/g, '%0A');
}

/**
 * Escape a workflow-command property value (also `:` and `,`).
 *
 * @param {string} value
 * @return {string} Escaped value.
 */
function escapeProperty(value) {
	return escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

/**
 * Build one GitHub workflow command, e.g. `::warning file=a.php,line=3::msg`.
 *
 * @param {string} level           `notice`, `warning` or `error`.
 * @param {string} message
 * @param {Object} [location]
 * @param {string} [location.file] Path relative to the repo root. Control
 *                                 characters are made visible, so a name
 *                                 carrying terminal escapes can't restyle the
 *                                 log — at the cost of not attaching to it.
 * @param {number} [location.line]
 * @return {string} The command line.
 */
function annotation(level, message, { file, line } = {}) {
	const props = [];
	if (file) {
		props.push(`file=${escapeProperty(printable(file))}`);
	}
	if (line) {
		props.push(`line=${line}`);
	}
	const head = props.length > 0 ? `${level} ${props.join(',')}` : level;
	return `::${head}::${escapeData(message)}`;
}

/**
 * Annotation level for unmeasured files under a policy.
 *
 * @param {string} policy       `warn`, `fail` or `ignore`.
 * @param {string} failureLevel Level used for failures (`error`, or `warning` under --soft-fail).
 * @return {string|null} Level, or `null` for no annotation.
 */
function unmeasuredLevel(policy, failureLevel) {
	if (policy === 'ignore') {
		return null;
	}
	return policy === 'fail' ? failureLevel : 'warning';
}

/**
 * Build the annotations for a result.
 *
 * @param {Object} result                     computeGate() result.
 * @param {number} threshold
 * @param {Object} [options]
 * @param {string} [options.prefix]           Working dir relative to the repo root (`''` or `sub/dir/`), so annotations land on the right file.
 * @param {string} [options.failureLevel]     `error` (default), or `warning` under --soft-fail.
 * @param {string} [options.unmeasuredPolicy] `warn` (default), `fail` or `ignore`.
 * @return {string[]} Workflow command lines.
 */
function buildAnnotations(
	result,
	threshold,
	{
		prefix = '',
		failureLevel = 'error',
		unmeasuredPolicy = DEFAULT_UNMEASURED_POLICY,
	} = {}
) {
	const annotations = [];
	const unmeasuredAs = unmeasuredLevel(unmeasuredPolicy, failureLevel);
	if (unmeasuredAs) {
		const ambiguousPaths = result.ambiguous.map((item) => item.path);
		for (const file of result.unmeasured) {
			const reason = ambiguousPaths.includes(file)
				? 'Several coverage report entries match this file, so its lines are not measured.'
				: 'Changed file is missing from the coverage report, so its lines are not measured.';
			annotations.push(
				annotation(unmeasuredAs, reason, { file: prefix + file })
			);
		}
	}
	for (const entry of result.files) {
		if (entry.missed.length === 0) {
			continue;
		}
		annotations.push(
			annotation(
				'warning',
				`Changed lines not covered by tests: ${formatRanges(entry.missed)}`,
				{ file: prefix + entry.path, line: entry.missed[0] }
			)
		);
	}
	if (!result.passed) {
		annotations.push(
			annotation(failureLevel, verdictLine(result, threshold))
		);
	} else if (result.changedLines === 0) {
		annotations.push(annotation('notice', verdictLine(result, threshold)));
	}
	return annotations;
}

/**
 * Step outputs for a result.
 *
 * @param {Object} result computeGate() result.
 * @return {Object<string, string|number|boolean>} Output name → value.
 */
function stepOutputs(result) {
	return {
		'changed-lines': result.changedLines,
		'covered-lines': result.coveredLines,
		percent: result.percent ?? '',
		'unmeasured-files': result.unmeasured.length,
		passed: result.passed,
	};
}

module.exports = {
	annotation,
	buildAnnotations,
	formatRanges,
	formatSkipSummary,
	formatSummary,
	formatText,
	stepOutputs,
};
