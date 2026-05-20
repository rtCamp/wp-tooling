/**
 * `wp-tooling release-bump` subcommand.
 *
 * Thin CLI adapter around `src/release/bump.js`. Owns argv parsing,
 * spinner orchestration and exit codes. The library does the work.
 *
 * Usage:
 *   wp-tooling release-bump [--type patch|minor|major] [--to X.Y.Z] [--dry-run] [--help]
 */

'use strict';

const { spinner, CancelledError } = require('../../ui');
const { bump } = require('../../release/bump');

function parseArgs(argv) {
	const opts = { type: 'patch', to: null, dryRun: false, help: false };
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
			case '--type': {
				const value = argv[++i];
				if (!value) {
					throw new Error('--type requires a value');
				}
				opts.type = value;
				break;
			}
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
			'Usage: wp-tooling release-bump [options]',
			'',
			'  --type <patch|minor|major>  Bump component (default: patch). Ignored when --to is set.',
			'  --to   <X.Y.Z>              Set an explicit version, overriding --type.',
			'  --dry-run                   Compute the new version and report files,',
			'                              but do not modify them.',
			'  --help, -h                  Print this help.',
			'',
			'Bumps the version in package.json, composer.json (if present),',
			"the plugin entry file's Version: header and any matching",
			'<PREFIX>_VERSION constant. The prefix is derived from the plugin',
			'slug, or taken from package.json `config.constantPrefix` when set.',
			'',
		].join('\n')
	);
}

function runCli(argv) {
	let opts;
	try {
		opts = parseArgs(argv);
	} catch (err) {
		process.stderr.write(`release-bump: ${err.message}\n`);
		return 2;
	}

	if (opts.help) {
		printUsage();
		return 0;
	}

	const s = spinner(
		opts.dryRun ? 'Planning version bump' : 'Bumping version'
	);
	s.start();

	try {
		const result = bump({
			cwd: process.cwd(),
			type: opts.type,
			to: opts.to,
			dryRun: opts.dryRun,
		});
		const verb = result.dryRun ? 'Would bump' : 'Bumped';
		const files = result.changed.length
			? `Changed: ${result.changed.join(', ')}`
			: 'No files needed changes';
		s.succeed(`${verb} ${result.from} -> ${result.to}. ${files}`);
		return 0;
	} catch (err) {
		s.fail('Bump failed');
		if (err instanceof CancelledError) {
			return 130;
		}
		process.stderr.write(`release-bump: ${err.message}\n`);
		return 1;
	}
}

module.exports = {
	name: 'release-bump',
	summary: 'Bump version in package.json, composer.json and plugin entry',
	run: runCli,
	parseArgs,
	printUsage,
};
