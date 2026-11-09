/**
 * Process exit that does not drop queued output.
 */

'use strict';

/**
 * Exits with `code` once stdout and stderr have written everything queued.
 *
 * process.exit() drops whatever a stream has not written yet, and writes to a
 * pipe are asynchronous on POSIX, so a long report piped into a reader that is
 * not ready (`wp-tooling list --json | jq`) used to arrive cut short at
 * 64 KiB, or empty. The empty write's callback runs after everything queued
 * before it. A closed pipe (EPIPE, as with `2>&1 | head`) exits straight away
 * with the command's own code instead of crashing with 1.
 *
 * @param {number} code Exit code.
 */
function flushAndExit(code) {
	let pending = 2;
	for (const stream of [process.stdout, process.stderr]) {
		stream.once('error', () => process.exit(code));
		stream.write('', () => {
			if (0 === --pending) {
				process.exit(code);
			}
		});
	}
}

module.exports = { flushAndExit };
