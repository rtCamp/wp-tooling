#!/usr/bin/env node

/**
 * wp-tooling CLI entry point. Thin shim over src/cli/index.js — routing,
 * help, and subcommand handlers live there.
 *
 * Contract: `main(argv)` always returns `Promise<number>`. Sync and async
 * subcommands are both supported uniformly. Any unhandled rejection
 * (including a sync throw inside a subcommand, which async/await converts
 * to a rejection) renders as a clean `wp-tooling: unexpected failure`
 * message instead of a Node stack trace.
 */

'use strict';

require('../src/cli/index.js')
	.main(process.argv.slice(2))
	.then(
		(code) => process.exit(code),
		(err) => {
			const detail = err && err.message ? err.message : String(err);
			process.stderr.write(
				`wp-tooling: unexpected failure (${detail})\n`
			);
			process.exit(1);
		}
	);
