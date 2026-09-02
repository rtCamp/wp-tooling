/**
 * Resolve the perf runner's config and the URLs it should test.
 *
 * URLs and layer settings come from the project's perf config —
 * `.perfrc.json` by default, or an explicit `--config` path — mirroring
 * `src/a11y/urls.js`. Unlike the a11y config, the perf config is OPTIONAL
 * when `--url` is supplied: a project with no `.perfrc.json` can still run
 * `wp-tooling perf --url <url>` against every layer's built-in defaults.
 * Repeatable `--url` values REPLACE the config's `urls[]` entirely; every
 * other section (webVitals, lighthouse, server, thresholds) still comes
 * from the config when one is present. Read-only — never mutates the
 * config.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { RunnerError } = require('./errors');

/** Default perf config filename, relative to the project root. */
const DEFAULT_CONFIG = '.perfrc.json';

/** Built-in defaults for every config section. */
const DEFAULTS = {
	urls: [],
	webVitals: {
		settleMs: 3000,
		timeoutMs: 30000,
		chromeArgs: ['--no-sandbox'],
	},
	lighthouse: {
		enabled: true,
		categories: ['performance'],
		topAudits: 5,
	},
	server: {
		enabled: false,
		command: ['npx', 'wp-env', 'run', 'cli', '--env-cwd=.', '--', 'wp'],
		shim: 'server-profile.php',
		top: 15,
	},
	thresholds: {
		cwv: 'poor',
		lighthousePerformance: 0.5,
	},
};

/**
 * Shallow-merge a config section over its defaults.
 *
 * @param {Object} defaults Section defaults.
 * @param {*}      override Raw override value from the parsed config.
 * @return {Object} Merged section.
 */
function mergeSection(defaults, override) {
	if (!override || typeof override !== 'object' || Array.isArray(override)) {
		return { ...defaults };
	}
	return { ...defaults, ...override };
}

/**
 * Merge a raw parsed config over the built-in defaults, section by section.
 *
 * @param {*} raw Parsed config (or `null`/`undefined` when there is none).
 * @return {Object} Fully merged config.
 */
function mergeConfig(raw) {
	const cfg = raw && typeof raw === 'object' ? raw : {};
	const urls = Array.isArray(cfg.urls)
		? cfg.urls.filter((u) => typeof u === 'string' && u.length > 0)
		: DEFAULTS.urls;
	return {
		urls,
		webVitals: mergeSection(DEFAULTS.webVitals, cfg.webVitals),
		lighthouse: mergeSection(DEFAULTS.lighthouse, cfg.lighthouse),
		server: mergeSection(DEFAULTS.server, cfg.server),
		thresholds: mergeSection(DEFAULTS.thresholds, cfg.thresholds),
	};
}

/**
 * Resolve the perf config and the URLs to test.
 *
 * @param {Object}   [options]
 * @param {string}   [options.configPath] Path to the perf config (default `.perfrc.json`).
 * @param {string[]} [options.urls]       Repeatable `--url` values; replaces the config's `urls[]` when non-empty.
 * @param {string}   [options.cwd]        Project root.
 * @return {{config: Object, configPath: string|null, urls: string[]}} Resolved config, the
 *   config path actually read (`null` when none was read), and the effective URL list.
 * @throws {RunnerError} `ENOURLS` when no URLs are available; `EBADJSON` when the config
 *   is malformed; `ECONFIGREAD` when the config path exists but could not be read.
 */
function resolveConfig(options = {}) {
	const cwd = options.cwd || process.cwd();
	const explicitUrls = Array.isArray(options.urls)
		? options.urls.filter((u) => typeof u === 'string' && u.length > 0)
		: [];
	const configPath = options.configPath
		? path.resolve(cwd, options.configPath)
		: path.join(cwd, DEFAULT_CONFIG);

	let text;
	let resolvedConfigPath = configPath;
	try {
		text = fs.readFileSync(configPath, 'utf8');
	} catch (err) {
		if (err.code !== 'ENOENT') {
			throw new RunnerError(
				'ECONFIGREAD',
				`could not read ${configPath}: ${err.message}`,
				{ configPath }
			);
		}
		if (explicitUrls.length === 0) {
			throw new RunnerError(
				'ENOURLS',
				`no URLs to test: could not read ${configPath} (${(
					err.message || ''
				).toString()}). Add a "${DEFAULT_CONFIG}" with a "urls" array, or pass --url — \`wp-tooling add setup/perf\` can scaffold one.`,
				{ configPath }
			);
		}
		resolvedConfigPath = null;
	}

	let raw = null;
	if (text !== undefined) {
		try {
			raw = JSON.parse(text);
		} catch (err) {
			throw new RunnerError(
				'EBADJSON',
				`invalid JSON in ${configPath}: ${err.message}`,
				{ configPath }
			);
		}
	}

	const config = mergeConfig(raw);
	const urls = explicitUrls.length > 0 ? explicitUrls : config.urls;
	config.urls = urls;

	if (urls.length === 0) {
		throw new RunnerError(
			'ENOURLS',
			resolvedConfigPath
				? `no "urls" entries found in ${resolvedConfigPath}. Add the URLs to test there, or pass --url.`
				: `no URLs to test. Pass --url, or add a "${DEFAULT_CONFIG}" with a "urls" array — \`wp-tooling add setup/perf\` can scaffold one.`,
			{ configPath: resolvedConfigPath }
		);
	}

	return { config, configPath: resolvedConfigPath, urls };
}

module.exports = { resolveConfig, mergeConfig, DEFAULT_CONFIG, DEFAULTS };
