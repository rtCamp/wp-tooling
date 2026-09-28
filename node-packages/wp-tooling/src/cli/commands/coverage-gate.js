/**
 * coverage-gate subcommand registration.
 *
 * Auto-discovered by `src/cli/index.js`; `run` is required lazily so
 * cold-start cost stays close to a single subcommand's footprint.
 */

'use strict';

module.exports = {
	name: 'coverage-gate',
	summary: 'Fail when too few changed lines are covered by tests',
	run: (argv) => require('../../ci/coverage-gate').runCli(argv),
};
