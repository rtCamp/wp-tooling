/**
 * wp-tooling CLI dispatcher.
 *
 * Routes `wp-tooling <subcommand> ...` to the matching handler. New
 * subcommands register themselves in the COMMANDS map below. Implementation
 * modules are required lazily so cold-start time stays close to a single
 * subcommand's footprint.
 */

'use strict';

const PKG = require('../../package.json');

/**
 * Subcommand registry.
 *
 * Each entry: `{ summary, run }`.
 *   - `summary`: one-line description for top-level help.
 *   - `run(argv)`: receives argv after the subcommand name; returns an exit code.
 */
const COMMANDS = {
	'detect-changes': {
		summary: 'Bucket changed files for CI gating',
		run: (argv) => require('../ci/detect-changes').runCli(argv),
	},
};

/**
 * Render top-level usage text.
 *
 * @return {string} Usage block ending in a trailing newline.
 */
function usage() {
	const names = Object.keys(COMMANDS).sort();
	const width = Math.max(...names.map((n) => n.length));
	const lines = [
		`Usage: wp-tooling <command> [options]`,
		'',
		'Commands:',
		...names.map((n) => `  ${n.padEnd(width + 2)}${COMMANDS[n].summary}`),
		'',
		'Global options:',
		'  --help, -h        Print this help.',
		'  --version, -v     Print the package version.',
		'',
		`Run \`wp-tooling <command> --help\` for command-specific options.`,
		'',
	];
	return lines.join('\n');
}

/**
 * Dispatch entry point.
 *
 * @param {string[]} argv argv slice (without `node` and script path).
 * @return {number} Process exit code.
 */
function main(argv) {
	if (argv.length === 0) {
		process.stdout.write(usage());
		return 0;
	}

	const first = argv[0];

	if (first === '--help' || first === '-h') {
		process.stdout.write(usage());
		return 0;
	}

	if (first === '--version' || first === '-v') {
		process.stdout.write(`${PKG.version}\n`);
		return 0;
	}

	if (first.startsWith('-')) {
		process.stderr.write(`wp-tooling: unknown option "${first}"\n`);
		process.stderr.write(`Run \`wp-tooling --help\` for usage.\n`);
		return 2;
	}

	const command = COMMANDS[first];
	if (!command) {
		process.stderr.write(`wp-tooling: unknown command "${first}"\n`);
		process.stderr.write(
			`Run \`wp-tooling --help\` for the list of commands.\n`
		);
		return 2;
	}

	return command.run(argv.slice(1));
}

module.exports = {
	main,
	COMMANDS,
	usage,
};
