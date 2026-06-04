/**
 * Project config file (`.wp-tooling.json`) reader/writer.
 *
 * A single small JSON file at the project root that persists choices the
 * tooling makes about a project — currently the enabled/disabled state of
 * toggleable features (see the `feature` manifest block) and any values a
 * scaffold input wants to reuse via `discover_from: "config:<key>"`.
 *
 * Shape (all fields optional):
 *   {
 *     "name": "My Theme",
 *     "namespace": "rtCamp\\Theme\\MyTheme",
 *     "textDomain": "my-theme",
 *     "features": { "tailwind": true }
 *   }
 *
 * Design notes:
 *   - Reads are tolerant: a missing or malformed file yields `{}` so callers
 *     (the `config:` discover_from resolver, the feature manager) never crash
 *     on a project that has never written one. This is what keeps the engine
 *     backward-compatible for projects with no `.wp-tooling.json`.
 *   - Synchronous fs (like validate.js): the file is tiny and both callers
 *     want a plain object, not a promise.
 *   - Zero runtime dependencies.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_FILENAME = '.wp-tooling.json';

/**
 * Absolute path to the config file for a given project directory.
 *
 * @param {string} cwd - Project directory.
 * @return {string} Absolute path to `<cwd>/.wp-tooling.json`.
 */
function configPath(cwd) {
	return path.join(cwd, CONFIG_FILENAME);
}

/**
 * Read the project config. Tolerant: returns `{}` when the file is missing,
 * unreadable, not valid JSON, or not a plain object.
 *
 * @param {string} cwd - Project directory.
 * @return {Object} Parsed config object (never null/array).
 */
function readConfig(cwd) {
	let raw;
	try {
		raw = fs.readFileSync(configPath(cwd), 'utf8');
	} catch {
		return {};
	}
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed;
		}
	} catch {
		/* fall through */
	}
	return {};
}

/**
 * Detect the indentation of a JSON document from its first indented line.
 * Returns null when no indentation is found (empty / single-line file).
 *
 * Shared with the feature manager, which uses it to edit `package.json`
 * without churning a project's existing formatting.
 *
 * @param {string} raw - Raw JSON text.
 * @return {string|null} The indent string (e.g. `"\t"` or `"  "`), or null.
 */
function detectIndent(raw) {
	const match = /^([ \t]+)\S/m.exec(raw || '');
	return match ? match[1] : null;
}

/**
 * Write the project config, pretty-printed with a trailing newline. The
 * indentation of an existing file is preserved (a theme that wrote the file
 * with tabs keeps tabs when the feature manager updates a flag); new files
 * use two spaces.
 *
 * @param {string}  cwd           - Project directory.
 * @param {Object}  config        - Config object to serialise.
 * @param {Object}  [opts]
 * @param {?string} [opts.indent] - Pre-detected indent (pass the caller's
 *                                already-read raw text's indent to skip re-reading the file). When
 *                                omitted the file is read once to detect it.
 * @return {void}
 */
function writeConfig(cwd, config, opts = {}) {
	let indent = opts.indent;
	if (indent === undefined) {
		try {
			indent = detectIndent(fs.readFileSync(configPath(cwd), 'utf8'));
		} catch {
			indent = null; // new file
		}
	}
	fs.writeFileSync(
		configPath(cwd),
		JSON.stringify(config, null, indent || 2) + '\n',
		'utf8'
	);
}

/**
 * Read the config once, returning both the parsed object and the raw text's
 * indentation, so a caller that mutates and writes back does a single read +
 * single write (instead of readConfig + writeConfig each re-reading the file).
 *
 * @param {string} cwd - Project directory.
 * @return {{config: Object, indent: ?string}} Parsed config (never null/array)
 *         and detected indent (`null` for a missing/single-line file).
 */
function readConfigWithIndent(cwd) {
	let raw;
	try {
		raw = fs.readFileSync(configPath(cwd), 'utf8');
	} catch {
		return { config: {}, indent: null };
	}
	let config = {};
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			config = parsed;
		}
	} catch {
		/* tolerant: malformed file -> {} */
	}
	return { config, indent: detectIndent(raw) };
}

/**
 * Read whether a feature is enabled (`features[key] === true`).
 *
 * @param {string} cwd - Project directory.
 * @param {string} key - Feature config key.
 * @return {boolean} True when the feature flag is truthy.
 */
function isFeatureEnabled(cwd, key) {
	const cfg = readConfig(cwd);
	return Boolean(cfg.features && cfg.features[key]);
}

/**
 * Set a feature flag and persist it, merging into any existing config.
 *
 * @param {string}  cwd     - Project directory.
 * @param {string}  key     - Feature config key.
 * @param {boolean} enabled - Desired state.
 * @return {Object} The updated config object that was written.
 */
function setFeatureEnabled(cwd, key, enabled) {
	const cfg = readConfig(cwd);
	if (!cfg.features || typeof cfg.features !== 'object') {
		cfg.features = {};
	}
	cfg.features[key] = Boolean(enabled);
	writeConfig(cwd, cfg);
	return cfg;
}

/**
 * Set a feature's flag and persist its rendered file lists in one
 * read-modify-write. The file lists let disable() remove exactly the paths
 * enable() created even if the inputs they were rendered from (e.g. a
 * `css_dir` supplied on the command line) are not reproducible later;
 * stored under `featureFiles[key]` as already-rendered relative paths.
 *
 * Replaces a setFeatureEnabled + setFeatureFiles pair (two read+write cycles,
 * with a window where the flag is set but the file list is not) with a single
 * atomic write.
 *
 * @param {string}  cwd     - Project directory.
 * @param {string}  key     - Feature config key.
 * @param {boolean} enabled - Desired flag state.
 * @param {Object}  files   - { ownedFiles, confirmRemove, gitignore } arrays.
 * @return {Object} The updated config object that was written.
 */
function setFeatureState(cwd, key, enabled, files) {
	const { config: cfg, indent } = readConfigWithIndent(cwd);
	if (!cfg.features || typeof cfg.features !== 'object') {
		cfg.features = {};
	}
	cfg.features[key] = Boolean(enabled);
	if (!cfg.featureFiles || typeof cfg.featureFiles !== 'object') {
		cfg.featureFiles = {};
	}
	cfg.featureFiles[key] = files;
	writeConfig(cwd, cfg, { indent });
	return cfg;
}

/**
 * Read the rendered file lists persisted for a feature at enable time.
 *
 * @param {string} cwd - Project directory.
 * @param {string} key - Feature config key.
 * @return {Object|null} { ownedFiles, confirmRemove, gitignore } or null.
 */
function getFeatureFiles(cwd, key) {
	const cfg = readConfig(cwd);
	const files = cfg.featureFiles && cfg.featureFiles[key];
	return files && typeof files === 'object' && !Array.isArray(files)
		? files
		: null;
}

/**
 * Drop a feature's persisted file lists (after disable removed its files).
 * Removes the whole `featureFiles` block when it becomes empty.
 *
 * @param {string} cwd - Project directory.
 * @param {string} key - Feature config key.
 * @return {void}
 */
function clearFeatureFiles(cwd, key) {
	const cfg = readConfig(cwd);
	if (!cfg.featureFiles || !(key in cfg.featureFiles)) {
		return;
	}
	delete cfg.featureFiles[key];
	if (Object.keys(cfg.featureFiles).length === 0) {
		delete cfg.featureFiles;
	}
	writeConfig(cwd, cfg);
}

module.exports = {
	CONFIG_FILENAME,
	configPath,
	detectIndent,
	readConfig,
	readConfigWithIndent,
	writeConfig,
	isFeatureEnabled,
	setFeatureEnabled,
	setFeatureState,
	getFeatureFiles,
	clearFeatureFiles,
};
