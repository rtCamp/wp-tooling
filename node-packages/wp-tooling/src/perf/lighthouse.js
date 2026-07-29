/**
 * Lighthouse performance layer for one URL.
 *
 * Runs the consumer-installed `lighthouse` binary (resolved via
 * `resolve-bin.js`, the same local/hoisted/`npx --no-install` chain as the
 * a11y runner's `pa11y-ci` resolution) restricted to the `performance`
 * category, with `--chrome-flags` pointed at Chrome for Testing via
 * `CHROME_PATH` so the consumer machine needs no system Chrome install.
 * A per-URL failure here is a degrade, not a run failure — `run.js` catches
 * `RunnerError`s from this module and continues with `lighthouse: null` for
 * that URL.
 */

'use strict';

const { execFileSync } = require('child_process');
const { RunnerError } = require('./errors');

const BIN = 'lighthouse';
const MAX_BUFFER = 64 * 1024 * 1024;
const RUN_TIMEOUT_MS = 180000;

/**
 * Build the lighthouse argument vector for one URL.
 *
 * @param {Object} bin        Resolved binary ({ command, args }).
 * @param {string} url        Target URL.
 * @param {Object} lighthouse Resolved `lighthouse` config section.
 * @return {string[]} Argument vector.
 */
function buildArgs(bin, url, lighthouse) {
	return [
		...bin.args,
		url,
		'--output=json',
		'--output-path=stdout',
		`--only-categories=${lighthouse.categories.join(',')}`,
		'--quiet',
		'--chrome-flags=--headless=new --no-sandbox',
	];
}

/**
 * Run Lighthouse against one URL and return the parsed LHR.
 *
 * @param {Object}      bin                  Resolved binary.
 * @param {string}      url                  Target URL.
 * @param {Object}      lighthouse           Resolved `lighthouse` config section.
 * @param {Object}      [options]
 * @param {string}      [options.cwd]        Working directory.
 * @param {string|null} [options.chromePath] Chrome executable path (from puppeteer), or null.
 * @return {Object} Parsed Lighthouse result (LHR).
 * @throws {RunnerError} `EBINFAIL` / `EBADJSON`.
 */
function runLighthouse(bin, url, lighthouse, options = {}) {
	const cwd = options.cwd || process.cwd();
	const env = options.chromePath
		? { ...process.env, CHROME_PATH: options.chromePath }
		: process.env;

	let stdout;
	try {
		stdout = execFileSync(bin.command, buildArgs(bin, url, lighthouse), {
			cwd,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
			maxBuffer: MAX_BUFFER,
			timeout: RUN_TIMEOUT_MS,
			env,
		});
	} catch (err) {
		const detail = (err.stderr || err.message || '').toString().trim();
		throw new RunnerError('EBINFAIL', `${BIN} failed to run: ${detail}`, {
			detail,
		});
	}

	try {
		return JSON.parse(stdout);
	} catch (err) {
		throw new RunnerError(
			'EBADJSON',
			`${BIN} produced output that could not be parsed as JSON: ${err.message}`
		);
	}
}

module.exports = { runLighthouse, buildArgs, BIN };
