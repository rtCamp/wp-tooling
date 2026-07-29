/**
 * ScaffoldError: the structured error type thrown by every scaffold-engine
 * module. Extracted from registry.js so fetch.js can throw the same type
 * without a circular import.
 *
 * Error `code` is a stable, machine-readable identifier (e.g. `ENOSCAFFOLD`,
 * `EFETCHFAIL`) — callers (CLI / AI orchestrator) branch on it; the message
 * is human-readable. Extra fields supplied via `details` are attached to
 * the instance verbatim (e.g. `statusCode`, `url`, `path`).
 */

'use strict';

class ScaffoldError extends Error {
	constructor(code, message, details = {}) {
		super(message);
		this.name = 'ScaffoldError';
		this.code = code;
		Object.assign(this, details);
	}
}

module.exports = { ScaffoldError };
