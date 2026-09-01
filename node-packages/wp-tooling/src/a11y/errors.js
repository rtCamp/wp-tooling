/**
 * RunnerError: the structured error type thrown by the a11y runner library.
 *
 * Mirrors `src/scaffolds/errors.js` (ScaffoldError) so callers branch on a
 * stable machine-readable `code` while the message stays human-readable.
 * Extra fields supplied via `details` are attached verbatim (e.g. `install`,
 * `configPath`, `detail`).
 *
 * Codes:
 *   EBINMISSING  the external binary (pa11y-ci) is not installed — usage error
 *   EBINFAIL     the binary ran but failed for a reason other than "found violations"
 *   EBADJSON     the binary produced output that could not be parsed as JSON
 *   ECONFIGJS    the pa11y config path is a .js/.cjs/.mjs file — usage error
 *   ENOURLS      no URLs could be resolved from the pa11y config — usage error
 */

'use strict';

class RunnerError extends Error {
	constructor(code, message, details = {}) {
		super(message);
		this.name = 'RunnerError';
		this.code = code;
		Object.assign(this, details);
	}
}

/**
 * RunnerError codes that mean "the CLI was misused or misconfigured" (missing
 * binary, missing/invalid config) rather than "the run itself failed".
 */
const USAGE_ERROR_CODES = ['EBINMISSING', 'ENOURLS', 'ECONFIGJS'];

/**
 * Whether `err` is a RunnerError the CLI should treat as a usage error
 * (exit code 2) rather than a run failure (exit code 1).
 *
 * @param {*} err Value caught from a runner call.
 * @return {boolean} True for EBINMISSING / ENOURLS / ECONFIGJS.
 */
function isUsageError(err) {
	return err instanceof RunnerError && USAGE_ERROR_CODES.includes(err.code);
}

module.exports = { RunnerError, isUsageError };
