/**
 * Resolve the URL list the a11y runner should scan.
 *
 * URLs come from the project's pa11y config — `.pa11yci.json` by default,
 * or an explicit `--config` path. Read-only — never mutates the config.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { RunnerError } = require('./errors');

/** Default pa11y-ci config filename, relative to the project root. */
const DEFAULT_CONFIG = '.pa11yci.json';

/**
 * Resolve the URLs to scan from the pa11y config.
 *
 * @param {Object} [options]
 * @param {string} [options.configPath] Path to the pa11y config (default `.pa11yci.json`).
 * @param {string} [options.cwd]        Project root.
 * @return {{urls: string[], configPath: string}} Resolved URLs and the config path read.
 * @throws {RunnerError} `ENOURLS` when no URLs are available; `EBADJSON` when the config is malformed.
 */
function resolveUrls(options = {}) {
	const cwd = options.cwd || process.cwd();
	const configPath = options.configPath
		? path.resolve(cwd, options.configPath)
		: path.join(cwd, DEFAULT_CONFIG);

	let raw;
	try {
		raw = fs.readFileSync(configPath, 'utf8');
	} catch (err) {
		throw new RunnerError(
			'ENOURLS',
			`no URLs to scan: could not read ${configPath} (${(
				err.message || ''
			).toString()}). Add a "${DEFAULT_CONFIG}" with a "urls" array — \`wp-tooling add setup/pa11y\` can scaffold one.`,
			{ configPath }
		);
	}

	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new RunnerError(
			'EBADJSON',
			`invalid JSON in ${configPath}: ${err.message}`,
			{ configPath }
		);
	}

	const urls = extractUrls(parsed);
	if (urls.length === 0) {
		throw new RunnerError(
			'ENOURLS',
			`no "urls" entries found in ${configPath}. Add the URLs to scan there.`,
			{ configPath }
		);
	}

	return { urls, configPath };
}

/**
 * Pull the URL strings out of a parsed pa11y config. pa11y-ci accepts both
 * bare strings and `{ url, ... }` objects in `urls[]`.
 *
 * @param {Object} config Parsed pa11y config.
 * @return {string[]} URL strings.
 */
function extractUrls(config) {
	if (!config || !Array.isArray(config.urls)) {
		return [];
	}
	const out = [];
	for (const entry of config.urls) {
		if (typeof entry === 'string' && entry.length > 0) {
			out.push(entry);
		} else if (
			entry &&
			typeof entry === 'object' &&
			typeof entry.url === 'string' &&
			entry.url.length > 0
		) {
			out.push(entry.url);
		}
	}
	return out;
}

module.exports = { resolveUrls, extractUrls, DEFAULT_CONFIG };
