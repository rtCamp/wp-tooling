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
		(code) => {
			// process.exit() drops anything stdout has not written yet. Writes to
			// a pipe are asynchronous on macOS, so a long report piped into a
			// reader that is not ready (`wp-tooling list --json | jq`) used to
			// arrive cut short, or empty. Exit once everything queued before this
			// empty write has gone out; a closed pipe (EPIPE) exits straight away.
			process.exitCode = code;
			process.stdout.once('error', () => process.exit(code));
			process.stdout.write('', () => process.exit(code));
		},
		(err) => {
			const detail = err && err.message ? err.message : String(err);
			process.stderr.write(
				`wp-tooling: unexpected failure (${detail})\n`
			);
			process.exit(1);
		}
	);
