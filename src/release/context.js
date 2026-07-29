/**
 * Shared loader for the release scripts.
 *
 * Resolves the bits of project state every release CLI needs:
 *
 *   - `package.json` (required)
 *   - `composer.json` (optional)
 *   - The WordPress plugin entry file (a `*.php` at the package root
 *     carrying a `Plugin Name:` header)
 *   - The current version (taken from `package.json`)
 *   - The plugin slug (basename of the entry file, used for the zip name)
 *
 * Lives as a separate module so bump / changelog / zip don't each re-walk
 * the directory or re-parse the same headers.
 *
 * Zero runtime dependencies -- Node built-ins only.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * How many bytes at the top of a `.php` file to scan for the WP plugin
 * header. Headers are conventionally in the opening doc-block; 8 KB is
 * comfortably more than any plugin in the wild needs.
 */
const HEADER_SCAN_BYTES = 8192;

/**
 * Walk `cwd` (root only -- no recursion) looking for a `.php` file whose
 * leading bytes contain a `Plugin Name:` header. WordPress' own
 * convention is exactly one such file per plugin; this helper enforces
 * that, throwing a clear error if zero or more than one is found.
 *
 * @param {string} cwd Project root.
 * @return {string} Absolute path to the entry file.
 * @throws {Error} When no entry file, or more than one, exists at `cwd`.
 */
function findPluginEntry(cwd) {
	let entries;
	try {
		entries = fs.readdirSync(cwd, { withFileTypes: true });
	} catch (err) {
		throw new Error(
			`release: cannot read directory "${cwd}": ${err.message}`
		);
	}

	const matches = [];
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith('.php')) {
			continue;
		}
		const full = path.join(cwd, entry.name);
		const header = readHeader(full);
		if (/^[ \t*\/#]*\s*Plugin Name:\s*\S/m.test(header)) {
			matches.push(full);
		}
	}

	if (matches.length === 0) {
		throw new Error(
			`release: no plugin entry file found at "${cwd}" (expected a *.php with a "Plugin Name:" header)`
		);
	}
	if (matches.length > 1) {
		throw new Error(
			`release: multiple plugin entry files found at "${cwd}": ${matches
				.map((m) => path.basename(m))
				.join(', ')}`
		);
	}
	return matches[0];
}

/**
 * Read project state for the release CLIs.
 *
 * @param {string} cwd Project root (typically `process.cwd()`).
 * @return {Object} Project state with packageJson, packageJsonPath, composerJson, composerJsonPath, pluginEntry, pluginSlug and currentVersion.
 * @throws {Error} When `package.json` is missing, malformed, lacks a `version`, or the plugin entry file cannot be found.
 */
function loadContext(cwd) {
	const packageJsonPath = path.join(cwd, 'package.json');
	if (!fs.existsSync(packageJsonPath)) {
		throw new Error(`release: no package.json at "${cwd}"`);
	}

	let packageJson;
	try {
		packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
	} catch (err) {
		throw new Error(
			`release: failed to parse ${packageJsonPath}: ${err.message}`
		);
	}

	if (typeof packageJson.version !== 'string' || !packageJson.version) {
		throw new Error(
			`release: package.json at "${cwd}" has no "version" field`
		);
	}

	const composerJsonPath = path.join(cwd, 'composer.json');
	let composerJson = null;
	if (fs.existsSync(composerJsonPath)) {
		try {
			composerJson = JSON.parse(
				fs.readFileSync(composerJsonPath, 'utf8')
			);
		} catch (err) {
			throw new Error(
				`release: failed to parse ${composerJsonPath}: ${err.message}`
			);
		}
	}

	const pluginEntry = findPluginEntry(cwd);
	const pluginSlug = path.basename(pluginEntry, '.php');

	return {
		packageJson,
		packageJsonPath,
		composerJson,
		composerJsonPath: composerJson ? composerJsonPath : null,
		pluginEntry,
		pluginSlug,
		currentVersion: packageJson.version,
	};
}

/**
 * Read the first `HEADER_SCAN_BYTES` of a file as UTF-8. Used to scan
 * the WordPress plugin header without slurping the whole file.
 *
 * @param {string} file Absolute path.
 * @return {string} Leading content; empty string on read failure.
 */
function readHeader(file) {
	let fd;
	try {
		fd = fs.openSync(file, 'r');
	} catch {
		return '';
	}
	const buf = Buffer.alloc(HEADER_SCAN_BYTES);
	try {
		const bytes = fs.readSync(fd, buf, 0, HEADER_SCAN_BYTES, 0);
		return buf.slice(0, bytes).toString('utf8');
	} finally {
		fs.closeSync(fd);
	}
}

module.exports = {
	loadContext,
	findPluginEntry,
};
