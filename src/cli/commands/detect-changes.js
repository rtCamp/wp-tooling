/**
 * detect-changes subcommand registration.
 *
 * The dispatcher (`src/cli/index.js`) auto-discovers every `*.js` file in
 * this directory. Each module must export `{ name, summary, run }`.
 * `run` is required lazily so cold-start cost stays close to a single
 * subcommand's footprint.
 */

'use strict';

module.exports = {
	name: 'detect-changes',
	summary: 'Bucket changed files for CI gating',
	run: (argv) => require('../../ci/detect-changes').runCli(argv),
};
