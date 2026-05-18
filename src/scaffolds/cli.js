/**
 * scaffolds-validate -- validate every `scaffold.json` under a directory.
 *
 * CLI:
 *   wp-tooling scaffolds-validate <dir>
 *
 * Exits 0 when every discovered scaffold is valid (or the directory has
 * no scaffolds), 1 on validation/IO failure, 2 on usage error.
 *
 * This command is read-only -- it never writes to disk. Consequently
 * there is no `--dry-run` flag: the default behaviour already has no
 * side effects, and a degenerate "skip the work" dry-run would let
 * invalid scaffolds pass CI silently.
 *
 * Zero runtime dependencies. The CLI is structured so the TTY UI kit
 * (spinner, CancelledError) can be layered in later as a localised diff
 * around the `await registry.scan()` call.
 */

'use strict';

const { ScaffoldRegistry } = require('./registry');

/**
 * Parse argv (without the subcommand name).
 *
 * @param {string[]} argv
 * @return {{ help?: boolean, dir?: string }} Parsed options.
 * @throws {Error} On unknown flags or missing values.
 */
function parseArgs(argv) {
	const opts = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		switch (arg) {
			case '--help':
			case '-h':
				opts.help = true;
				break;
			default:
				if (arg.startsWith('-')) {
					throw new Error(`unknown argument: ${arg}`);
				}
				if (opts.dir !== undefined) {
					throw new Error(`unexpected positional argument: ${arg}`);
				}
				opts.dir = arg;
		}
	}
	return opts;
}

/**
 * Render CLI usage to stdout.
 */
function printUsage() {
	process.stdout.write(
		[
			'Usage: scaffolds-validate <dir> [options]',
			'',
			'  <dir>        Directory to scan recursively for `scaffold.json` files.',
			'',
			'  --help, -h   Print this help.',
			'',
			'Exits 0 when every discovered scaffold is valid (including the case',
			'where the directory has no scaffolds at all), 1 on validation or I/O',
			'failure, 2 on usage error.',
			'',
			'No --dry-run flag: this command is read-only by default.',
			'',
		].join('\n')
	);
}

/**
 * Run the CLI. Returns the intended exit code.
 *
 * @param {string[]} argv argv slice (without the subcommand name).
 * @return {Promise<number>} 0 on success, 1 on validation/IO failure, 2 on usage error.
 */
async function runCli(argv) {
	let opts;
	try {
		opts = parseArgs(argv);
	} catch (err) {
		process.stderr.write(`scaffolds-validate: ${err.message}\n`);
		return 2;
	}

	if (opts.help) {
		printUsage();
		return 0;
	}

	if (!opts.dir) {
		process.stderr.write('scaffolds-validate: missing <dir> argument\n');
		process.stderr.write(
			'Run `wp-tooling scaffolds-validate --help` for usage.\n'
		);
		return 2;
	}

	const registry = new ScaffoldRegistry(opts.dir);
	try {
		await registry.scan();
	} catch (err) {
		process.stderr.write(`scaffolds-validate: ${err.message}\n`);
		return 1;
	}

	const count = registry.all().length;
	process.stdout.write(`${count} scaffold${count === 1 ? '' : 's'} valid\n`);
	return 0;
}

module.exports = {
	runCli,
	parseArgs,
	printUsage,
};
