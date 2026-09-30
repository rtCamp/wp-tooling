/**
 * GateError: an expected coverage-gate failure (unreadable report, missing
 * base commit, git error). The CLI turns it into exit code 2; any other
 * error is a bug and is rethrown so it surfaces with a stack trace.
 */

'use strict';

class GateError extends Error {
	/**
	 * @param {string} message Human-readable reason, including what was expected.
	 */
	constructor(message) {
		super(message);
		this.name = 'GateError';
	}
}

module.exports = { GateError };
