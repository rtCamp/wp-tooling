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

/**
 * Shape an error as the one-line JSON payload emitted on stderr in `--json`
 * mode. Shared by `wp-tooling add` and the init engine's `--list` so every
 * machine-facing command speaks the same error contract.
 *
 * Known errors keep their `code` and a whitelist of context fields; anything
 * else degrades to `{ code: 'EUNKNOWN', message }`.
 *
 * @param {Error} err - The error to shape.
 * @return {Object} `{ code, message, ...context }`.
 */
function formatErrorPayload(err) {
	if (err && typeof err.code === 'string' && err.code) {
		const payload = { code: err.code, message: err.message };
		for (const k of [
			'scaffold',
			'requested',
			'available',
			'missing',
			'missingDetails',
			'path',
			'errno',
			'placeholder',
			'template',
			'url',
			'statusCode',
			'rateLimited',
			'timeout',
			'cause',
			'file',
			'errors',
			'id',
			'source',
			'repository',
		]) {
			if (err[k] !== undefined) {
				payload[k] = err[k];
			}
		}
		return payload;
	}
	return {
		code: 'EUNKNOWN',
		message: err && err.message ? err.message : String(err),
	};
}

module.exports = { ScaffoldError, formatErrorPayload };
