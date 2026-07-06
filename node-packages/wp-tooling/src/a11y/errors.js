/**
 * RunnerError: the structured error type thrown by the a11y runner library.
 *
 * Mirrors `src/scaffolds/errors.js` (ScaffoldError) so callers branch on a
 * stable machine-readable `code` while the message stays human-readable.
 * Extra fields supplied via `details` are attached verbatim (e.g. `install`,
 * `configPath`, `detail`).
 *
 * Codes:
 *   EBINMISSING  the external binary (pa11y-ci) is not installed
 *   EBINFAIL     the binary ran but failed for a reason other than "found violations"
 *   EBADJSON     the binary produced output that could not be parsed as JSON
 *   ENOURLS      no URLs could be resolved from the pa11y config
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

module.exports = { RunnerError };
