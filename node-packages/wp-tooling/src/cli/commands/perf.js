/**
 * perf subcommand registration.
 *
 * The dispatcher (`src/cli/index.js`) auto-discovers every `*.js` file in
 * this directory. Each module must export `{ name, summary, run }`.
 * `run` is required lazily so cold-start cost stays close to a single
 * subcommand's footprint.
 */

'use strict';

module.exports = {
	name: 'perf',
	summary:
		'Run web-vitals + Lighthouse (and optional server xhprof) and emit a normalized performance report',
	run: (argv) => require('../../perf/run').runCli(argv),
};
