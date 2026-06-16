/**
 * Remote-file fetcher for scaffolds discovered via `sources.json`
 * (`src/scaffolds/sources.js`). Fetches a repo's `index.json`, a remote
 * scaffold's `scaffold.json` manifest, and its template bodies.
 *
 * Composes a `raw.githubusercontent.com` URL from `{ repository, ref, path }` plus
 * a relative file path, fetches it over HTTPS, and caches the body on disk.
 * The cache is **always** written and validated by ETag: on a later read we
 * issue a conditional request (`If-None-Match`) and serve the cached body on
 * `304 Not Modified`, only re-downloading when the content at that ref has
 * actually changed. A pinned SHA never changes; a movable tag (e.g. `v1`)
 * refreshes when it moves. The cache layout is flat — one file per URL, named
 * by SHA-256 of that URL, with a sibling `.etag` file — so `cache clear` is a
 * single recursive remove.
 *
 * Zero runtime npm dependencies; Node built-ins only. Shape mirrors
 * `src/version-monitor/http.js` (User-Agent header, 10s timeout, status-code
 * surfacing) so tests can mock `node:https` the same way.
 *
 * On non-2xx (other than 304) / timeout / network failure with no usable
 * cache, throws `ScaffoldError` with `code: 'EFETCHFAIL'`, attaching `url`,
 * `statusCode`, and `rateLimited` (a heuristic flag set on HTTP 403 responses
 * that look rate-limited).
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
 * Cache directory: respects `$XDG_CACHE_HOME` (Linux convention) and falls
 * back to `~/.cache/`. The `wp-tooling/remote/` sub-path is dedicated to this
 * feature so `cache clear` only touches our own files.
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
 * Build the absolute raw-content URL for a remote scaffold file. Collapses
 * leading/trailing slashes on each component so authors can write
 * `path: "scaffolds/ci/test-php"` or `path: "scaffolds/ci/test-php/"`
 * interchangeably.
 *
 * @param {Object} source  `{ repository, ref, path }`.
 * @param {string} relPath File relative to `source.path`.
 * @return {string} Absolute URL.
 */
function composeUrl(source, relPath) {
	const strip = (s) => String(s).replace(/^\/+|\/+$/g, '');
	const parts = [
		strip(source.repository),
		strip(source.ref),
		strip(source.path),
		strip(relPath),
	].filter((s) => s.length > 0);
	return `${RAW_GITHUB_BASE}/${parts.join('/')}`;
}

/**
 * SHA-256 hex digest of a string. Shared primitive used both for cache
 * filenames (hashUrl) and remote-manifest integrity checks (registry.js).
 *
 * @param {string} s Input string.
 * @return {string} 64-character lowercase hex digest.
 */
function sha256Hex(s) {
	return crypto.createHash('sha256').update(s).digest('hex');
}

/**
 * SHA-256 hex of a URL. Used as the cache filename.
 *
 * @param {string} url Absolute URL whose body is being cached.
 * @return {string} 64-character lowercase hex digest.
 */
function hashUrl(url) {
	return sha256Hex(url);
}

/**
 * One-shot HTTPS GET. Resolves `{ status, body, etag }` for any 2xx **and**
 * for `304 Not Modified` (so a conditional request can be answered from
 * cache). Rejects with `EFETCHFAIL` on other non-2xx, timeout, or network
 * error.
 *
 * @param {string} url
 * @param {Object} [options]
 * @param {string} [options.token]   Bearer token (e.g. `WP_TOOLING_GITHUB_TOKEN`).
 * @param {string} [options.etag]    Prior ETag — sent as `If-None-Match`.
 * @param {number} [options.timeout] Per-request timeout in ms (default 10000).
 * @return {Promise<{status: number, body: string, etag: (string|null)}>} The response status, body, and ETag.
 */
function httpGet(url, options = {}) {
	return new Promise((resolve, reject) => {
		const headers = {
			'User-Agent': USER_AGENT,
			Accept: 'text/plain, */*',
		};
		if (options.token) {
			headers.Authorization = `Bearer ${options.token}`;
		}
		if (options.etag) {
			headers['If-None-Match'] = options.etag;
		}
		const timeout = options.timeout || DEFAULT_TIMEOUT_MS;
		const request = https.get(url, { headers, timeout }, (res) => {
			const status = res.statusCode || 0;
			const etag =
				(res.headers && (res.headers.etag || res.headers.ETag)) || null;
			let body = '';
			res.setEncoding('utf8');
			res.on('data', (chunk) => {
				body += chunk;
			});
			res.on('end', () => {
				if (status === 304) {
					resolve({ status, body: '', etag });
					return;
				}
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
				resolve({ status, body, etag });
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

function resolveToken(opts) {
	return (
		opts.token ||
		(typeof process.env.WP_TOOLING_GITHUB_TOKEN === 'string' &&
		process.env.WP_TOOLING_GITHUB_TOKEN.length > 0
			? process.env.WP_TOOLING_GITHUB_TOKEN
			: undefined)
	);
}

async function readCacheEntry(cachePath) {
	let body;
	try {
		body = await fs.readFile(cachePath, 'utf8');
	} catch (err) {
		if (err && err.code === 'ENOENT') {
			return null;
		}
		throw err;
	}
	let etag = null;
	try {
		etag = await fs.readFile(`${cachePath}.etag`, 'utf8');
	} catch {
		etag = null;
	}
	return { body, etag };
}

async function writeCacheEntry(cacheDir, cachePath, body, etag, opts) {
	try {
		await fs.mkdir(cacheDir, { recursive: true });
		// Write to a unique temp file then rename: rename is atomic on the same
		// filesystem, so a concurrent `add` fetching the same URL can never
		// observe a half-written cache entry.
		const tmpPath = `${cachePath}.tmp-${process.pid}-${crypto
			.randomBytes(6)
			.toString('hex')}`;
		await fs.writeFile(tmpPath, body, 'utf8');
		await fs.rename(tmpPath, cachePath);
		if (etag) {
			await fs.writeFile(`${cachePath}.etag`, etag, 'utf8');
		}
	} catch (err) {
		const note = `cache write failed for ${cachePath}: ${err.message}`;
		if (Array.isArray(opts.warnings)) {
			opts.warnings.push(note);
		}
		// Cache failures must never block the fetch result.
	}
}

/**
 * Read a remote file from cache only, without hitting the network. Used for
 * offline id recognition (e.g. `validate` resolving a remote id from the
 * last-seen index).
 *
 * @param {Object} source          `{ repository, ref, path }`.
 * @param {string} relPath         File relative to `source.path`.
 * @param {Object} [opts]
 * @param {string} [opts.cacheDir] Override the default cache dir.
 * @return {Promise<string|null>} Cached body, or `null` when not cached.
 */
async function readCached(source, relPath, opts = {}) {
	const url = composeUrl(source, relPath);
	const cacheDir = opts.cacheDir || defaultCacheDir();
	const cachePath = path.join(cacheDir, hashUrl(url));
	const entry = await readCacheEntry(cachePath).catch(() => null);
	return entry ? entry.body : null;
}

/**
 * Fetch one file from a remote scaffold repo — the repo `index.json`, a
 * scaffold's `scaffold.json`, or one of its template bodies. Validates the
 * cache with an `If-None-Match` conditional request: a `304` serves the cached
 * body, a `200` updates it. When the network is unreachable but a cached copy
 * exists, the cached copy is served with a warning (offline tolerance);
 * otherwise the error propagates.
 *
 * @param {Object}   source          `{ repository, ref, path }`.
 * @param {string}   relPath         File relative to `source.path`.
 * @param {Object}   [opts]          Fetch options.
 * @param {string}   [opts.cacheDir] Override the default cache dir (test seam).
 * @param {boolean}  [opts.refresh]  Force a re-fetch even when cached/unchanged.
 * @param {string}   [opts.token]    Bearer token; defaults to env `WP_TOOLING_GITHUB_TOKEN`.
 * @param {string[]} [opts.warnings] When supplied, soft errors (cache write / offline fallback) are pushed here.
 * @return {Promise<string>} The file contents, UTF-8.
 * @throws {ScaffoldError} `EFETCHFAIL` on HTTP / network failure with no usable cache.
 */
async function fetchRemoteFile(source, relPath, opts = {}) {
	const url = composeUrl(source, relPath);
	const cacheDir = opts.cacheDir || defaultCacheDir();
	const cachePath = path.join(cacheDir, hashUrl(url));
	const token = resolveToken(opts);

	let cached = null;
	try {
		cached = await readCacheEntry(cachePath);
	} catch (err) {
		if (Array.isArray(opts.warnings)) {
			opts.warnings.push(
				`cache read failed for ${cachePath}: ${err.message}`
			);
		}
	}

	const conditionalEtag =
		cached && !opts.refresh ? cached.etag || undefined : undefined;

	let res;
	try {
		res = await httpGet(url, { token, etag: conditionalEtag });
	} catch (err) {
		// Offline tolerance: fall back to a cached copy only on a transport
		// error or timeout (no `statusCode`) — i.e. genuinely unreachable. An
		// HTTP status error (404 removed/wrong-path, 403 rate-limit, 5xx) is a
		// real signal and must surface, not silently serve stale content.
		if (cached && err.statusCode === undefined) {
			if (Array.isArray(opts.warnings)) {
				opts.warnings.push(
					`serving cached ${url} (offline: ${err.message})`
				);
			}
			return cached.body;
		}
		throw err;
	}

	if (res.status === 304 && cached) {
		return cached.body;
	}

	// A 304 with no cache to satisfy it is a server quirk — re-fetch
	// unconditionally so we always return a real body.
	if (res.status === 304 && !cached) {
		const fresh = await httpGet(url, { token });
		await writeCacheEntry(
			cacheDir,
			cachePath,
			fresh.body,
			fresh.etag,
			opts
		);
		return fresh.body;
	}

	await writeCacheEntry(cacheDir, cachePath, res.body, res.etag, opts);
	return res.body;
}

module.exports = {
	fetchRemoteFile,
	readCached,
	defaultCacheDir,
	sha256Hex,
	// Exported for tests; do not rely on these from production callers.
	_internal: { composeUrl, hashUrl, httpGet, USER_AGENT, RAW_GITHUB_BASE },
};
