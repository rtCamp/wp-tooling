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
 * Zero runtime dependencies. A spinner from the TTY UI kit wraps the
 * `await registry.scan()` call so the user sees progress in interactive
 * shells; the spinner degrades to plain `Validating ...` / `+ ... valid`
 * lines in non-TTY environments (CI) per the UI kit contract.
 */

'use strict';

const { ScaffoldRegistry } = require('./registry');
const { spinner, CancelledError } = require('../ui');

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
	const s = spinner(`Validating scaffolds under ${opts.dir}`);
	s.start();

	try {
		await registry.scan();
	} catch (err) {
		s.fail('Validation failed');
		// `CancelledError` only ever escapes from TTY UI primitives. The
		// validate flow doesn't use any today, but catching here keeps the
		// CLI compliant with the project-wide cancellation contract: Ctrl+C
		// returns 130, no stack trace.
		if (err instanceof CancelledError) {
			return 130;
		}
		process.stderr.write(`scaffolds-validate: ${err.message}\n`);
		return 1;
	}

	const count = registry.all().length;
	s.succeed(`${count} scaffold${count === 1 ? '' : 's'} valid`);
	return 0;
}

module.exports = {
	runCli,
	parseArgs,
	printUsage,
};
