/**
 * IapiCheckError: an expected iapi-check failure (missing or unreadable
 * working directory, unreadable file). The CLI turns it into exit code 2;
 * any other error is a bug and is rethrown so it surfaces with a stack trace.
 */

'use strict';

class IapiCheckError extends Error {
	/**
	 * @param {string} message Human-readable reason, including what was expected.
	 */
	constructor(message) {
		super(message);
		this.name = 'IapiCheckError';
	}
}

module.exports = { IapiCheckError };
