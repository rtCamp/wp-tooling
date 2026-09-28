/**
 * `wp-tooling coverage-gate` CLI adapter: flags → config → gate → output.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { takeValue, formatGithubLine } = require('../detect-changes');
const { GateError } = require('./errors');
const { gitChangedLines, repoPrefix, resolveGateBase } = require('./diff');
const { parseReport, inferFormat, REPORT_FORMATS } = require('./reports');
const {
	computeGate,
	DEFAULT_EXCLUDE,
	DEFAULT_THRESHOLD,
	DEFAULT_UNMEASURED_POLICY,
	UNMEASURED_POLICIES,
} = require('./gate');
const {
	annotation,
	buildAnnotations,
	formatSkipSummary,
	formatSummary,
	formatText,
	stepOutputs,
} = require('./render');

const OUTPUT_MODES = ['text', 'github'];

/**
 * Flags that take a value, → option key. An empty value counts as not given,
 * so a workflow can pass `--threshold "${{ inputs.coverage-threshold }}"`
 * whether or not the input is set.
 */
const VALUE_FLAGS = {
	'--report': 'report',
	'--format': 'format',
	'--threshold': 'threshold',
	'--base': 'base',
	'--working-dir': 'workingDir',
	'--exclude': 'exclude',
	'--unmeasured': 'unmeasured',
	'--output': 'output',
};

/** Boolean flags, → option key. */
const BOOLEAN_FLAGS = {
	'--no-exclude': 'noExclude',
	'--soft-fail': 'softFail',
	'--dry-run': 'dryRun',
	'--help': 'help',
	'-h': 'help',
};

/** A plain decimal from 0 to 100: no sign, exponent, hex or whitespace. */
const THRESHOLD_RE = /^\d{1,3}(?:\.\d+)?$/;

const NO_BASE_MESSAGE =
	'No pull request base to diff against (not a pull_request event and no --base); coverage gate skipped.';

/** A result for a skipped gate, shaped like a computeGate() result. */
const EMPTY_RESULT = {
	files: [],
	unmeasured: [],
	ambiguous: [],
	outOfScope: [],
	changedLines: 0,
	coveredLines: 0,
	percent: null,
	passed: true,
};

const USAGE = [
	'Usage: coverage-gate --report <path> [options]',
	'',
	'Fail when too few of the lines this pull request changed are covered by tests.',
	'Only added or modified lines the report marks executable count; deleted lines,',
	'blank lines, comments and declarations never do. Only committed changes',
	'(merge base ... HEAD) are measured; uncommitted work is ignored.',
	'',
	'  --report <path>               Coverage report, relative to --working-dir. Required.',
	'  --format <clover|lcov>        Report format. Inferred from the extension when omitted',
	'                                (.xml → clover, .info → lcov).',
	`  --threshold <0-100>           Minimum % of changed executable lines covered (default: ${DEFAULT_THRESHOLD}).`,
	'                                Below the threshold fails; exactly at it passes.',
	'  --base <ref>                  Ref or SHA to diff against (merge base ... HEAD). Default: the',
	'                                pull request base from $GITHUB_EVENT_PATH / $GITHUB_BASE_REF.',
	'                                With neither, the gate is skipped with a notice (push events).',
	'  --working-dir <path>          Only changed files under this directory are considered (default: .).',
	'  --exclude <regex>             Changed paths to ignore. Default skips tests/, vendor/,',
	'                                node_modules/ and *.test.js / *.spec.js.',
	'  --no-exclude                  Ignore nothing (overrides --exclude and the default).',
	'  --unmeasured <policy>         Changed source files missing from the report: warn (default;',
	'                                list and annotate), fail (fail the gate), ignore (list only).',
	'  --output <text|github>        text prints to stdout; github also writes step outputs',
	'                                (changed-lines, covered-lines, percent, unmeasured-files,',
	'                                passed), a $GITHUB_STEP_SUMMARY table and annotations (default: text).',
	'  --soft-fail                   Report, but always exit 0; failures annotate as warnings.',
	'                                For rollout, not normal use.',
	'  --dry-run                     With --output github, print what would be written or',
	'                                annotated instead, without emitting workflow commands.',
	'  --help, -h                    Print this help.',
	'',
	'An empty flag value counts as not given. The history must include the base',
	'commit (actions/checkout with fetch-depth: 0).',
	'',
	'Files missing from the report are listed as "not measured" and never counted as',
	'covered. A new file no test loads is only in the report when the tool is told to',
	'include uncovered files:',
	'  PHPUnit 9    <coverage processUncoveredFiles="true"> in phpunit.xml.dist',
	'  PHPUnit 10+  a <source><include> block in phpunit.xml.dist',
	'  Jest         collectCoverageFrom in the Jest config',
	'',
	'Exit codes: 0 passed or nothing to measure · 1 below threshold or unmeasured',
	'            under --unmeasured fail · 2 usage error, unreadable/empty report, or git failure.',
	'',
].join('\n');

/**
 * Parse argv (after the subcommand name) into raw option values.
 *
 * @param {string[]} argv
 * @return {Object} Option key → raw string, or `true` for boolean flags.
 */
function parseArgs(argv) {
	const opts = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (Object.hasOwn(BOOLEAN_FLAGS, arg)) {
			opts[BOOLEAN_FLAGS[arg]] = true;
			continue;
		}
		if (!Object.hasOwn(VALUE_FLAGS, arg)) {
			throw new Error(`unknown argument: ${arg}`);
		}
		const value = takeValue(argv, ++i, arg);
		if (value !== '') {
			opts[VALUE_FLAGS[arg]] = value;
		}
	}
	return opts;
}

/**
 * Check a raw value against the allowed choices, or fall back to a default.
 *
 * @param {string|undefined} raw
 * @param {string[]}         choices
 * @param {string}           fallback
 * @param {string}           flag     Flag name, for the error message.
 * @return {string} The chosen value.
 */
function parseChoice(raw, choices, fallback, flag) {
	if (raw === undefined) {
		return fallback;
	}
	if (!choices.includes(raw)) {
		throw new Error(
			`invalid ${flag} "${raw}" (expected one of: ${choices.join(', ')})`
		);
	}
	return raw;
}

/**
 * Resolve `--format`, inferring it from the report name when omitted.
 *
 * @param {string|undefined} raw
 * @param {string}           report
 * @return {string} `clover` or `lcov`.
 */
function parseFormat(raw, report) {
	if (raw !== undefined) {
		return parseChoice(raw, REPORT_FORMATS, undefined, '--format');
	}
	const inferred = inferFormat(report);
	if (!inferred) {
		throw new Error(
			`cannot infer the format of "${report}"; pass --format clover|lcov`
		);
	}
	return inferred;
}

/**
 * Resolve `--threshold`.
 *
 * @param {string|undefined} raw
 * @return {number} 0–100.
 */
function parseThreshold(raw) {
	if (raw === undefined) {
		return DEFAULT_THRESHOLD;
	}
	const threshold = Number(raw);
	if (!THRESHOLD_RE.test(raw) || threshold > 100) {
		throw new Error(
			`invalid --threshold "${raw}" (expected a number from 0 to 100)`
		);
	}
	return threshold;
}

/**
 * Resolve `--exclude` / `--no-exclude`.
 *
 * @param {string|undefined} raw
 * @param {boolean}          disabled `--no-exclude` given.
 * @return {RegExp|null} Exclude pattern, or `null` to exclude nothing.
 */
function parseExclude(raw, disabled) {
	if (disabled) {
		return null;
	}
	if (raw === undefined) {
		return DEFAULT_EXCLUDE;
	}
	try {
		return new RegExp(raw);
	} catch (err) {
		throw new Error(`invalid --exclude regex "${raw}" (${err.message})`);
	}
}

/**
 * Validate raw options and resolve every default.
 *
 * @param {Object} opts parseArgs() result.
 * @param {Object} env  Environment: base resolution and `$GITHUB_*` file paths.
 * @return {Object} Run config.
 */
function resolveConfig(opts, env) {
	const output = parseChoice(opts.output, OUTPUT_MODES, 'text', '--output');
	if (!opts.report) {
		throw new Error('--report <path> is required');
	}
	const root = path.resolve(opts.workingDir ?? '.');
	const softFail = opts.softFail === true;
	return {
		reportPath: path.resolve(root, opts.report),
		format: parseFormat(opts.format, opts.report),
		threshold: parseThreshold(opts.threshold),
		exclude: parseExclude(opts.exclude, opts.noExclude === true),
		unmeasuredPolicy: parseChoice(
			opts.unmeasured,
			UNMEASURED_POLICIES,
			DEFAULT_UNMEASURED_POLICY,
			'--unmeasured'
		),
		base: opts.base,
		root,
		env,
		github: output === 'github',
		dryRun: opts.dryRun === true,
		softFail,
		failureLevel: softFail ? 'warning' : 'error',
	};
}

/**
 * Print workflow commands, or — under --dry-run — print them prefixed so the
 * runner does not act on them.
 *
 * @param {string[]} commands Workflow command lines.
 * @param {Object}   config   resolveConfig() result.
 */
function emitAnnotations(commands, config) {
	if (commands.length === 0) {
		return;
	}
	const lines = config.dryRun
		? commands.map((command) => `[dry-run] would emit: ${command}`)
		: commands;
	process.stdout.write(lines.join('\n') + '\n');
}

/**
 * Append to the file a GitHub Actions environment variable points at.
 *
 * @param {Object} env      Environment to read the path from.
 * @param {string} variable e.g. `GITHUB_OUTPUT`.
 * @param {string} content
 */
function appendToEnvFile(env, variable, content) {
	const dest = env[variable];
	if (!dest) {
		process.stderr.write(
			`coverage-gate: --output github requested but $${variable} is unset; nothing written.\n`
		);
		return;
	}
	fs.appendFileSync(dest, content);
}

/**
 * Write step outputs and the job summary, or preview them under --dry-run.
 *
 * @param {Object} outputs Step outputs.
 * @param {string} summary Markdown summary.
 * @param {Object} config  resolveConfig() result.
 */
function writeGithubFiles(outputs, summary, config) {
	const outputLines =
		Object.entries(outputs)
			.map(([key, value]) => formatGithubLine(key, value))
			.join('\n') + '\n';
	if (config.dryRun) {
		process.stdout.write(
			`[dry-run] would append to $GITHUB_OUTPUT:\n${outputLines}` +
				`[dry-run] would append to $GITHUB_STEP_SUMMARY:\n${summary}`
		);
		return;
	}
	appendToEnvFile(config.env, 'GITHUB_OUTPUT', outputLines);
	appendToEnvFile(config.env, 'GITHUB_STEP_SUMMARY', summary);
}

/**
 * Skip the gate when there is no pull request base (push events).
 *
 * @param {Object} config resolveConfig() result.
 * @return {number} Exit code 0.
 */
function skipGate(config) {
	if (!config.github) {
		process.stdout.write(`coverage-gate: ${NO_BASE_MESSAGE}\n`);
		return 0;
	}
	emitAnnotations([annotation('notice', NO_BASE_MESSAGE)], config);
	writeGithubFiles(
		stepOutputs(EMPTY_RESULT),
		formatSkipSummary(NO_BASE_MESSAGE),
		config
	);
	return 0;
}

/**
 * Read and parse the coverage report, refusing one that lists no files.
 *
 * @param {Object} config resolveConfig() result.
 * @return {Map<string, Map<number, number>>} Parsed report.
 */
function loadReport(config) {
	let text;
	try {
		text = fs.readFileSync(config.reportPath, 'utf8');
	} catch (err) {
		throw new GateError(
			`cannot read coverage report "${config.reportPath}" (${err.code || err.message}). Did the test step write it?`
		);
	}
	const report = parseReport(config.format, text);
	if (report.size === 0) {
		throw new GateError(
			`coverage report "${config.reportPath}" lists no files. Is a coverage driver enabled (pcov, or wp-env started with --xdebug=coverage)?`
		);
	}
	return report;
}

/**
 * Print the result: annotations and GitHub files in github mode, text always.
 *
 * @param {Object} result computeGate() result.
 * @param {Object} config resolveConfig() result.
 */
function publish(result, config) {
	if (config.github) {
		const commands = buildAnnotations(result, config.threshold, {
			prefix: repoPrefix(config.root),
			failureLevel: config.failureLevel,
			unmeasuredPolicy: config.unmeasuredPolicy,
		});
		emitAnnotations(commands, config);
		writeGithubFiles(
			stepOutputs(result),
			formatSummary(result, config.threshold),
			config
		);
	}
	process.stdout.write(formatText(result, config.threshold));
}

/**
 * Map a result to an exit code, honouring --soft-fail.
 *
 * @param {Object} result computeGate() result.
 * @param {Object} config resolveConfig() result.
 * @return {number} 0 or 1.
 */
function exitCodeFor(result, config) {
	if (result.passed) {
		return 0;
	}
	if (config.softFail) {
		process.stdout.write(
			'coverage-gate: --soft-fail set; exiting 0 despite the failure.\n'
		);
		return 0;
	}
	return 1;
}

/**
 * Resolve the base, measure, publish and decide.
 *
 * @param {Object} config resolveConfig() result.
 * @return {number} Exit code.
 */
function runGate(config) {
	const base = resolveGateBase({ base: config.base, env: config.env });
	if (!base) {
		return skipGate(config);
	}
	const report = loadReport(config);
	const changed = gitChangedLines({ base, cwd: config.root });
	const result = computeGate({
		changed,
		report,
		threshold: config.threshold,
		format: config.format,
		exclude: config.exclude,
		root: config.root,
		unmeasuredPolicy: config.unmeasuredPolicy,
	});
	publish(result, config);
	return exitCodeFor(result, config);
}

/**
 * Report an expected failure (exit 2, or 0 under --soft-fail). Anything that
 * isn't a GateError is a bug and is rethrown.
 *
 * @param {Error}  err
 * @param {Object} config resolveConfig() result.
 * @return {number} Exit code.
 */
function failRun(err, config) {
	if (!(err instanceof GateError)) {
		throw err;
	}
	const message = `coverage-gate: ${err.message}`;
	if (config.github) {
		emitAnnotations([annotation(config.failureLevel, message)], config);
	} else {
		process.stderr.write(message + '\n');
	}
	return config.softFail ? 0 : 2;
}

/**
 * Run the CLI. Returns the intended exit code.
 *
 * @param {string[]} argv       argv slice (after the subcommand name).
 * @param {Object}   [deps]     Test seams.
 * @param {Object}   [deps.env] Environment for base resolution and `$GITHUB_*` file paths (defaults to `process.env`).
 * @return {number} 0 passed, 1 gate failed, 2 usage or runtime error.
 */
function runCli(argv, { env = process.env } = {}) {
	let config;
	try {
		const opts = parseArgs(argv);
		if (opts.help) {
			process.stdout.write(USAGE);
			return 0;
		}
		config = resolveConfig(opts, env);
	} catch (err) {
		process.stderr.write(`coverage-gate: ${err.message}\n`);
		return 2;
	}
	try {
		return runGate(config);
	} catch (err) {
		return failRun(err, config);
	}
}

module.exports = { runCli };
