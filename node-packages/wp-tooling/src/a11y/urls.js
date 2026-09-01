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

/** Matches a JavaScript pa11y-ci config path (.js/.cjs/.mjs) — see resolveUrls. */
const JS_CONFIG_RE = /\.(m?js|cjs)$/i;

/**
 * Resolve the URLs to scan from the pa11y config.
 *
 * @param {Object} [options]
 * @param {string} [options.configPath] Path to the pa11y config (default `.pa11yci.json`).
 * @param {string} [options.cwd]        Project root.
 * @return {{urls: string[], configPath: string, standard: (string|undefined)}}
 *   Resolved URLs, the config path read, and the config's `defaults.standard`
 *   (undefined when the config doesn't set one).
 * @throws {RunnerError} `ENOURLS` when no URLs are available; `ECONFIGJS`
 *   when the config path is a .js/.cjs/.mjs file (this runner reads JSON
 *   configs only — see `JS_CONFIG_RE` below); `EBADJSON` when the config is
 *   JSON but malformed.
 */
function resolveUrls(options = {}) {
	const cwd = options.cwd || process.cwd();
	const configPath = resolveConfigPath(cwd, options.configPath);
	const raw = readConfigFile(configPath);
	const parsed = parseConfigJson(raw, configPath);

	const urls = extractUrls(parsed);
	if (urls.length === 0) {
		throw new RunnerError(
			'ENOURLS',
			`no "urls" entries found in ${configPath}. Add the URLs to scan there.`,
			{ configPath }
		);
	}

	const standard = parsed.defaults && parsed.defaults.standard;
	return { urls, configPath, standard };
}

/**
 * Resolve the config path and reject a JavaScript pa11y-ci config early.
 *
 * @param {string} cwd                Project root.
 * @param {string} [configPathOption] Explicit `--config` path, if any.
 * @return {string} Resolved absolute config path.
 * @throws {RunnerError} `ECONFIGJS` when the path is a .js/.cjs/.mjs file.
 */
function resolveConfigPath(cwd, configPathOption) {
	const configPath = configPathOption
		? path.resolve(cwd, configPathOption)
		: path.join(cwd, DEFAULT_CONFIG);

	// pa11y-ci itself accepts JSON or JavaScript (.js/.cjs) configs, but this
	// runner reads the config directly (to resolve URLs without shelling out)
	// and only ever scaffolds JSON (`setup/pa11y`), so a JS config is called
	// out explicitly here rather than failing with a confusing JSON.parse
	// SyntaxError below.
	if (JS_CONFIG_RE.test(configPath)) {
		throw new RunnerError(
			'ECONFIGJS',
			`${configPath} looks like a JavaScript pa11y-ci config. This runner only reads JSON pa11y-ci configs — keep a "${DEFAULT_CONFIG}" (or a --config path ending in .json) with the same "urls"/"defaults", or run pa11y-ci directly for a JavaScript config.`,
			{ configPath }
		);
	}

	return configPath;
}

/**
 * Read the pa11y config file from disk.
 *
 * @param {string} configPath Resolved config path.
 * @return {string} Raw file contents.
 * @throws {RunnerError} `ENOURLS` when the file can't be read.
 */
function readConfigFile(configPath) {
	try {
		return fs.readFileSync(configPath, 'utf8');
	} catch (err) {
		throw new RunnerError(
			'ENOURLS',
			`no URLs to scan: could not read ${configPath} (${(
				err.message || ''
			).toString()}). Add a "${DEFAULT_CONFIG}" with a "urls" array — \`wp-tooling add setup/pa11y\` can scaffold one.`,
			{ configPath }
		);
	}
}

/**
 * Parse the raw pa11y config as JSON.
 *
 * @param {string} raw        Raw file contents.
 * @param {string} configPath Config path being parsed (for the error message).
 * @return {Object} Parsed config.
 * @throws {RunnerError} `EBADJSON` when the config is malformed JSON.
 */
function parseConfigJson(raw, configPath) {
	try {
		return JSON.parse(raw);
	} catch (err) {
		throw new RunnerError(
			'EBADJSON',
			`invalid JSON in ${configPath}: ${err.message}`,
			{ configPath }
		);
	}
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
		const url = urlFromEntry(entry);
		if (url) {
			out.push(url);
		}
	}
	return out;
}

/**
 * Pull the URL string out of one `urls[]` entry, which may be a bare string
 * or a `{ url, ... }` object.
 *
 * @param {*} entry One `urls[]` entry.
 * @return {string|null} The URL, or null when `entry` isn't a usable shape.
 */
function urlFromEntry(entry) {
	if (typeof entry === 'string') {
		return entry.length > 0 ? entry : null;
	}
	if (
		entry &&
		typeof entry === 'object' &&
		typeof entry.url === 'string' &&
		entry.url.length > 0
	) {
		return entry.url;
	}
	return null;
}

module.exports = { resolveUrls, extractUrls, DEFAULT_CONFIG };
