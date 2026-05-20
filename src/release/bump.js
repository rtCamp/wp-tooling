/**
 * Version-bump library.
 *
 * Walks the standard set of locations a WordPress plugin keeps its
 * version in and rewrites each one consistently:
 *
 *   1. `package.json`              -- `version` field
 *   2. `composer.json` (optional)  -- `version` field, only if present
 *   3. Plugin entry `Version:`     -- WordPress plugin header
 *   4. Plugin entry `*_VERSION`    -- PHP constant (define or const)
 *
 * The constant name is derived from the plugin slug
 * (`my-plugin` -> `MY_PLUGIN_VERSION`) by default, or read from
 * `package.json` `config.constantPrefix` when set. If no constant of
 * that name is found in the entry file, the rewrite is a silent no-op
 * for that location -- not an error, because some plugins don't declare
 * one.
 *
 * Writes are atomic per file (write-to-temp + rename). All writes are
 * staged before any rename runs, so a parse / format failure on file N
 * leaves files 1..N-1 untouched.
 *
 * Zero runtime dependencies.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { loadContext } = require('./context');

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const VALID_BUMP_TYPES = ['patch', 'minor', 'major'];
const CONSTANT_PREFIX_RE = /^[A-Z][A-Z0-9_]*$/;

/**
 * Compute the next semver from a current version + bump type, or use an
 * explicit override.
 *
 * @param {string}                  current  Current `X.Y.Z` version.
 * @param {'patch'|'minor'|'major'} type     Bump type (ignored when `explicit` is set).
 * @param {string|null|undefined}   explicit Explicit `X.Y.Z` override, or null.
 * @return {string} New `X.Y.Z` version.
 * @throws {Error} On malformed `current`, malformed `explicit`, or unknown `type`.
 */
function nextVersion(current, type, explicit) {
	if (explicit) {
		if (!SEMVER_RE.test(explicit)) {
			throw new Error(
				`release: --to value "${explicit}" is not a valid X.Y.Z semver`
			);
		}
		return explicit;
	}
	if (!SEMVER_RE.test(current)) {
		throw new Error(
			`release: current version "${current}" is not a valid X.Y.Z semver`
		);
	}
	if (!VALID_BUMP_TYPES.includes(type)) {
		throw new Error(
			`release: --type must be patch|minor|major, got "${type}"`
		);
	}
	const parts = current.split('.').map(Number);
	if (type === 'major') {
		return `${parts[0] + 1}.0.0`;
	}
	if (type === 'minor') {
		return `${parts[0]}.${parts[1] + 1}.0`;
	}
	return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

/**
 * Convert a kebab-case slug to UPPER_SNAKE_CASE.
 *
 * @param {string} slug Kebab-case identifier.
 * @return {string} UPPER_SNAKE form.
 */
function slugToConstantPrefix(slug) {
	return slug.replace(/-/g, '_').toUpperCase();
}

/**
 * Detect the JSON indent used by a source file. Falls back to 4 spaces
 * -- the value the rest of this repo uses -- when nothing useful can be
 * sniffed. Returns a string when the file uses tabs.
 *
 * @param {string} source Raw file contents.
 * @return {number|string} Indent width or literal indent string.
 */
function detectJsonIndent(source) {
	const match = source.match(/\n(\s+)["{[]/);
	if (!match) {
		return 4;
	}
	const indent = match[1];
	if (indent.includes('\t')) {
		return '\t';
	}
	return indent.length || 4;
}

/**
 * Rewrite the `version` field of a JSON file, preserving the existing
 * indent. Returns `null` (the file is unchanged) when the file has no
 * `version` key -- callers use this to skip optional files like
 * `composer.json`.
 *
 * @param {string} filePath   Absolute path to the JSON file.
 * @param {string} newVersion New `X.Y.Z` to write.
 * @return {string|null} New file contents, or `null` if no version field exists.
 */
function rewriteJsonVersion(filePath, newVersion) {
	const raw = fs.readFileSync(filePath, 'utf8');
	const json = JSON.parse(raw);
	if (typeof json.version !== 'string') {
		return null;
	}
	if (json.version === newVersion) {
		return raw;
	}
	const indent = detectJsonIndent(raw);
	const trailingNewline = raw.endsWith('\n');
	json.version = newVersion;
	return JSON.stringify(json, null, indent) + (trailingNewline ? '\n' : '');
}

/**
 * Rewrite the WordPress plugin header `Version:` line and any
 * `*_VERSION` constant matching `constantName`. The constant name is
 * preserved -- only its value is replaced.
 *
 * @param {string} body         Source file contents.
 * @param {string} newVersion   Target version string.
 * @param {string} constantName Expected constant name (e.g. `MY_PLUGIN_VERSION`).
 * @return {{ body: string, headerWritten: boolean, constantWritten: boolean }} Result.
 */
function rewritePluginEntry(body, newVersion, constantName) {
	let headerWritten = false;
	let constantWritten = false;

	const headerRe = /^([ \t]*\*?\s*Version:\s*)(\S.*)$/m;
	if (headerRe.test(body)) {
		body = body.replace(headerRe, (_match, prefix) => {
			headerWritten = true;
			return `${prefix}${newVersion}`;
		});
	}

	if (constantName) {
		const defineRe = new RegExp(
			`(define\\s*\\(\\s*['"]${constantName}['"]\\s*,\\s*['"])([^'"]*)(['"])`,
			'g'
		);
		body = body.replace(defineRe, (_match, prefix, _value, suffix) => {
			constantWritten = true;
			return `${prefix}${newVersion}${suffix}`;
		});

		const constRe = new RegExp(
			`(const\\s+${constantName}\\s*=\\s*['"])([^'"]*)(['"])`,
			'g'
		);
		body = body.replace(constRe, (_match, prefix, _value, suffix) => {
			constantWritten = true;
			return `${prefix}${newVersion}${suffix}`;
		});
	}

	return { body, headerWritten, constantWritten };
}

/**
 * Write `contents` to `filePath` atomically: write to a sibling tempfile
 * first, then `rename` over the target. `rename` is atomic on a single
 * filesystem.
 *
 * @param {string} filePath Target path.
 * @param {string} contents Body to write.
 */
function atomicWrite(filePath, contents) {
	const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
	fs.writeFileSync(tmp, contents);
	fs.renameSync(tmp, filePath);
}

/**
 * Run the bump.
 *
 * @param {{ cwd?: string, type?: string, to?: string|null, dryRun?: boolean }} options Bump options.
 * @return {{ from: string, to: string, changed: string[], dryRun: boolean }} Summary; `changed` paths are relative to `cwd`.
 */
function bump(options = {}) {
	const cwd = options.cwd || process.cwd();
	const type = options.type || 'patch';
	const to = options.to || null;
	const dryRun = options.dryRun === true;

	const ctx = loadContext(cwd);
	const newVersion = nextVersion(ctx.currentVersion, type, to);

	const constantPrefix =
		(ctx.packageJson.config && ctx.packageJson.config.constantPrefix) ||
		slugToConstantPrefix(ctx.pluginSlug);
	if (!CONSTANT_PREFIX_RE.test(constantPrefix)) {
		throw new Error(
			`release: invalid constantPrefix "${constantPrefix}" -- must match ${CONSTANT_PREFIX_RE.source}`
		);
	}
	const constantName = `${constantPrefix}_VERSION`;

	const writes = [];

	const newPackageJson = rewriteJsonVersion(ctx.packageJsonPath, newVersion);
	if (newPackageJson !== null) {
		writes.push({ path: ctx.packageJsonPath, contents: newPackageJson });
	}

	if (ctx.composerJsonPath) {
		const newComposerJson = rewriteJsonVersion(
			ctx.composerJsonPath,
			newVersion
		);
		if (newComposerJson !== null) {
			writes.push({
				path: ctx.composerJsonPath,
				contents: newComposerJson,
			});
		}
	}

	const entryBody = fs.readFileSync(ctx.pluginEntry, 'utf8');
	const rewritten = rewritePluginEntry(entryBody, newVersion, constantName);
	if (!rewritten.headerWritten) {
		throw new Error(
			`release: plugin entry "${path.relative(
				cwd,
				ctx.pluginEntry
			)}" has no "Version:" header to update`
		);
	}
	writes.push({ path: ctx.pluginEntry, contents: rewritten.body });

	if (!dryRun) {
		for (const w of writes) {
			atomicWrite(w.path, w.contents);
		}
	}

	return {
		from: ctx.currentVersion,
		to: newVersion,
		changed: writes.map((w) => path.relative(cwd, w.path)),
		dryRun,
	};
}

module.exports = {
	bump,
	nextVersion,
	rewritePluginEntry,
	rewriteJsonVersion,
	slugToConstantPrefix,
};
