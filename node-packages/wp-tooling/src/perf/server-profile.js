/**
 * Server-side xhprof layer for one URL, invoked over WP-CLI.
 *
 * Spawns the consumer's `server-profile.php` shim (installed by
 * `wp-tooling add setup/perf`) through the configured WP-CLI command prefix
 * — typically `npx wp-env run cli --env-cwd=<path> -- wp`. The URL's origin
 * is passed as WP-CLI's `--url` (site context; also what arms
 * `redirect_canonical()` in the shim's render, which is why the shim removes
 * that hook) and the path+query is passed positionally (the shim reads it
 * into `$_GET` itself).
 *
 * Every failure mode here — spawn failure, non-zero exit, unparseable
 * output — is a DEGRADE, never a thrown error: the server layer is
 * auxiliary cause-data, so a broken WP-CLI invocation must not take down
 * the frontend layers or affect the run's exit code. Callers read
 * `result.error` to detect it.
 */

'use strict';

const { spawnSync } = require('child_process');

const MAX_BUFFER = 64 * 1024 * 1024;
const RUN_TIMEOUT_MS = 120000;

/**
 * Split a target URL into its origin (scheme+host+port) and its path+query
 * — the two pieces the shim's contract expects separately
 * (`wp eval-file server-profile.php [<path>] [<top>] [--url=<host>]`).
 *
 * @param {string} url Full target URL.
 * @return {{origin: string, pathAndQuery: string}} Split URL.
 */
function splitUrl(url) {
	const parsedUrl = new URL(url);
	return {
		origin: parsedUrl.origin,
		pathAndQuery: `${parsedUrl.pathname}${parsedUrl.search}`,
	};
}

/**
 * Parse the shim's stdout, tolerating a leading non-JSON preamble line.
 *
 * @param {string} text Raw stdout.
 * @return {*} Parsed value, or `null` when not parseable.
 */
function tryParse(text) {
	if (!text) {
		return null;
	}
	const trimmed = text.trim();
	// Find where JSON actually starts -- an array `[` or object `{` -- so a
	// leading non-JSON preamble line (e.g. a PHP notice) doesn't break parsing.
	const start = trimmed.search(/[[{]/);
	if (start === -1) {
		return null;
	}
	try {
		return JSON.parse(trimmed.slice(start));
	} catch {
		return null;
	}
}

/**
 * Run the consumer's `server-profile.php` shim over WP-CLI for one URL.
 *
 * @param {Object}   server         Resolved `server` config section.
 * @param {string[]} server.command WP-CLI invocation prefix (e.g. `['npx','wp-env','run','cli','--env-cwd=...','--','wp']`).
 * @param {string}   server.shim    Shim path, as WP-CLI sees it.
 * @param {number}   server.top     Top-N functions to request.
 * @param {string}   url            Target URL (origin used for `--url`; path+query passed positionally).
 * @param {Object}   [options]
 * @param {string}   [options.cwd]  Working directory.
 * @return {{data: (Object|Array|null), diagnostic: (string|null), error: (string|null)}}
 *   Parsed profiler output (a bare `{fn: {ct,wt,cpu,mu,pmu}}` map, or `[]` when no backend
 *   was loaded), the STDERR route diagnostic when the shim printed one, and an `error`
 *   detail when the invocation could not be completed.
 */
function runServerProfile(server, url, options = {}) {
	const cwd = options.cwd || process.cwd();

	// splitUrl (and building args from server.command) can throw on malformed
	// input -- this module always degrades instead, so a bad URL or config
	// must not abort the URLs after this one.
	let origin;
	let pathAndQuery;
	let args;
	try {
		({ origin, pathAndQuery } = splitUrl(url));
		const [, ...prefix] = server.command;
		args = [
			...prefix,
			'eval-file',
			server.shim,
			pathAndQuery,
			String(server.top),
			`--url=${origin}`,
		];
	} catch (err) {
		return { data: null, diagnostic: null, error: err.message };
	}

	const command = server.command[0];
	let result;
	try {
		// spawnSync itself can throw synchronously (e.g. command undefined),
		// separately from the return-based result.error handled below.
		result = spawnSync(command, args, {
			cwd,
			encoding: 'utf8',
			maxBuffer: MAX_BUFFER,
			timeout: RUN_TIMEOUT_MS,
		});
	} catch (err) {
		return { data: null, diagnostic: null, error: err.message };
	}

	const diagnostic = (result.stderr || '').toString().trim() || null;

	if (result.error) {
		return { data: null, diagnostic, error: result.error.message };
	}

	const parsed = tryParse((result.stdout || '').toString());
	if (parsed === null) {
		const detail =
			diagnostic ||
			`exit code ${result.status === null ? 'null (timed out?)' : result.status}`;
		return {
			data: null,
			diagnostic,
			error: `no parseable output (${detail})`,
		};
	}

	return { data: parsed, diagnostic, error: null };
}

module.exports = { runServerProfile, splitUrl };
