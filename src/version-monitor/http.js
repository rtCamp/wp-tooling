/**
 * Tiny JSON-over-HTTPS helper for the version-monitor detectors.
 *
 * Wraps `https.get` in a Promise, sets a `User-Agent` (required by the
 * GitHub API), attaches a bearer token when one is supplied, and surfaces
 * non-2xx responses as errors. Rate-limit (HTTP 403 with a GitHub
 * rate-limit body) rejections are flagged with `err.rateLimited = true`
 * so a detector can stop early rather than hammer a throttled endpoint.
 *
 * This is the single seam the detector tests mock (`jest.mock`), keeping
 * the suite network-free with no extra dependency.
 *
 * Zero runtime dependencies -- Node built-ins only.
 */

'use strict';

const https = require('https');

/** Identifies our requests; the GitHub API rejects calls with no User-Agent. */
const USER_AGENT = 'rtcamp-wp-tooling-version-monitor';

/** Per-request timeout. A hung registry/API must not stall the scheduled job. */
const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Is this a "soft" client-side HTTP error -- one that means the source simply
 * has nothing to report (e.g. an unpublished package, or an action with no
 * GitHub release), rather than infrastructure being down? `403` rate limits
 * are reported separately via `rateLimited` and are not counted here.
 *
 * @param {Error} err Error from `getJson`.
 * @return {boolean} True for a non-rate-limit 4xx status.
 */
function isClientError(err) {
	return (
		!err.rateLimited &&
		typeof err.statusCode === 'number' &&
		err.statusCode >= 400 &&
		err.statusCode < 500
	);
}

/**
 * GET a URL and parse the response body as JSON.
 *
 * @param {string} url               Absolute `https://` URL.
 * @param {Object} [options]
 * @param {string} [options.token]   Bearer token (e.g. `GITHUB_TOKEN`) for authenticated calls.
 * @param {Object} [options.headers] Extra request headers.
 * @param {number} [options.timeout] Per-request timeout in ms (default 10000).
 * @return {Promise<*>} Parsed JSON body.
 * @throws {Error} On transport failure, timeout, non-2xx status, or invalid JSON. Rate-limit errors carry `rateLimited = true`; the HTTP status (when known) is on `statusCode`.
 */
function getJson(url, options = {}) {
	return new Promise((resolve, reject) => {
		const headers = {
			'User-Agent': USER_AGENT,
			Accept: 'application/json',
			...(options.headers || {}),
		};
		if (options.token) {
			headers.Authorization = `Bearer ${options.token}`;
		}

		const timeout = options.timeout || DEFAULT_TIMEOUT_MS;
		const request = https.get(url, { headers, timeout }, (res) => {
			const status = res.statusCode || 0;
			let body = '';
			res.setEncoding('utf8');
			res.on('data', (chunk) => {
				body += chunk;
			});
			res.on('end', () => {
				if (status === 403 && /rate limit/i.test(body)) {
					const err = new Error(
						`version-monitor: rate limited by ${url} (set GITHUB_TOKEN to raise the quota)`
					);
					err.rateLimited = true;
					err.statusCode = status;
					reject(err);
					return;
				}
				if (status < 200 || status >= 300) {
					const err = new Error(
						`version-monitor: GET ${url} returned HTTP ${status}`
					);
					err.statusCode = status;
					reject(err);
					return;
				}
				try {
					resolve(JSON.parse(body));
				} catch (parseErr) {
					reject(
						new Error(
							`version-monitor: invalid JSON from ${url}: ${parseErr.message}`
						)
					);
				}
			});
		});

		request.on('timeout', () => {
			request.destroy();
			reject(
				new Error(
					`version-monitor: request to ${url} timed out after ${timeout}ms`
				)
			);
		});

		request.on('error', (err) => {
			reject(
				new Error(
					`version-monitor: request to ${url} failed: ${err.message}`
				)
			);
		});
	});
}

module.exports = { getJson, isClientError, USER_AGENT };
