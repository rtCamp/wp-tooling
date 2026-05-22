/**
 * wp-tooling CLI dispatcher.
 *
 * Routes `wp-tooling <subcommand> ...` to the matching handler. Subcommands
 * are auto-discovered from `src/cli/commands/*.js` at startup — adding a new
 * subcommand is a single new file under that directory with no edit here.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const PKG = require('../../package.json');

const COMMANDS_DIR = path.join(__dirname, 'commands');

/**
 * Discover subcommand modules under `commands/`.
 *
 * Each module must export `{ name, summary, run }`:
 *   - `name`: subcommand string the dispatcher matches against argv[0].
 *   - `summary`: one-line description for top-level help.
 *   - `run(argv)`: receives argv after the subcommand name; returns an exit code.
 *
 * Entries are sorted so help output is stable across platforms whose
 * `readdirSync` order differs.
 *
 * @param {string} [dir=COMMANDS_DIR] Directory to scan; overridable for tests.
 * @return {Object<string, {summary: string, run: Function}>} Registry keyed by name.
 */
function loadCommands(dir = COMMANDS_DIR) {
	const registry = {};
	const entries = fs
		.readdirSync(dir, { withFileTypes: true })
		.filter((e) => e.isFile() && e.name.endsWith('.js'))
		.map((e) => e.name)
		.sort();

	for (const file of entries) {
		// Intentional dynamic require: path = package-owned dir + readdirSync
		// entry, no user input.
		const mod = require(path.join(dir, file));
		if (
			!mod ||
			typeof mod.name !== 'string' ||
			typeof mod.run !== 'function'
		) {
			throw new Error(
				`wp-tooling: invalid command module "${file}" — expected { name, summary, run }, got ${JSON.stringify(
					mod
				)}`
			);
		}
		if (registry[mod.name]) {
			throw new Error(
				`wp-tooling: duplicate command "${mod.name}" registered by "${file}"`
			);
		}
		registry[mod.name] = {
			summary: typeof mod.summary === 'string' ? mod.summary : '',
			run: mod.run,
		};
	}

	return registry;
}

const COMMANDS = loadCommands();

/**
 * Render top-level usage text.
 *
 * @return {string} Usage block ending in a trailing newline.
 */
function usage() {
	const names = Object.keys(COMMANDS).sort();
	const width =
		names.length > 0 ? Math.max(...names.map((n) => n.length)) : 0;
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
 * Always returns a `Promise<number>`. The promise resolves whether the
 * routed subcommand is sync (returns a number) or async (returns a
 * `Promise<number>`) -- `async` here awaits both transparently. Sync
 * throws from a subcommand become promise rejections, which the bin
 * shim's failure handler renders cleanly.
 *
 * A `CancelledError` thrown from any TTY UI primitive (matched by
 * `err.name === 'CancelledError'`) is caught centrally and mapped to
 * exit code 130 -- the Unix convention for SIGINT -- so individual
 * subcommands do not each need their own Ctrl+C handler.
 *
 * @param {string[]} argv argv slice (without `node` and script path).
 * @return {Promise<number>} Process exit code.
 */
async function main(argv) {
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

	try {
		return await command.run(argv.slice(1));
	} catch (err) {
		// Duck-typed so jest.isolateModules paths (which produce a second
		// CancelledError class) still match.
		if (err && err.name === 'CancelledError') {
			process.stderr.write('wp-tooling: cancelled\n');
			return 130;
		}
		throw err;
	}
}

module.exports = {
	main,
	COMMANDS,
	usage,
	loadCommands,
};
