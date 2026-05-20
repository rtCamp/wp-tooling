/**
 * `wp-tooling release-zip` subcommand.
 *
 * Builds a deterministic `dist/<slug>-<version>.zip` from the current
 * working tree, honouring `.distignore`.
 *
 * Usage:
 *   wp-tooling release-zip [--force] [--dry-run] [--help]
 */

'use strict';

const { spinner, CancelledError } = require('../../ui');
const { zip } = require('../../release/zip');

function parseArgs(argv) {
	const opts = { force: false, dryRun: false, help: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		switch (arg) {
			case '--help':
			case '-h':
				opts.help = true;
				break;
			case '--dry-run':
				opts.dryRun = true;
				break;
			case '--force':
				opts.force = true;
				break;
			default:
				throw new Error(`unknown argument: ${arg}`);
		}
	}
	return opts;
}

function printUsage() {
	process.stdout.write(
		[
			'Usage: wp-tooling release-zip [options]',
			'',
			'  --force       Overwrite an existing dist/<slug>-<version>.zip.',
			'  --dry-run     Build the archive in memory and report size,',
			'                but do not write dist/.',
			'  --help, -h    Print this help.',
			'',
			'Reads .distignore (one pattern per line, # comments allowed,',
			'`*` and `**` glob support). When no .distignore is present',
			'a sensible default exclude list is used.',
			'',
			'Entries are sorted lexicographically and their mtimes pinned',
			'so two runs against the same tree produce a byte-identical zip.',
			'',
		].join('\n')
	);
}

function formatSize(bytes) {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function runCli(argv) {
	let opts;
	try {
		opts = parseArgs(argv);
	} catch (err) {
		process.stderr.write(`release-zip: ${err.message}\n`);
		return 2;
	}

	if (opts.help) {
		printUsage();
		return 0;
	}

	const s = spinner(
		opts.dryRun ? 'Planning zip archive' : 'Building zip archive'
	);
	s.start();

	try {
		const result = zip({
			cwd: process.cwd(),
			force: opts.force,
			dryRun: opts.dryRun,
		});
		const verb = result.dryRun ? 'Would write' : 'Wrote';
		s.succeed(
			`${verb} ${result.outputPath} (${result.fileCount} files, ${formatSize(result.byteSize)})`
		);
		return 0;
	} catch (err) {
		s.fail('Zip build failed');
		if (err instanceof CancelledError) {
			return 130;
		}
		process.stderr.write(`release-zip: ${err.message}\n`);
		return 1;
	}
}

module.exports = {
	name: 'release-zip',
	summary: 'Build a .distignore-aware dist/<slug>-<version>.zip',
	run: runCli,
	parseArgs,
	printUsage,
};
