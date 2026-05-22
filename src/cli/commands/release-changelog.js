/**
 * `wp-tooling release:changelog` subcommand.
 *
 * Renames `## Unreleased` to `## <version> - <YYYY-MM-DD>` and prepends
 * a fresh empty `## Unreleased` section. Refuses to run when the
 * existing Unreleased section has no content.
 *
 * Usage:
 *   wp-tooling release:changelog [--to X.Y.Z] [--dry-run] [--help]
 */

'use strict';

const { spinner, CancelledError } = require('../../ui');
const { changelog } = require('../../release/changelog');

function parseArgs(argv) {
	const opts = { to: null, dryRun: false, help: false };
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
			case '--to': {
				const value = argv[++i];
				if (!value) {
					throw new Error('--to requires a value');
				}
				opts.to = value;
				break;
			}
			default:
				throw new Error(`unknown argument: ${arg}`);
		}
	}
	return opts;
}

function printUsage() {
	process.stdout.write(
		[
			'Usage: wp-tooling release:changelog [options]',
			'',
			'  --to <X.Y.Z>   Version to stamp into the new heading.',
			'                 Defaults to the version in package.json',
			'                 (run release-bump first).',
			'  --dry-run      Show the new heading without rewriting CHANGELOG.md.',
			'  --help, -h     Print this help.',
			'',
			'Refuses to run when the ## Unreleased section is empty,',
			'so you cannot ship a release with no notes.',
			'',
		].join('\n')
	);
}

function runCli(argv) {
	let opts;
	try {
		opts = parseArgs(argv);
	} catch (err) {
		process.stderr.write(`release:changelog: ${err.message}\n`);
		return 2;
	}

	if (opts.help) {
		printUsage();
		return 0;
	}

	const s = spinner(
		opts.dryRun ? 'Planning CHANGELOG update' : 'Updating CHANGELOG.md'
	);
	s.start();

	try {
		const result = changelog({
			cwd: process.cwd(),
			version: opts.to,
			dryRun: opts.dryRun,
		});
		const verb = result.dryRun ? 'Would update' : 'Updated';
		s.succeed(
			`${verb} ${result.file}: ## Unreleased -> ## ${result.version} - ${result.date}`
		);
		return 0;
	} catch (err) {
		s.fail('Changelog update failed');
		if (err instanceof CancelledError) {
			return 130;
		}
		process.stderr.write(`release:changelog: ${err.message}\n`);
		return 1;
	}
}

module.exports = {
	name: 'release:changelog',
	summary: 'Finalise the CHANGELOG ## Unreleased section',
	run: runCli,
	parseArgs,
	printUsage,
};
