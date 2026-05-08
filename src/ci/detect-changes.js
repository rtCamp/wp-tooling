/**
 * detect-changes -- bucket counts of changed files for CI gating.
 *
 * Library API:
 *   const { detectChanges } = require( '@rtcamp/wp-tooling/ci' );
 *
 * CLI:
 *   wp-tooling detect-changes [options]
 *
 * Zero runtime dependencies -- Node built-ins plus the `git` CLI.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');

/**
 * Default bucket regexes. A file is counted in a bucket if its path matches.
 */
const DEFAULT_PATTERNS = {
	css: /\.s?css$|(?:^|\/)package(?:-lock)?\.json$/,
	js: /\.(?:js|snap)$|(?:^|\/)package(?:-lock)?\.json$/,
	php: /\.php$|(?:^|\/)composer\.(?:json|lock)$|(?:^|\/)phpstan(?:-baseline)?\.neon(?:\.dist)?$/,
	gha: /(?:^|\/)\.github\/(?:workflows|actions)\/.+\.yml$/,
};

/**
 * Default ignore regex. Files matching this are excluded from total-count
 * and from every bucket count, and counted under ignored-count instead.
 */
const DEFAULT_IGNORE =
	/\.github\/(?!workflows)(?!actions)|\.wordpress-org\/|docs\//;

/**
 * Compute per-bucket change counts for a list of files.
 *
 * @param {Object}             [options]
 * @param {string[]|string}    [options.files]  Newline-delimited string or array. Omit to run `git diff`.
 * @param {RegExp|string|null} [options.ignore] Override default ignore regex. `null` disables ignoring.
 * @param {string}             [options.base]   Override the diff base ref.
 * @return {{
 *   'total-count': number,
 *   'ignored-count': number,
 *   'css-count': number,
 *   'js-count': number,
 *   'php-count': number,
 *   'gha-count': number,
 * }} Counts.
 */
function detectChanges(options = {}) {
	const ignore = resolveIgnore(options.ignore);
	const files =
		options.files !== undefined
			? normaliseFiles(options.files)
			: gitDiffFiles(options.base);

	const ignored = ignore ? files.filter((f) => ignore.test(f)) : [];
	const relevant = ignore ? files.filter((f) => !ignore.test(f)) : files;

	return {
		'total-count': relevant.length,
		'ignored-count': ignored.length,
		'css-count': relevant.filter((f) => DEFAULT_PATTERNS.css.test(f))
			.length,
		'js-count': relevant.filter((f) => DEFAULT_PATTERNS.js.test(f)).length,
		'php-count': relevant.filter((f) => DEFAULT_PATTERNS.php.test(f))
			.length,
		'gha-count': relevant.filter((f) => DEFAULT_PATTERNS.gha.test(f))
			.length,
	};
}

/**
 * Resolve the ignore option to a RegExp or null.
 *
 * @param {RegExp|string|null|undefined} input
 * @return {RegExp|null} Compiled regex, or `null` to skip ignoring.
 */
function resolveIgnore(input) {
	if (input === null || input === false) {
		return null;
	}
	if (input === undefined) {
		return DEFAULT_IGNORE;
	}
	if (input instanceof RegExp) {
		return input;
	}
	if (typeof input === 'string') {
		if (input === '') {
			return null;
		}
		return new RegExp(input);
	}
	throw new TypeError('ignore must be RegExp, string, null, or undefined');
}

/**
 * Normalise a files input to an array of non-empty strings.
 *
 * @param {string[]|string} input
 * @return {string[]} Non-empty trimmed file paths.
 */
function normaliseFiles(input) {
	if (Array.isArray(input)) {
		return input.filter((s) => typeof s === 'string' && s.length > 0);
	}
	if (typeof input === 'string') {
		return input.split(/\r?\n/).filter(Boolean);
	}
	throw new TypeError('files must be string or array of strings');
}

/**
 * Run `git diff --name-only` against the resolved base ref.
 *
 * Fails soft -- on any git error (shallow clone, missing ref) writes a clear
 * message to stderr and returns an empty list rather than throwing.
 *
 * @param {string} [explicitBase]
 * @return {string[]} Changed file paths, or `[]` on failure.
 */
function gitDiffFiles(explicitBase) {
	const base = explicitBase || resolveBaseRef();
	try {
		const out = execFileSync('git', ['diff', '--name-only', base, 'HEAD'], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		return out.split(/\r?\n/).filter(Boolean);
	} catch (err) {
		const detail = (err.stderr || err.message || '').toString().trim();
		process.stderr.write(
			`detect-changes: git diff failed against "${base}" (${detail}). Treating as no changes.\n`
		);
		return [];
	}
}

/**
 * Determine the diff base ref from environment.
 *
 * - `GITHUB_BASE_REF` set (PR mode): fetch then use `origin/<base>`.
 * - Otherwise (push mode): use `HEAD~1`.
 *
 * @return {string} The git ref to diff against `HEAD`.
 */
function resolveBaseRef() {
	const baseRef = process.env.GITHUB_BASE_REF;
	if (!baseRef) {
		return 'HEAD~1';
	}
	try {
		execFileSync(
			'git',
			['fetch', '--depth=1', '--no-tags', 'origin', baseRef],
			{ stdio: ['ignore', 'ignore', 'pipe'] }
		);
	} catch (err) {
		const detail = (err.stderr || err.message || '').toString().trim();
		process.stderr.write(
			`detect-changes: git fetch origin ${baseRef} failed (${detail}).\n`
		);
	}
	return `origin/${baseRef}`;
}

const VALID_OUTPUTS = ['text', 'json', 'github'];

/**
 * Parse argv (without leading `node` and script path).
 *
 * @param {string[]} argv
 * @return {Object} Parsed flags keyed by option name.
 */
function parseArgs(argv) {
	const opts = { output: 'text' };
	let i = 0;
	while (i < argv.length) {
		const arg = argv[i];
		switch (arg) {
			case '--output':
				opts.output = argv[++i];
				break;
			case '--ignore':
				opts.ignore = argv[++i];
				break;
			case '--base':
				opts.base = argv[++i];
				break;
			case '--files':
				opts.filesArg = argv[++i];
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
 * Read a file-list argument as the raw newline-delimited contents.
 *
 * @param {string} filesArg `-` for stdin, anything else for a path.
 * @return {string} Raw file contents.
 */
function readFilesArg(filesArg) {
	if (filesArg === '-') {
		return fs.readFileSync(0, 'utf8');
	}
	return fs.readFileSync(filesArg, 'utf8');
}

/**
 * Emit counts in the requested output mode.
 *
 * @param {Object}  counts
 * @param {string}  mode
 * @param {boolean} [dryRun=false] In `github` mode, preview to stdout instead of writing the file.
 */
function emit(counts, mode, dryRun = false) {
	if (mode === 'json') {
		process.stdout.write(JSON.stringify(counts) + '\n');
		return;
	}
	if (mode === 'github') {
		const lines = Object.entries(counts)
			.map(([k, v]) => `${k}=${v}`)
			.join('\n');
		if (dryRun) {
			process.stdout.write(
				`[dry-run] would append to $GITHUB_OUTPUT:\n${lines}\n`
			);
			return;
		}
		const dest = process.env.GITHUB_OUTPUT;
		if (!dest) {
			process.stderr.write(
				'detect-changes: --output github requested but $GITHUB_OUTPUT is unset; nothing written.\n'
			);
			return;
		}
		fs.appendFileSync(dest, lines + '\n');
		return;
	}
	for (const [key, value] of Object.entries(counts)) {
		process.stdout.write(`${key}: ${value}\n`);
	}
}

/**
 * Print CLI usage to stdout.
 */
function printUsage() {
	process.stdout.write(
		[
			'Usage: detect-changes [options]',
			'',
			'  --output <text|json|github>   Output format (default: text).',
			'  --ignore <regex>              Override the default ignore regex.',
			'                                Pass an empty string to disable ignoring.',
			'  --base <ref>                  Override the diff base ref.',
			'  --files <path|->              Read newline-delimited file list from a path',
			'                                or stdin (`-`); skip git entirely.',
			'  --dry-run                     With --output github, preview to stdout (no file write).',
			'  --help, -h                    Print this help.',
			'',
		].join('\n')
	);
}

/**
 * Run the CLI. Returns the intended exit code.
 *
 * @param {string[]} argv argv slice (without `node` and script path).
 * @return {number} Process exit code (0 on success, 1 on I/O failure, 2 on usage error).
 */
function runCli(argv) {
	let opts;
	try {
		opts = parseArgs(argv);
	} catch (err) {
		process.stderr.write(`detect-changes: ${err.message}\n`);
		return 2;
	}

	if (opts.help) {
		printUsage();
		return 0;
	}

	if (!VALID_OUTPUTS.includes(opts.output)) {
		process.stderr.write(
			`detect-changes: invalid --output "${opts.output}" (expected one of: ${VALID_OUTPUTS.join(', ')})\n`
		);
		return 2;
	}

	let files;
	if (opts.filesArg !== undefined) {
		try {
			files = readFilesArg(opts.filesArg);
		} catch (err) {
			process.stderr.write(
				`detect-changes: cannot read file list (${err.message})\n`
			);
			return 1;
		}
	}

	const counts = detectChanges({
		files,
		ignore: opts.ignore,
		base: opts.base,
	});

	emit(counts, opts.output, opts.dryRun === true);
	return 0;
}

module.exports = {
	detectChanges,
	runCli,
	DEFAULT_PATTERNS,
	DEFAULT_IGNORE,
};
