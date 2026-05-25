/**
 * Loader + validator for `.github/version-monitor.yml`.
 *
 * The config shape is small and fixed -- two top-level keys (`sources`,
 * `policy`), with the nested mappings/lists written in inline-flow style
 * (`{ enabled: true, paths: [package.json] }`, `pr_assignees: []`). That
 * lets us hand-roll a tiny parser instead of taking a YAML dependency, which
 * the zero-runtime-dep rule forbids. Block-style nesting is intentionally not
 * supported; validation reports a clear, line-referenced error if the file
 * strays from the documented shape.
 *
 * Zero runtime dependencies -- Node built-ins only.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/** The six recognised detector sources, in report order. */
const SOURCE_NAMES = ['npm', 'actions', 'php', 'node', 'wp-cli', 'container'];

/** Per-source fallback paths used when a source omits its own `paths`. */
const DEFAULT_PATHS = {
	npm: ['package.json'],
	actions: ['.github/workflows/*.yml'],
	php: ['composer.json', '.github/workflows/*.yml'],
	node: ['.nvmrc', 'package.json', '.github/workflows/*.yml'],
	'wp-cli': ['.github/workflows/*.yml'],
	container: ['Dockerfile', '.devcontainer/devcontainer.json'],
};

/** Default config path, relative to the project root. */
const DEFAULT_CONFIG_PATH = path.join('.github', 'version-monitor.yml');

/**
 * Strip a `#` comment from a line, ignoring `#` inside single/double quotes.
 *
 * @param {string} line Raw line.
 * @return {string} Line with any trailing comment removed.
 */
function stripComment(line) {
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === "'" && !inDouble) {
			inSingle = !inSingle;
		} else if (ch === '"' && !inSingle) {
			inDouble = !inDouble;
		} else if (ch === '#' && !inSingle && !inDouble) {
			return line.slice(0, i);
		}
	}
	return line;
}

/**
 * Parse a scalar token: booleans, null, integers, floats, quoted and bare
 * strings.
 *
 * @param {string} raw Token text.
 * @return {boolean|number|string|null} Parsed value.
 */
function parseScalar(raw) {
	const value = raw.trim();
	if (value === '') {
		return '';
	}
	if (value === 'true') {
		return true;
	}
	if (value === 'false') {
		return false;
	}
	if (value === 'null' || value === '~') {
		return null;
	}
	if (/^-?\d+$/.test(value)) {
		return parseInt(value, 10);
	}
	if (/^-?\d+\.\d+$/.test(value)) {
		return parseFloat(value);
	}
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}
	return value;
}

/**
 * Split a flow-collection body on top-level commas, respecting nested
 * `[]`/`{}` and quotes.
 *
 * @param {string} inner Text between the enclosing brackets.
 * @return {string[]} Trimmed, non-empty parts.
 */
function splitFlow(inner) {
	const parts = [];
	let depth = 0;
	let inSingle = false;
	let inDouble = false;
	let start = 0;
	for (let i = 0; i < inner.length; i++) {
		const ch = inner[i];
		if (ch === "'" && !inDouble) {
			inSingle = !inSingle;
		} else if (ch === '"' && !inSingle) {
			inDouble = !inDouble;
		} else if (!inSingle && !inDouble) {
			if (ch === '[' || ch === '{') {
				depth++;
			} else if (ch === ']' || ch === '}') {
				depth--;
			} else if (ch === ',' && depth === 0) {
				parts.push(inner.slice(start, i));
				start = i + 1;
			}
		}
	}
	parts.push(inner.slice(start));
	return parts.map((p) => p.trim()).filter((p) => p !== '');
}

/**
 * Parse a value token that may be an inline-flow mapping, an inline-flow list,
 * or a scalar.
 *
 * @param {string} raw Value text.
 * @return {*} Parsed value.
 * @throws {Error} On a malformed inline mapping entry.
 */
function parseFlow(raw) {
	const value = raw.trim();
	if (value.startsWith('{') && value.endsWith('}')) {
		const obj = {};
		for (const entry of splitFlow(value.slice(1, -1))) {
			const idx = entry.indexOf(':');
			if (idx === -1) {
				throw new Error(`malformed mapping entry "${entry}"`);
			}
			const key = String(parseScalar(entry.slice(0, idx)));
			obj[key] = parseFlow(entry.slice(idx + 1));
		}
		return obj;
	}
	if (value.startsWith('[') && value.endsWith(']')) {
		return splitFlow(value.slice(1, -1)).map((item) => parseFlow(item));
	}
	return parseScalar(value);
}

/**
 * Parse the limited two-level YAML shape into a plain object.
 *
 * @param {string} text Raw file contents.
 * @return {Object} Parsed mapping.
 * @throws {Error} On a malformed or unexpectedly-nested line.
 */
function parseConfigYaml(text) {
	const root = {};
	let currentKey = null;
	const lines = text.split(/\r?\n/);
	for (let n = 0; n < lines.length; n++) {
		const stripped = stripComment(lines[n]).replace(/\s+$/, '');
		if (stripped.trim() === '') {
			continue;
		}
		const indent = stripped.length - stripped.trimStart().length;
		const content = stripped.trim();
		const colon = content.indexOf(':');
		if (colon === -1) {
			throw new Error(
				`version-monitor: malformed config line ${n + 1}: "${content}"`
			);
		}
		const key = String(parseScalar(content.slice(0, colon)));
		const rest = content.slice(colon + 1).trim();
		const parsedValue = rest === '' ? {} : parseFlow(rest);
		if (indent === 0) {
			currentKey = key;
			root[key] = parsedValue;
			continue;
		}
		const parent = currentKey !== null ? root[currentKey] : null;
		if (!parent || typeof parent !== 'object' || Array.isArray(parent)) {
			throw new Error(
				`version-monitor: unexpected indented config line ${n + 1}: "${content}"`
			);
		}
		parent[key] = parsedValue;
	}
	return root;
}

/**
 * Validate the parsed config and normalise it: every known source is present
 * (disabled by default) with an `enabled` boolean and a resolved `paths`
 * array.
 *
 * @param {Object} parsed Output of `parseConfigYaml`.
 * @param {string} file   Absolute config path, for error messages.
 * @return {{sources: Object, policy: Object}} Normalised config.
 * @throws {Error} On any schema violation, naming the file.
 */
function validate(parsed, file) {
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error(
			`version-monitor: config "${file}" is empty or not a mapping`
		);
	}
	const sources = parsed.sources;
	if (!sources || typeof sources !== 'object' || Array.isArray(sources)) {
		throw new Error(
			`version-monitor: config "${file}" is missing a "sources" mapping`
		);
	}

	const normalised = {};
	for (const [name, value] of Object.entries(sources)) {
		if (!SOURCE_NAMES.includes(name)) {
			throw new Error(
				`version-monitor: unknown source "${name}" in "${file}" (expected one of: ${SOURCE_NAMES.join(', ')})`
			);
		}
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			throw new Error(
				`version-monitor: source "${name}" in "${file}" must be a mapping (got ${JSON.stringify(value)})`
			);
		}
		const enabled = value.enabled === true;
		const paths =
			value.paths === undefined ? DEFAULT_PATHS[name] : value.paths;
		if (!Array.isArray(paths) || paths.some((p) => typeof p !== 'string')) {
			throw new Error(
				`version-monitor: source "${name}" in "${file}" has an invalid "paths" (expected an array of strings)`
			);
		}
		if (enabled && paths.length === 0) {
			throw new Error(
				`version-monitor: source "${name}" in "${file}" is enabled but lists no "paths"`
			);
		}
		normalised[name] = { enabled, paths };
	}

	for (const name of SOURCE_NAMES) {
		if (!normalised[name]) {
			normalised[name] = { enabled: false, paths: DEFAULT_PATHS[name] };
		}
	}

	const policy =
		parsed.policy &&
		typeof parsed.policy === 'object' &&
		!Array.isArray(parsed.policy)
			? parsed.policy
			: {};

	return { sources: normalised, policy };
}

/**
 * Load, parse, and validate the version-monitor config.
 *
 * @param {string} [cwd=process.cwd()] Project root.
 * @param {string} [configPath]        Override path (relative to `cwd` or absolute).
 * @return {{sources: Object, policy: Object}} Normalised config.
 * @throws {Error} When the file is missing, unreadable, malformed, or invalid.
 */
function loadConfig(cwd = process.cwd(), configPath) {
	const rel = configPath || DEFAULT_CONFIG_PATH;
	const abs = path.isAbsolute(rel) ? rel : path.join(cwd, rel);

	if (!fs.existsSync(abs)) {
		throw new Error(
			`version-monitor: config not found at "${abs}". Add .github/version-monitor.yml to enable the version monitor.`
		);
	}

	let raw;
	try {
		raw = fs.readFileSync(abs, 'utf8');
	} catch (err) {
		throw new Error(
			`version-monitor: cannot read config "${abs}": ${err.message}`
		);
	}

	let parsed;
	try {
		parsed = parseConfigYaml(raw);
	} catch (err) {
		throw err.message.startsWith('version-monitor:')
			? err
			: new Error(
					`version-monitor: failed to parse "${abs}": ${err.message}`
				);
	}

	return validate(parsed, abs);
}

module.exports = {
	loadConfig,
	parseConfigYaml,
	validate,
	SOURCE_NAMES,
	DEFAULT_PATHS,
	DEFAULT_CONFIG_PATH,
};
