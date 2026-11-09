#!/usr/bin/env node

/**
 * wp-tooling CLI entry point. Thin shim over src/cli/index.js — routing,
 * help, and subcommand handlers live there.
 *
 * Contract: `main(argv)` always returns `Promise<number>`. Sync and async
 * subcommands are both supported uniformly. Any unhandled rejection
 * (including a sync throw inside a subcommand, which async/await converts
 * to a rejection) renders as a clean `wp-tooling: unexpected failure`
 * message instead of a Node stack trace. Either way the process waits for
 * stdout and stderr to drain before it exits (see src/cli/exit.js).
 */

'use strict';

const { flushAndExit } = require('../src/cli/exit.js');

require('../src/cli/index.js')
	.main(process.argv.slice(2))
	.then(flushAndExit, (err) => {
		const detail = err && err.message ? err.message : String(err);
		process.stderr.write(`wp-tooling: unexpected failure (${detail})\n`);
		flushAndExit(1);
	});
