/**
 * `wp-tooling cache <subaction>` — manage the on-disk cache used by remote
 * (sources) scaffolds for their fetched indexes, manifests and templates.
 *
 * Current subactions: `clear` (recursively removes the cache directory).
 * The `cache` namespace is reserved for future helpers (e.g. `warm`,
 * `list`); unknown subactions fall through to the help text rather than
 * silently no-op.
 *
 * Cache layout is flat — one file per URL, named by SHA-256 of that URL —
 * so `clear` is a single `fs.rm(dir, { recursive: true, force: true })`.
 */

'use strict';

const fs = require('fs/promises');

const { defaultCacheDir } = require('./fetch');
const { requireFlagValue } = require('./cli-support');

function parseArgs(argv) {
	const opts = {
		action: null,
		cacheDir: undefined,
		help: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--help' || a === '-h') {
			opts.help = true;
		} else if (a === '--cache-dir') {
			opts.cacheDir = requireFlagValue(argv[++i], a);
		} else if (a.startsWith('--cache-dir=')) {
			opts.cacheDir = a.slice('--cache-dir='.length);
		} else if (!opts.action) {
			opts.action = a;
		} else {
			throw new Error(`Unexpected argument: ${a}`);
		}
	}
	return opts;
}

function printHelp() {
	process.stdout.write(
		[
			'Usage: wp-tooling cache <subaction> [flags]',
			'',
			'Subactions:',
			'  clear              Remove the cached remote indexes, manifests, and templates.',
			'',
			'Flags:',
			'  --cache-dir <path> Override the default cache directory.',
			'  --help, -h         Show this help text.',
			'',
		].join('\n')
	);
}

/**
 * Remove the cache directory. Safe on a non-existent dir.
 *
 * @param {string} dir Absolute path to the cache directory.
 * @return {Promise<void>}
 */
async function clear(dir) {
	await fs.rm(dir, { recursive: true, force: true });
}

async function runCli(argv) {
	let opts;
	try {
		opts = parseArgs(argv);
	} catch (err) {
		process.stderr.write(`Error: ${err.message}\n`);
		printHelp();
		return 1;
	}
	if (opts.help || !opts.action) {
		printHelp();
		return opts.help ? 0 : 1;
	}
	const dir = opts.cacheDir || defaultCacheDir();
	if (opts.action === 'clear') {
		await clear(dir);
		process.stdout.write(`Cleared remote scaffold cache at ${dir}\n`);
		return 0;
	}
	process.stderr.write(`Error: unknown subaction "${opts.action}"\n`);
	printHelp();
	return 1;
}

module.exports = { runCli, clear, parseArgs };
