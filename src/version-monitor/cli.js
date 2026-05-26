/**
 * Version-monitor CLI adapter.
 *
 * Owns argv parsing, the three-mode dispatch, stdin/stdout plumbing and exit
 * codes; the libraries (`config`, `detect`, `updater`, `reporter`) do the
 * work. Returns a `Promise<number>` so the dispatcher can `await` it.
 *
 *   --detect  loadConfig -> detect -> print JSON         (the only mode that reads the config)
 *   --apply   read JSON from stdin -> applyUpdates
 *   --report  read JSON from stdin -> print markdown
 *
 * Zero runtime dependencies -- Node built-ins only.
 */

'use strict';

const fs = require('fs');
const { loadConfig } = require('./config');
const { detect } = require('./detect');
const { applyUpdates } = require('./updater');
const { report } = require('./reporter');

/**
 * Parse argv (without leading `node` and script path).
 *
 * @param {string[]} argv Argument list.
 * @return {Object} Parsed options.
 * @throws {Error} On an unknown argument, a missing value, or conflicting modes.
 */
function parseArgs(argv) {
	const opts = {
		mode: null,
		config: undefined,
		allowMajor: false,
		dryRun: false,
		help: false,
	};
	const setMode = (mode) => {
		if (opts.mode && opts.mode !== mode) {
			throw new Error(
				`modes --${opts.mode} and --${mode} are mutually exclusive`
			);
		}
		opts.mode = mode;
	};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		switch (arg) {
			case '--detect':
				setMode('detect');
				break;
			case '--apply':
				setMode('apply');
				break;
			case '--report':
				setMode('report');
				break;
			case '--allow-major':
				opts.allowMajor = true;
				break;
			case '--dry-run':
				opts.dryRun = true;
				break;
			case '--config': {
				const value = argv[++i];
				if (!value) {
					throw new Error('--config requires a value');
				}
				opts.config = value;
				break;
			}
			case '--help':
			case '-h':
				opts.help = true;
				break;
			default:
				throw new Error(`unknown argument: ${arg}`);
		}
	}
	return opts;
}

/**
 * Print CLI usage to stdout.
 */
function printUsage() {
	process.stdout.write(
		[
			'Usage: wp-tooling version-monitor <--detect|--apply|--report> [options]',
			'',
			'Modes:',
			'  --detect          Run enabled detectors; print detected updates as JSON.',
			'  --apply           Read updates JSON from stdin; apply them to files.',
			'  --report          Read updates JSON from stdin; print a markdown PR body.',
			'',
			'Options:',
			'  --config <path>   Path to version-monitor.yml (default: .github/version-monitor.yml).',
			'  --allow-major     Apply major bumps too (default: skip them).',
			'  --dry-run         With --apply, match but do not write files.',
			'  --help, -h        Print this help.',
			'',
			'Pipe pattern:',
			'  wp-tooling version-monitor --detect > updates.json',
			'  cat updates.json | wp-tooling version-monitor --apply',
			'  cat updates.json | wp-tooling version-monitor --report > pr-body.md',
			'',
		].join('\n')
	);
}

/**
 * Read and parse the updates JSON array from stdin.
 *
 * @return {Object[]} Parsed updates (empty array for empty input).
 * @throws {Error} When stdin is unreadable or not a JSON array.
 */
function readUpdatesFromStdin() {
	let raw;
	try {
		raw = fs.readFileSync(0, 'utf8');
	} catch (err) {
		throw new Error(`cannot read updates from stdin: ${err.message}`);
	}
	const trimmed = raw.trim();
	if (trimmed === '') {
		return [];
	}
	let parsed;
	try {
		parsed = JSON.parse(trimmed);
	} catch (err) {
		throw new Error(`stdin is not valid JSON: ${err.message}`);
	}
	if (!Array.isArray(parsed)) {
		throw new Error('expected a JSON array of update records on stdin');
	}
	return parsed;
}

/**
 * Run the version-monitor CLI.
 *
 * @param {string[]} argv argv slice (without `node` and script path).
 * @return {Promise<number>} Exit code (0 ok, 1 runtime failure, 2 usage / missing config).
 */
async function runCli(argv) {
	let opts;
	try {
		opts = parseArgs(argv);
	} catch (err) {
		process.stderr.write(`version-monitor: ${err.message}\n`);
		return 2;
	}

	if (opts.help) {
		printUsage();
		return 0;
	}

	if (!opts.mode) {
		process.stderr.write(
			'version-monitor: specify a mode (--detect, --apply, or --report)\n'
		);
		printUsage();
		return 2;
	}

	const cwd = process.cwd();

	if (opts.mode === 'detect') {
		let config;
		try {
			config = loadConfig(cwd, opts.config);
		} catch (err) {
			process.stderr.write(`${err.message}\n`);
			return 2;
		}
		const errors = [];
		let updates;
		try {
			updates = await detect(config, { cwd, errors });
		} catch (err) {
			process.stderr.write(`version-monitor: ${err.message}\n`);
			return 1;
		}
		// Emit whatever was found, then fail if any source could not be
		// checked -- a scheduled monitor must not look green while blind.
		process.stdout.write(`${JSON.stringify(updates, null, 2)}\n`);
		if (errors.length > 0) {
			process.stderr.write(
				`version-monitor: ${errors.length} detector error(s); results may be incomplete:\n`
			);
			for (const message of errors) {
				process.stderr.write(`  - ${message}\n`);
			}
			return 1;
		}
		return 0;
	}

	let updates;
	try {
		updates = readUpdatesFromStdin();
	} catch (err) {
		process.stderr.write(`version-monitor: ${err.message}\n`);
		return 2;
	}

	if (opts.mode === 'report') {
		process.stdout.write(`${report(updates)}\n`);
		return 0;
	}

	// mode === 'apply'
	try {
		applyUpdates(updates, {
			cwd,
			allowMajor: opts.allowMajor,
			dryRun: opts.dryRun,
		});
	} catch (err) {
		process.stderr.write(`version-monitor: ${err.message}\n`);
		return 1;
	}
	return 0;
}

module.exports = { runCli, parseArgs, printUsage, readUpdatesFromStdin };
