/**
 * Remote-file fetcher for scaffolds listed in the inventory
 * (`src/scaffolds/inventory.js`). Fetches both a remote scaffold's
 * `scaffold.json` manifest and its template bodies.
 *
 * Composes a `raw.githubusercontent.com` URL from `{ github, ref, path }`
 * plus a relative file path, fetches it over HTTPS, and caches the body on
 * disk for refs that look immutable (tag-style or full SHA). The cache
 * layout is flat — one file per URL, named by SHA-256 of that URL — so
 * `cache clear` is a single recursive remove.
 *
 * Zero runtime npm dependencies; Node built-ins only. Shape mirrors
 * `src/version-monitor/http.js` (User-Agent header, 10s timeout, status-code
 * surfacing) so tests can mock `node:https` the same way.
 *
 * On non-2xx / timeout / network failure, throws `ScaffoldError` with
 * `code: 'EFETCHFAIL'`, attaching `url`, `statusCode`, and `rateLimited`
 * (a heuristic flag set on HTTP 403 responses that look rate-limited).
 */

'use strict';

const https = require('https');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { ScaffoldError } = require('./errors');

const USER_AGENT = 'rtcamp-wp-tooling';
const DEFAULT_TIMEOUT_MS = 10000;
const RAW_GITHUB_BASE = 'https://raw.githubusercontent.com';

/**
 * A cacheable ref is one that should not change once published:
 *   - Semver-style tags: `v1`, `v1.2`, `v1.2.3`, `v1.2.3-rc1`, `v1.2.3+build`.
 *   - Full 40-character commit SHAs.
 * Everything else (`main`, `develop`, `HEAD`, short SHAs, custom branches,
 * unprefixed numbers) is treated as mutable and bypasses the cache.
 *
 * @param {string} ref Git ref string (tag, branch, SHA).
 * @return {boolean} True when the body fetched at this ref may be cached.
 */
function isCacheableRef(ref) {
	if (typeof ref !== 'string' || ref.length === 0) {
		return false;
	}
	if (/^v\d+(\.\d+)*([-+]\S+)?$/.test(ref)) {
		return true;
	}
	if (/^[0-9a-f]{40}$/.test(ref)) {
		return true;
	}
	return false;
}

/**
 * Cache directory: respects `$XDG_CACHE_HOME` (Linux convention) and
 * falls back to `~/.cache/`. The `wp-tooling/remote/` sub-path is dedicated
 * to this feature so `cache clear` only touches our own files.
 *
 * @return {string} Absolute path to the cache dir (may not exist yet).
 */
function defaultCacheDir() {
	const base =
		process.env.XDG_CACHE_HOME && process.env.XDG_CACHE_HOME.length > 0
			? process.env.XDG_CACHE_HOME
			: path.join(os.homedir(), '.cache');
	return path.join(base, 'wp-tooling', 'remote');
}

/**
 * Build the absolute raw-content URL for a remote scaffold file.
 * Collapses leading/trailing slashes on each component so authors can write
 * `path: "scaffolds/ci/test-php"` or `path: "scaffolds/ci/test-php/"`
 * interchangeably.
 *
 * @param {Object} repository `{ github, ref, path }`.
 * @param {string} relPath    File relative to `repository.path`.
 * @return {string} Absolute URL.
 */
function composeUrl(repository, relPath) {
	const strip = (s) => String(s).replace(/^\/+|\/+$/g, '');
	const parts = [
		strip(repository.github),
		strip(repository.ref),
		strip(repository.path),
		strip(relPath),
	].filter((s) => s.length > 0);
	return `${RAW_GITHUB_BASE}/${parts.join('/')}`;
}

/**
 * SHA-256 hex of a string. Used as the cache filename.
 *
 * @param {string} url Absolute URL whose body is being cached.
 * @return {string} 64-character lowercase hex digest.
 */
function hashUrl(url) {
	return crypto.createHash('sha256').update(url).digest('hex');
}

/**
 * One-shot HTTPS GET returning the raw body as a UTF-8 string.
 * Surfaces non-2xx as a ScaffoldError with `code: 'EFETCHFAIL'`,
 * `statusCode`, and `rateLimited` heuristic.
 *
 * @param {string} url
 * @param {Object} [options]
 * @param {string} [options.token]   Bearer token (e.g. `WP_TOOLING_GITHUB_TOKEN`).
 * @param {number} [options.timeout] Per-request timeout in ms (default 10000).
 * @return {Promise<string>} Body text.
 */
function getText(url, options = {}) {
	return new Promise((resolve, reject) => {
		const headers = {
			'User-Agent': USER_AGENT,
			Accept: 'text/plain, */*',
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
					reject(
						new ScaffoldError(
							'EFETCHFAIL',
							`rate limited by ${url} (set WP_TOOLING_GITHUB_TOKEN to raise the quota)`,
							{ url, statusCode: status, rateLimited: true }
						)
					);
					return;
				}
				if (status < 200 || status >= 300) {
					reject(
						new ScaffoldError(
							'EFETCHFAIL',
							`GET ${url} returned HTTP ${status}`,
							{ url, statusCode: status }
						)
					);
					return;
				}
				resolve(body);
			});
		});
		request.on('timeout', () => {
			request.destroy();
			reject(
				new ScaffoldError(
					'EFETCHFAIL',
					`request to ${url} timed out after ${timeout}ms`,
					{ url, timeout }
				)
			);
		});
		request.on('error', (err) => {
			reject(
				new ScaffoldError(
					'EFETCHFAIL',
					`request to ${url} failed: ${err.message}`,
					{ url, cause: err.message }
				)
			);
		});
	});
}

/**
 * Fetch one file from a remote scaffold repo — either the scaffold's
 * `scaffold.json` manifest or one of its template bodies. Reads from cache
 * when the ref is immutable and a cached copy exists; otherwise hits the
 * network and (for immutable refs) writes the body to cache.
 *
 * @param {Object}   repository      `{ github, ref, path }`.
 * @param {string}   relPath         File relative to `repository.path` (e.g. `scaffold.json` or a `files[].src`).
 * @param {Object}   [opts]          Fetch options.
 * @param {string}   [opts.cacheDir] Override the default cache dir (test seam).
 * @param {boolean}  [opts.refresh]  Force a re-fetch even when cached.
 * @param {string}   [opts.token]    Bearer token; defaults to env `WP_TOOLING_GITHUB_TOKEN`.
 * @param {string[]} [opts.warnings] When supplied, soft errors (e.g. cache write failures) are pushed here instead of throwing.
 * @return {Promise<string>} The file contents, UTF-8.
 * @throws {ScaffoldError} `EFETCHFAIL` on HTTP / network failure.
 */
async function fetchRemoteFile(repository, relPath, opts = {}) {
	const url = composeUrl(repository, relPath);
	const cacheable = isCacheableRef(repository.ref);
	const cacheDir = opts.cacheDir || defaultCacheDir();
	const cachePath = path.join(cacheDir, hashUrl(url));

	if (cacheable && !opts.refresh) {
		try {
			return await fs.readFile(cachePath, 'utf8');
		} catch (err) {
			// Cache miss is the common case; only surface unexpected errors.
			if (err && err.code !== 'ENOENT') {
				const note = `cache read failed for ${cachePath}: ${err.message}`;
				if (Array.isArray(opts.warnings)) {
					opts.warnings.push(note);
				}
			}
		}
	}

	const token =
		opts.token ||
		(typeof process.env.WP_TOOLING_GITHUB_TOKEN === 'string' &&
		process.env.WP_TOOLING_GITHUB_TOKEN.length > 0
			? process.env.WP_TOOLING_GITHUB_TOKEN
			: undefined);

	const body = await getText(url, { token });

	if (cacheable) {
		try {
			await fs.mkdir(cacheDir, { recursive: true });
			// Write to a unique temp file then rename: rename is atomic on the
			// same filesystem, so a concurrent `add` fetching the same URL can
			// never observe a half-written cache entry.
			const tmpPath = `${cachePath}.tmp-${process.pid}-${crypto
				.randomBytes(6)
				.toString('hex')}`;
			await fs.writeFile(tmpPath, body, 'utf8');
			await fs.rename(tmpPath, cachePath);
		} catch (err) {
			const note = `cache write failed for ${cachePath}: ${err.message}`;
			if (Array.isArray(opts.warnings)) {
				opts.warnings.push(note);
			}
			// Cache failures must never block the fetch result.
		}
	}

	return body;
}

module.exports = {
	fetchRemoteFile,
	defaultCacheDir,
	isCacheableRef,
	// Exported for tests; do not rely on these from production callers.
	_internal: { composeUrl, hashUrl, getText, USER_AGENT, RAW_GITHUB_BASE },
};
