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
const { RunnerError } = require('./errors');
const { resolveUrls } = require('./urls');
const { detectBin } = require('./resolve-bin');
const { normalizeA11y } = require('./normalize');

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
 * successful run for us, and the report is still on stdout. Only a run that
 * yields no parseable report is a genuine failure.
 *
 * @param {string}   command Binary command.
 * @param {string[]} args    Argument vector.
 * @param {string}   cwd     Working directory.
 * @return {Object} Parsed pa11y-ci report.
 * @throws {RunnerError} EBINFAIL / EBADJSON.
 */
function execPa11y(command, args, cwd) {
	let stdout;
	try {
		stdout = execFileSync(command, args, {
			cwd,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
			maxBuffer: MAX_BUFFER,
		});
	} catch (err) {
		const parsed = tryParse((err.stdout || '').toString());
		if (parsed && parsed.results) {
			return parsed;
		}
		const detail = (err.stderr || err.message || '').toString().trim();
		throw new RunnerError('EBINFAIL', `${BIN} failed to run: ${detail}`, {
			detail,
		});
	}

	const parsed = tryParse(stdout);
	if (!parsed || !parsed.results) {
		throw new RunnerError(
			'EBADJSON',
			`${BIN} produced output that could not be parsed as a JSON report.`
		);
	}
	return parsed;
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
 * Consume the argv slot at `index` as a value for `flag`.
 *
 * @param {string[]} argv  Argument vector.
 * @param {number}   index Position of the value.
 * @param {string}   flag  Flag name, for the error message.
 * @return {string} The validated value.
 */
function takeValue(argv, index, flag) {
	const value = argv[index];
	if (value === undefined || value.startsWith('-')) {
		throw new Error(`missing value for ${flag}`);
	}
	return value;
}

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
				opts.configPath = takeValue(argv, ++i, '--config');
				break;
			case '--output':
				opts.output = takeValue(argv, ++i, '--output');
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
	if (mode === 'json') {
		process.stdout.write(JSON.stringify(report) + '\n');
		return;
	}
	const s = report.summary;
	const failed = s.failedUrls > 0 ? `, ${s.failedUrls} failed to load` : '';
	const lines = [
		`${report.tool} (${report.standard}): ${s.violations} violation(s) across ${s.urls} URL(s) — ${s.errors} error, ${s.warnings} warning, ${s.notices} notice; ${s.passedUrls} clean${failed}.`,
	];
	for (const r of report.results) {
		lines.push('');
		if (r.scanError) {
			lines.push(`${r.url} — scan failed`);
			lines.push(`  ${r.scanError}`);
			continue;
		}
		lines.push(`${r.url} — ${r.violations.length} violation(s)`);
		for (const v of r.violations) {
			const crit = v.wcagCriterion ? ` [${v.wcagCriterion}]` : '';
			lines.push(`  ${v.impact}${crit} ${v.selector}`);
			lines.push(`    ${v.message}`);
		}
	}
	lines.push('');
	process.stdout.write(lines.join('\n'));
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
	if (
		err instanceof RunnerError &&
		(err.code === 'EBINMISSING' || err.code === 'ENOURLS')
	) {
		return 2;
	}
	return 1;
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
