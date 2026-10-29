/**
 * `wp-tooling iapi-check` CLI adapter: flags → config → scan → output.
 */

'use strict';

const path = require('path');

const {
	parseFlags,
	parseChoice,
	emitAnnotations,
	writeGithubFiles,
} = require('../cli-support');
const { annotation } = require('../coverage-gate/render');
const { repoPrefix } = require('../coverage-gate/diff');
const { IapiCheckError } = require('./errors');
const { checkIapi } = require('./scan');
const { SOURCE_URL, WP_RELEASE_DATE, WP_VERSION } = require('./rules');
const {
	buildAnnotations,
	formatJson,
	formatSummary,
	formatText,
	stepOutputs,
} = require('./render');

const COMMAND = 'iapi-check';

const OUTPUT_MODES = ['text', 'github', 'json'];

/**
 * Flags that take a value, → option key. An empty value counts as not given,
 * so a workflow can pass `--ignore "${{ inputs.ignore }}"` whether or not the
 * input is set.
 */
const VALUE_FLAGS = {
	'--working-dir': 'workingDir',
	'--output': 'output',
	'--ignore': 'ignore',
};

/** Boolean flags, → option key. */
const BOOLEAN_FLAGS = {
	'--soft-fail': 'softFail',
	'--dry-run': 'dryRun',
	'--help': 'help',
	'-h': 'help',
};

const USAGE = [
	'Usage: iapi-check [options]',
	'',
	`Find Interactivity API usages that WordPress ${WP_VERSION} (due ${WP_RELEASE_DATE}) stops supporting.`,
	'Only the client runtime changes (WordPress/gutenberg#84098, Gutenberg 24.2);',
	'server-side directive processing does not. Source text is matched as written,',
	'so directives in render.php, templates, patterns, PHP strings and JSX are found.',
	'',
	'Rules (all errors except the last):',
	'  ignore-directive              data-wp-ignore is removed (deprecated since 6.9). The',
	'                                element and its descendants now hydrate. Remove it.',
	'  lifecycle-double-hyphen-id    data-wp-init--id, data-wp-watch--id, data-wp-run--id:',
	'                                directives with a suffix are skipped, so the callback',
	'                                never runs. Use three hyphens: data-wp-watch---id.',
	'  event-double-hyphen-id        data-wp-on--click--id (also on-window, on-document)',
	'                                listens for a "click--id" event and never fires on',
	'                                click. Use data-wp-on--click---id. data-wp-on-async*',
	'                                and three-hyphen IDs are unchanged.',
	'  negated-function              "!" before actions.* or callbacks.* in a directive value',
	'                                (deprecated since 6.8): the function is not called and',
	'                                the value is undefined. Use derived state (a getter on',
	'                                state). !state.* and !context.* still work.',
	'  router-state-navigation       Warning: state.navigation from the core/router store,',
	'                                deprecated since WordPress 7.0. Use state.navigating.',
	'                                Checked in JS/TS files that mention core/router or',
	'                                interactivity-router.',
	'',
	'  --working-dir <path>          Directory to scan (default: .).',
	'  --output <text|github|json>   text lists findings by file (default). github also writes',
	'                                annotations, a $GITHUB_STEP_SUMMARY table and the step',
	'                                outputs findings, errors and warnings. json prints one',
	'                                object: filesScanned, errors, warnings, findings[].',
	'  --ignore <regex>              Skip files whose path, relative to --working-dir with /',
	'                                separators, matches.',
	'  --soft-fail                   Report, but always exit 0; every finding annotates as a',
	'                                warning. For rollout, not normal use.',
	'  --dry-run                     With --output github, print what would be written or',
	'                                annotated instead, without emitting workflow commands.',
	'  --help, -h                    Print this help.',
	'',
	'Scans *.php, *.html, *.js, *.jsx, *.ts, *.tsx, *.mjs and *.cjs. Skips node_modules/,',
	'vendor/, .git/, build/ and dist/ at any depth (so assets/build/ too), *.min.js and',
	'symbolic links. Matches on a line that starts a comment (//, #, *, /* or <!--)',
	'are skipped; a comment after code on the same line is still read. Annotation',
	'paths are relative to the git repository root, so --working-dir can be a',
	'subdirectory. An empty flag value counts as not given.',
	'',
	'Exit codes: 0 no errors (warnings only), or --soft-fail · 1 errors found ·',
	'            2 usage error or unreadable --working-dir.',
	'',
	`Details: ${SOURCE_URL}`,
	'',
].join('\n');

/**
 * Resolve `--ignore`.
 *
 * @param {string|undefined} raw
 * @return {RegExp|null} Pattern, or `null` to skip nothing beyond the defaults.
 */
function parseIgnore(raw) {
	if (raw === undefined) {
		return null;
	}
	try {
		return new RegExp(raw);
	} catch (err) {
		throw new Error(`invalid --ignore regex "${raw}" (${err.message})`);
	}
}

/**
 * Validate raw options and resolve every default.
 *
 * @param {Object} opts parseFlags() result.
 * @param {Object} env  Environment: `$GITHUB_*` file paths and `$GITHUB_WORKSPACE`.
 * @return {Object} Run config.
 */
function resolveConfig(opts, env) {
	const output = parseChoice(opts.output, OUTPUT_MODES, 'text', '--output');
	return {
		root: path.resolve(opts.workingDir ?? '.'),
		ignore: parseIgnore(opts.ignore),
		output,
		github: output === 'github',
		softFail: opts.softFail === true,
		dryRun: opts.dryRun === true,
		env,
	};
}

/**
 * The working dir's path relative to the repo root, e.g. `''` or `plugins/acme/`,
 * so annotations attach to the right file. Uses git, like coverage-gate; when
 * the directory is not in a git checkout, falls back to its path relative to
 * `$GITHUB_WORKSPACE`, or to the current directory.
 *
 * @param {string} root Absolute working dir.
 * @param {Object} env
 * @return {string} Prefix with a trailing slash, or `''`.
 */
function annotationPrefix(root, env) {
	try {
		return repoPrefix(root);
	} catch {
		const base = env.GITHUB_WORKSPACE || process.cwd();
		const rel = path.relative(base, root);
		if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
			return '';
		}
		return rel.split(path.sep).join('/') + '/';
	}
}

/**
 * Options for the shared `$GITHUB_*` file writer.
 *
 * @param {Object} config resolveConfig() result.
 * @return {Object} `{ env, dryRun, command }`.
 */
function githubFileOptions(config) {
	return { env: config.env, dryRun: config.dryRun, command: COMMAND };
}

/**
 * Print the result in the requested mode. github mode also prints the text report.
 *
 * @param {Object} result checkIapi() result.
 * @param {Object} config resolveConfig() result.
 */
function publish(result, config) {
	if (config.output === 'json') {
		process.stdout.write(formatJson(result));
		return;
	}
	if (config.github) {
		emitAnnotations(
			buildAnnotations(result, {
				prefix: annotationPrefix(config.root, config.env),
				softFail: config.softFail,
			}),
			config.dryRun
		);
		writeGithubFiles(
			stepOutputs(result),
			formatSummary(result, { softFail: config.softFail }),
			githubFileOptions(config)
		);
	}
	process.stdout.write(formatText(result));
}

/**
 * Map a result to an exit code, honouring --soft-fail. Warnings never fail.
 *
 * @param {Object} result checkIapi() result.
 * @param {Object} config resolveConfig() result.
 * @return {number} 0 or 1.
 */
function exitCodeFor(result, config) {
	if (result.errors === 0) {
		return 0;
	}
	if (config.softFail) {
		process.stderr.write(
			`${COMMAND}: --soft-fail set; exiting 0 despite ${result.errors === 1 ? 'an error' : `${result.errors} errors`}.\n`
		);
		return 0;
	}
	return 1;
}

/**
 * Report an expected failure (exit 2, or 0 under --soft-fail). Anything that
 * isn't an IapiCheckError is a bug and is rethrown.
 *
 * @param {Error}  err
 * @param {Object} config resolveConfig() result.
 * @return {number} Exit code.
 */
function failRun(err, config) {
	if (!(err instanceof IapiCheckError)) {
		throw err;
	}
	const message = `${COMMAND}: ${err.message}`;
	if (config.github) {
		emitAnnotations(
			[annotation(config.softFail ? 'warning' : 'error', message)],
			config.dryRun
		);
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
 * @param {Object}   [deps.env] Environment for `$GITHUB_*` paths (defaults to `process.env`).
 * @return {number} 0 no errors, 1 errors found, 2 usage or runtime error.
 */
function runCli(argv, { env = process.env } = {}) {
	let config;
	try {
		const opts = parseFlags(argv, VALUE_FLAGS, BOOLEAN_FLAGS);
		if (opts.help) {
			process.stdout.write(USAGE);
			return 0;
		}
		config = resolveConfig(opts, env);
	} catch (err) {
		process.stderr.write(`${COMMAND}: ${err.message}\n`);
		return 2;
	}
	try {
		const result = checkIapi({ root: config.root, ignore: config.ignore });
		publish(result, config);
		return exitCodeFor(result, config);
	} catch (err) {
		return failRun(err, config);
	}
}

module.exports = { runCli };
