/**
 * RunnerError: the structured error type thrown by the perf runner library.
 *
 * Mirrors `src/a11y/errors.js` so callers branch on a stable machine-readable
 * `code` while the message stays human-readable. Extra fields supplied via
 * `details` are attached verbatim (e.g. `install`, `configPath`, `detail`).
 *
 * Codes:
 *   EBINMISSING  a required consumer-installed module or binary is missing
 *                (puppeteer, the web-vitals attribution build, or lighthouse
 *                while enabled)
 *   EBINFAIL     a browser or binary launch failed for a reason other than
 *                "found issues"
 *   EBADJSON     the perf config could not be parsed as JSON
 *   ECONFIGREAD  the perf config path exists but could not be read — e.g. it
 *                is a directory, or permission was denied (distinct from a
 *                simply-absent config, which is not an error)
 *   ENOURLS      no URLs could be resolved from the perf config or --url
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
