/**
 * version-monitor subcommand registration.
 *
 * The dispatcher (`src/cli/index.js`) auto-discovers every `*.js` file in this
 * directory. Each module exports `{ name, summary, run }`; `run` is required
 * lazily so cold-start cost stays close to a single subcommand's footprint.
 */

'use strict';

module.exports = {
	name: 'version-monitor',
	summary: 'Detect + apply dependency updates Dependabot misses',
	run: (argv) => require('../../version-monitor').runCli(argv),
};
