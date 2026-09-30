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
		command: [
			'npx',
			'--no-install',
			'wp-env',
			'run',
			'cli',
			'--env-cwd=.',
			'--',
			'wp',
		],
		shim: 'server-profile.php',
		top: 15,
	},
	thresholds: {
		cwv: 'poor',
		lighthousePerformance: 0.5,
	},
};

/** Accepted `thresholds.cwv` modes (see `normalize.js` `isCwvIssue`). */
const CWV_MODES = ['poor', 'needs-improvement', 'never'];

/**
 * Describe why a section field's value is invalid, judged against the type of
 * its built-in default. Unknown keys are not checked — they are never read.
 *
 * @param {string} key   Field name.
 * @param {*}      value Configured value.
 * @param {*}      def   Built-in default for the field.
 * @return {string|null} What was expected, or `null` when the value is valid.
 */
function fieldProblem(key, value, def) {
	if (Array.isArray(def)) {
		return Array.isArray(value) &&
			value.length > 0 &&
			value.every((v) => typeof v === 'string' && v.length > 0)
			? null
			: 'a non-empty array of strings';
	}
	if (typeof def === 'number') {
		return Number.isFinite(value) && value >= 0
			? null
			: 'a non-negative number';
	}
	if (key === 'cwv') {
		return CWV_MODES.includes(value)
			? null
			: `one of ${CWV_MODES.map((m) => `"${m}"`).join(', ')}`;
	}
	return typeof value === typeof def ? null : `a ${typeof def}`;
}

/**
 * Reject a parsed config whose known fields have the wrong type, so a typo
 * like `"enabled": "false"` cannot silently invert a layer or surface later
 * as a degraded layer instead of a config error.
 *
 * @param {*}      raw        Parsed config.
 * @param {string} configPath Config path, for the error message.
 * @throws {RunnerError} `EBADCONFIG` naming the first invalid field.
 */
function validateConfig(raw, configPath) {
	const fail = (field, expected) => {
		throw new RunnerError(
			'EBADCONFIG',
			`invalid ${configPath}: "${field}" must be ${expected}`,
			{ configPath }
		);
	};
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		fail('(root)', 'an object');
	}
	if (raw.urls !== undefined && !Array.isArray(raw.urls)) {
		fail('urls', 'an array of URL strings');
	}
	for (const section of Object.keys(DEFAULTS)) {
		const override = raw[section];
		if (section === 'urls' || override === undefined) {
			continue;
		}
		if (
			!override ||
			typeof override !== 'object' ||
			Array.isArray(override)
		) {
			fail(section, 'an object');
		}
		for (const [key, def] of Object.entries(DEFAULTS[section])) {
			if (override[key] === undefined) {
				continue;
			}
			const expected = fieldProblem(key, override[key], def);
			if (expected) {
				fail(`${section}.${key}`, expected);
			}
		}
	}
}

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
 *   is malformed; `EBADCONFIG` when a known field has the wrong type or value;
 *   `ECONFIGREAD` when the config path exists but could not be read.
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
		validateConfig(raw, configPath);
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
