/**
 * Shared CLI plumbing for the scaffold subcommands (`add`, `list`, `features`,
 * `validate`, `cache`). Each used to hand-roll the same registry construction,
 * fetch-option mapping, and flag-value parsing; centralising them here keeps
 * the commands consistent (one error message, one scan recipe, one place to
 * change where project-local scaffolds live).
 *
 * Zero runtime dependencies; Node built-ins only.
 */

'use strict';

const path = require('path');

/**
 * wp-tooling's bundled scaffolds — two levels up from src/scaffolds/.
 *
 * @return {string} Absolute path to the bundled `scaffolds/` directory.
 */
function defaultsDir() {
	return path.join(__dirname, '..', '..', 'scaffolds');
}

/**
 * A consuming project's local scaffolds live in `<cwd>/bin/scaffolds`.
 *
 * @param {string} cwd - Project directory.
 * @return {string} Absolute path to `<cwd>/bin/scaffolds`.
 */
function projectDir(cwd) {
	return path.join(cwd, 'bin', 'scaffolds');
}

/**
 * Build + scan a registry over the bundled defaults and the project's local
 * scaffolds.
 *
 * @param {string} cwd         - Project directory.
 * @param {Object} [fetchOpts] - Forwarded to scan() for remote indexes.
 * @return {Promise<ScaffoldRegistry>} The scanned registry.
 */
async function buildRegistry(cwd, fetchOpts) {
	// Lazy require: registry.js → validate.js, and validate.js imports this
	// module, so a top-level require here would form a load cycle.
	const { ScaffoldRegistry } = require('./registry');
	const registry = new ScaffoldRegistry({
		defaultsDir: defaultsDir(),
		projectDir: projectDir(cwd),
	});
	await registry.scan({ fetchOpts });
	return registry;
}

/**
 * Map parsed CLI opts to the fetch options the registry understands.
 *
 * @param {Object} opts - Parsed CLI opts (may carry `refresh`, `cacheDir`).
 * @return {Object} `{ refresh?, cacheDir? }`.
 */
function fetchOptsFrom(opts) {
	const fetchOpts = {};
	if (opts.refresh) {
		fetchOpts.refresh = true;
	}
	if (opts.cacheDir) {
		fetchOpts.cacheDir = opts.cacheDir;
	}
	return fetchOpts;
}

/**
 * Validate the value taken for a space-separated flag (`--flag value`).
 * A missing value, or one that is itself a flag (`--name --json`), is a parse
 * error rather than a silently-swallowed flag or an `undefined` input. Values
 * that legitimately begin with `--` must use the `--flag=value` form.
 *
 * @param {string|undefined} value - The token consumed as the flag's value.
 * @param {string}           flag  - The flag name, for the error message.
 * @return {string} The validated value.
 * @throws {Error} When the value is missing or flag-shaped.
 */
function requireFlagValue(value, flag) {
	if (value === undefined || value.startsWith('--')) {
		throw new Error(
			`Missing value for ${flag} (use ${flag}=<value> for values starting with --)`
		);
	}
	return value;
}

module.exports = {
	defaultsDir,
	projectDir,
	buildRegistry,
	fetchOptsFrom,
	requireFlagValue,
};
