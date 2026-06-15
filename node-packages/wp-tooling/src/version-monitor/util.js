/**
 * Shared filesystem helpers for the version-monitor detectors.
 *
 * Detectors are handed config `paths` that may contain a single-level glob
 * (`.github/workflows/*.yml`). These helpers expand those to real, existing,
 * cwd-relative paths and read them safely. The glob is deliberately
 * minimal -- only a `*` in the final path segment is supported, which is all
 * the config shape needs and avoids pulling in a glob dependency.
 *
 * Zero runtime dependencies -- Node built-ins only.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Convert a single-segment glob (e.g. `*.yml`) to an anchored RegExp.
 *
 * @param {string} segment Glob segment containing `*` / `?` wildcards.
 * @return {RegExp} Anchored matcher for a single filename.
 */
function segmentToRegExp(segment) {
	const escaped = segment.replace(/[.+^${}()|[\]\\]/g, '\\$&');
	const pattern = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
	return new RegExp(`^${pattern}$`);
}

/**
 * Expand a list of path patterns to existing, cwd-relative file paths.
 *
 * A pattern without a wildcard is kept verbatim when the file exists. A
 * pattern whose final segment contains `*` is matched against the entries of
 * its (literal) parent directory. Results are de-duplicated and ordered for
 * deterministic output.
 *
 * @param {string}   cwd      Project root the patterns are relative to.
 * @param {string[]} patterns Path patterns from the config.
 * @return {string[]} Existing cwd-relative file paths (POSIX separators), sorted and unique.
 */
function expandPaths(cwd, patterns) {
	const found = new Set();
	for (const pattern of patterns) {
		const normalised = pattern.split(path.sep).join('/');
		if (!normalised.includes('*') && !normalised.includes('?')) {
			if (fs.existsSync(path.join(cwd, normalised))) {
				found.add(normalised);
			}
			continue;
		}
		const dir = path.posix.dirname(normalised);
		const base = path.posix.basename(normalised);
		const matcher = segmentToRegExp(base);
		let entries;
		try {
			entries = fs.readdirSync(path.join(cwd, dir));
		} catch {
			continue;
		}
		for (const name of entries.sort()) {
			if (matcher.test(name)) {
				found.add(dir === '.' ? name : path.posix.join(dir, name));
			}
		}
	}
	return [...found].sort();
}

/**
 * Read a cwd-relative file as UTF-8, returning `null` on any read failure.
 *
 * @param {string} cwd     Project root.
 * @param {string} relPath File path relative to `cwd`.
 * @return {string|null} File contents, or `null` if unreadable.
 */
function readFileSafe(cwd, relPath) {
	try {
		return fs.readFileSync(path.join(cwd, relPath), 'utf8');
	} catch {
		return null;
	}
}

/**
 * Read and JSON-parse a cwd-relative file, returning `null` on read or parse
 * failure.
 *
 * @param {string} cwd     Project root.
 * @param {string} relPath File path relative to `cwd`.
 * @return {*|null} Parsed JSON, or `null`.
 */
function readJsonSafe(cwd, relPath) {
	const text = readFileSafe(cwd, relPath);
	if (text === null) {
		return null;
	}
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/**
 * Record a hard (unexpected) detector error into the orchestrator's collector,
 * if one was provided. Lets a detector skip the failed item yet still signal
 * that the run was incomplete, so the CLI can exit non-zero.
 *
 * @param {Object}   [options]        Detector options.
 * @param {string[]} [options.errors] Shared error collector.
 * @param {string}   message          Error description.
 */
function recordError(options, message) {
	if (options && Array.isArray(options.errors)) {
		options.errors.push(message);
	}
}

module.exports = {
	segmentToRegExp,
	expandPaths,
	readFileSafe,
	recordError,
	readJsonSafe,
};
