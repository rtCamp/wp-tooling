/**
 * a11y subcommand registration.
 *
 * The dispatcher (`src/cli/index.js`) auto-discovers every `*.js` file in
 * this directory. Each module must export `{ name, summary, run }`.
 * `run` is required lazily so cold-start cost stays close to a single
 * subcommand's footprint.
 */

'use strict';

module.exports = {
	name: 'a11y',
	summary: 'Run pa11y-ci and emit normalized accessibility violations',
	run: (argv) => require('../../a11y/run').runCli(argv),
};
