/**
 * a11y -- run pa11y-ci and emit normalized accessibility violations.
 *
 * Library API:
 *   const { runA11y } = require( '@rtcamp/wp-tooling/a11y' );
 *
 * CLI:
 *   wp-tooling a11y [options]
 *
 * URLs and scan defaults come from the project's pa11y config
 * (`.pa11yci.json`, or an explicit `--config` path) — the config is the
 * single source of truth. Zero runtime dependencies: Node built-ins plus
 * the project-installed `pa11y-ci` binary (`wp-tooling add setup/pa11y`
 * scaffolds a config and the dev dependency for projects that need one).
 */

'use strict';

const { execFileSync } = require('child_process');
const { RunnerError, isUsageError } = require('./errors');
const { resolveUrls } = require('./urls');
const { detectBin } = require('./resolve-bin');
const { normalizeA11y } = require('./normalize');
const { requireFlagValue } = require('../scaffolds/cli-support');

const BIN = 'pa11y-ci';
const INSTALL_HINT = 'wp-tooling add setup/pa11y';
const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Run pa11y-ci against the config's URLs and return the normalized report.
 *
 * @param {Object} [options]
 * @param {string} [options.configPath] Path to the pa11y config (default `.pa11yci.json`).
 * @param {string} [options.cwd]        Project root.
 * @return {Object} Normalized report (see normalize.js).
 * @throws {RunnerError} EBINMISSING / EBINFAIL / EBADJSON / ENOURLS.
 */
function runA11y(options = {}) {
	const cwd = options.cwd || process.cwd();
	// resolveUrls both resolves and validates the config (throws ENOURLS /
	// EBADJSON on problems); only the path is used below — pa11y-ci re-reads
	// and re-parses the same config file itself.
	const { configPath } = resolveUrls(options);

	const bin = detectBin(BIN, { cwd });
	if (!bin.available) {
		throw new RunnerError(
			'EBINMISSING',
			`${BIN} not found. Install it in the project (\`${INSTALL_HINT}\` sets it up).`,
			{ bin: BIN, install: INSTALL_HINT }
		);
	}

	const raw = execPa11y(bin.command, buildArgs(bin, configPath), cwd);
	return normalizeA11y(raw);
}

/**
 * Build the pa11y-ci argument vector. The config path is always passed
 * explicitly so the run uses exactly the config the runner resolved.
 *
 * @param {Object} bin        Resolved binary ({ command, args }).
 * @param {string} configPath Config path to hand to pa11y-ci.
 * @return {string[]} Argument vector.
 */
function buildArgs(bin, configPath) {
	return [...bin.args, '--json', '--config', configPath];
}

/**
 * Invoke pa11y-ci and return its parsed JSON report.
 *
 * pa11y-ci exits non-zero (typically 2) WHEN it finds violations -- that is a
 * successful run for us, and the report is still on stdout. So "the process
 * threw" and "stdout holds a usable report" are independent: a crashed run
 * can still have printed a good report, and a "successful" run can still
 * have printed garbage. Only "no usable report either way" is a genuine
 * failure — and only then does whether it also threw decide EBINFAIL vs
 * EBADJSON.
 *
 * @param {string}   command Binary command.
 * @param {string[]} args    Argument vector.
 * @param {string}   cwd     Working directory.
 * @return {Object} Parsed pa11y-ci report.
 * @throws {RunnerError} EBINFAIL / EBADJSON.
 */
function execPa11y(command, args, cwd) {
	const { stdout, crashDetail } = runPa11yProcess(command, args, cwd);

	const report = parseReport(stdout);
	if (report) {
		return report;
	}
	if (crashDetail !== null) {
		throw new RunnerError(
			'EBINFAIL',
			`${BIN} failed to run: ${crashDetail}`,
			{ detail: crashDetail }
		);
	}
	throw new RunnerError(
		'EBADJSON',
		`${BIN} produced output that could not be parsed as a JSON report.`
	);
}

/**
 * Run the pa11y-ci child process, tolerating the non-zero exit it uses both
 * for "found violations" and for a genuine crash — see execPa11y.
 *
 * @param {string}   command Binary command.
 * @param {string[]} args    Argument vector.
 * @param {string}   cwd     Working directory.
 * @return {{stdout: string, crashDetail: string|null}} stdout captured
 *   either way, and the crash detail when the process threw (else null).
 */
function runPa11yProcess(command, args, cwd) {
	try {
		const stdout = execFileSync(command, args, {
			cwd,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
			maxBuffer: MAX_BUFFER,
		});
		return { stdout, crashDetail: null };
	} catch (err) {
		return {
			stdout: (err.stdout || '').toString(),
			crashDetail: (err.stderr || err.message || '').toString().trim(),
		};
	}
}

/**
 * Parse pa11y-ci JSON output and confirm it carries the `results` key that
 * makes it a usable report — a bare parse success isn't enough.
 *
 * @param {string} text Raw stdout.
 * @return {Object|null} The parsed report, or null when `text` doesn't
 *   parse as one.
 */
function parseReport(text) {
	const parsed = tryParse(text);
	return parsed && parsed.results ? parsed : null;
}

/**
 * Parse pa11y-ci JSON, tolerating a leading non-JSON preamble line.
 *
 * @param {string} text Raw stdout.
 * @return {Object|null} Parsed object, or null when not parseable.
 */
function tryParse(text) {
	if (!text) {
		return null;
	}
	const start = text.indexOf('{');
	if (start === -1) {
		return null;
	}
	try {
		return JSON.parse(text.slice(start));
	} catch {
		return null;
	}
}

const VALID_OUTPUTS = ['text', 'json'];

/**
 * Parse argv (without leading `node` and script path).
 *
 * @param {string[]} argv Argument vector.
 * @return {Object} Parsed options.
 */
function parseArgs(argv) {
	const opts = { output: 'text' };
	let i = 0;
	while (i < argv.length) {
		const arg = argv[i];
		switch (arg) {
			case '--config':
				opts.configPath = requireFlagValue(argv[++i], '--config');
				break;
			case '--output':
				opts.output = requireFlagValue(argv[++i], '--output');
				break;
			case '--dry-run':
				opts.dryRun = true;
				break;
			case '--help':
			case '-h':
				opts.help = true;
				break;
			default:
				throw new Error(`unknown argument: ${arg}`);
		}
		i++;
	}
	return opts;
}

/**
 * Emit the normalized report in the requested output mode.
 *
 * @param {Object} report Normalized report.
 * @param {string} mode   'text' | 'json'.
 * @return {void}
 */
function emit(report, mode) {
	process.stdout.write(
		mode === 'json' ? formatJson(report) : formatText(report)
	);
}

/**
 * Render the report as JSON (the `--output json` mode).
 *
 * @param {Object} report Normalized report.
 * @return {string} The rendered text.
 */
function formatJson(report) {
	return JSON.stringify(report) + '\n';
}

/**
 * Render the report as a human-readable summary: one summary line, then a
 * block per URL (either its scan error, or its violations).
 *
 * @param {Object} report Normalized report.
 * @return {string} The rendered text.
 */
function formatText(report) {
	const lines = [formatSummaryLine(report)];
	for (const result of report.results) {
		lines.push('', ...formatUrlResult(result));
	}
	lines.push('');
	return lines.join('\n');
}

/**
 * Build the one-line report summary.
 *
 * @param {Object} report Normalized report.
 * @return {string} The summary line.
 */
function formatSummaryLine(report) {
	const s = report.summary;
	const failed = s.failedUrls > 0 ? `, ${s.failedUrls} failed to load` : '';
	return `${report.tool} (${report.standard}): ${s.violations} violation(s) across ${s.urls} URL(s) — ${s.errors} error, ${s.warnings} warning, ${s.notices} notice; ${s.passedUrls} clean${failed}.`;
}

/**
 * Build the text block for a single URL's result: its scan error, or its
 * violation list.
 *
 * @param {Object} result One entry of `report.results`.
 * @return {string[]} Lines for this URL (no leading/trailing blank line).
 */
function formatUrlResult(result) {
	if (result.scanError) {
		return [`${result.url} — scan failed`, `  ${result.scanError}`];
	}
	const lines = [`${result.url} — ${result.violations.length} violation(s)`];
	for (const violation of result.violations) {
		const crit = violation.wcagCriterion ? ` [${violation.wcagCriterion}]` : '';
		lines.push(
			`  ${violation.impact}${crit} ${violation.selector}`,
			`    ${violation.message}`
		);
	}
	return lines;
}

/**
 * Print CLI usage.
 *
 * @return {void}
 */
function printUsage() {
	process.stdout.write(
		[
			'Usage: a11y [options]',
			'',
			'  Runs pa11y-ci against the URLs in the project pa11y config and',
			'  prints normalized accessibility violations. Requires a pa11y config',
			'  and the pa11y-ci dev dependency (`wp-tooling add setup/pa11y` sets',
			'  both up for projects that have neither).',
			'',
			'  --config <path>        Path to the pa11y config (default: .pa11yci.json).',
			'  --output <text|json>   Output format (default: text).',
			'  --dry-run              Print the resolved binary, URLs and command; run nothing.',
			'  --help, -h             Print this help.',
			'',
			'Exit codes: 0 clean · 1 run failure or unreachable URL · 2 usage or binary missing · 3 violations found.',
			'',
		].join('\n')
	);
}

/**
 * Print the dry-run plan (resolved binary, config, URLs, command) without
 * running.
 *
 * @param {Object} opts Parsed options.
 * @param {string} cwd  Working directory.
 * @return {number} Exit code.
 */
function runDryRun(opts, cwd) {
	let urlInfo;
	try {
		urlInfo = resolveUrls({ configPath: opts.configPath, cwd });
	} catch (err) {
		return handleError(err);
	}

	const bin = detectBin(BIN, { cwd });
	const args = buildArgs(bin, urlInfo.configPath);
	const binState = bin.available ? bin.version : 'NOT FOUND';

	process.stdout.write(
		[
			'[dry-run] a11y would run:',
			`  binary:  ${bin.command} (${bin.source}, ${binState})`,
			`  config:  ${urlInfo.configPath}`,
			`  urls:    ${urlInfo.urls.join(', ')}`,
			`  command: ${bin.command} ${args.join(' ')}`,
			'',
		].join('\n')
	);
	return 0;
}

/**
 * Map a thrown error to an exit code and a stderr message.
 *
 * @param {Error} err The error.
 * @return {number} Exit code: 2 (usage / binary missing), 1 (run failure).
 */
function handleError(err) {
	process.stderr.write(`a11y: ${err.message}\n`);
	return isUsageError(err) ? 2 : 1;
}

/**
 * Run the CLI. Returns the intended exit code.
 *
 * @param {string[]} argv argv slice (without `node` and script path).
 * @return {number} 0 clean · 1 run failure or unreachable URL · 2 usage/binary-missing · 3 violations found.
 */
function runCli(argv) {
	let opts;
	try {
		opts = parseArgs(argv);
	} catch (err) {
		process.stderr.write(`a11y: ${err.message}\n`);
		return 2;
	}

	if (opts.help) {
		printUsage();
		return 0;
	}

	if (!VALID_OUTPUTS.includes(opts.output)) {
		process.stderr.write(
			`a11y: invalid --output "${opts.output}" (expected one of: ${VALID_OUTPUTS.join(
				', '
			)})\n`
		);
		return 2;
	}

	const cwd = process.cwd();

	if (opts.dryRun) {
		return runDryRun(opts, cwd);
	}

	let report;
	try {
		report = runA11y({ configPath: opts.configPath, cwd });
	} catch (err) {
		return handleError(err);
	}

	emit(report, opts.output);
	if (report.summary.failedUrls > 0) {
		process.stderr.write(
			`a11y: ${report.summary.failedUrls} URL(s) failed to load — treating as a run failure.\n`
		);
		return 1;
	}
	return report.summary.violations > 0 ? 3 : 0;
}

module.exports = { runA11y, runCli };
