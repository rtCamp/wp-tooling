/**
 * iapi-check subcommand registration.
 *
 * Auto-discovered by `src/cli/index.js`; `run` is required lazily so
 * cold-start cost stays close to a single subcommand's footprint.
 */

'use strict';

module.exports = {
	name: 'iapi-check',
	summary:
		'Find Interactivity API usages that WordPress 7.2 stops supporting',
	run: (argv) => require('../../ci/iapi-check').runCli(argv),
};
