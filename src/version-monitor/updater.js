/**
 * Updater -- applies detected updates to the files they came from.
 *
 * Consumes the same update records `detect` produces. For each record it
 * reads the source file, performs a targeted regex replacement keyed on the
 * package/value (so unrelated occurrences are never touched), and writes the
 * file back. Major bumps are skipped unless `allowMajor` is set, and every
 * action is logged. `dryRun` performs the match but writes nothing.
 *
 * Zero runtime dependencies -- Node built-ins only.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Escape a string for safe interpolation into a RegExp.
 *
 * @param {string} text Literal text.
 * @return {string} Escaped text.
 */
function escapeRe(text) {
	return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replace a JSON string value, keyed on its property name:
 * `"<key>": "<oldVal>"` -> `"<key>": "<newVal>"`.
 *
 * @param {string} contents File contents.
 * @param {string} key      Property name.
 * @param {string} oldVal   Current value.
 * @param {string} newVal   Replacement value.
 * @return {string} Updated contents.
 */
function replaceJsonValue(contents, key, oldVal, newVal) {
	const re = new RegExp(
		`("${escapeRe(key)}"\\s*:\\s*")${escapeRe(oldVal)}(")`
	);
	return contents.replace(re, `$1${newVal}$2`);
}

/**
 * Replace a workflow `uses:` action ref: `<action>@<oldRef>` -> `@<newRef>`.
 *
 * @param {string} contents File contents.
 * @param {string} action   `owner/repo[/path]`.
 * @param {string} oldRef   Current ref.
 * @param {string} newRef   Replacement ref.
 * @return {string} Updated contents.
 */
function replaceActionRef(contents, action, oldRef, newRef) {
	const re = new RegExp(
		`(${escapeRe(action)}@)${escapeRe(oldRef)}(?![\\w.-])`,
		'g'
	);
	return contents.replace(re, `$1${newRef}`);
}

/**
 * Replace a YAML scalar value (`key: <oldVal>`, quotes preserved), or a bare
 * token (e.g. the whole of `.nvmrc`).
 *
 * @param {string} contents File contents.
 * @param {string} oldVal   Current value.
 * @param {string} newVal   Replacement value.
 * @return {string} Updated contents.
 */
function replaceScalar(contents, oldVal, newVal) {
	// Global + multiline: a workflow may pin the same value in several jobs;
	// every occurrence must be rewritten, not just the first.
	const re = new RegExp(`(^|[^\\w.-])${escapeRe(oldVal)}(?![\\w.-])`, 'gm');
	return contents.replace(re, `$1${newVal}`);
}

/**
 * Replace an image tag: `<image>:<oldTag>` -> `<image>:<newTag>`.
 *
 * @param {string} contents File contents.
 * @param {string} image    Image name.
 * @param {string} oldTag   Current tag.
 * @param {string} newTag   Replacement tag.
 * @return {string} Updated contents.
 */
function replaceImageTag(contents, image, oldTag, newTag) {
	const re = new RegExp(
		`(${escapeRe(image)}:)${escapeRe(oldTag)}(?![\\w.-])`,
		'g'
	);
	return contents.replace(re, `$1${newTag}`);
}

/**
 * Compute the rewritten contents for a single update. Pure -- no filesystem
 * access.
 *
 * @param {Object} update   Update record.
 * @param {string} contents Current file contents.
 * @return {string} Rewritten contents (unchanged if nothing matched).
 */
function rewrite(update, contents) {
	const { source, file, package: pkg, currentValue, latestValue } = update;
	switch (source) {
		case 'npm':
			return replaceJsonValue(contents, pkg, currentValue, latestValue);
		case 'actions':
			return replaceActionRef(contents, pkg, currentValue, latestValue);
		case 'node':
			if (file.endsWith('package.json')) {
				return replaceJsonValue(
					contents,
					'node',
					currentValue,
					latestValue
				);
			}
			return replaceScalar(contents, currentValue, latestValue);
		case 'php':
			if (file.endsWith('.json')) {
				return replaceJsonValue(
					contents,
					'php',
					currentValue,
					latestValue
				);
			}
			return replaceScalar(contents, currentValue, latestValue);
		case 'wp-cli':
			return replaceScalar(contents, currentValue, latestValue);
		case 'container':
			if (file.endsWith('.json')) {
				return replaceJsonValue(
					contents,
					'image',
					`${pkg}:${currentValue}`,
					`${pkg}:${latestValue}`
				);
			}
			return replaceImageTag(contents, pkg, currentValue, latestValue);
		default:
			throw new Error(
				`version-monitor: cannot apply unknown update source "${source}"`
			);
	}
}

/**
 * Apply a batch of updates to disk.
 *
 * @param {Object[]} updates              Update records (as produced by `detect`).
 * @param {Object}   [options]
 * @param {string}   [options.cwd]        Project root.
 * @param {boolean}  [options.allowMajor] Apply major bumps too (default: skip them).
 * @param {boolean}  [options.dryRun]     Match but do not write.
 * @param {Function} [options.log]        Logger for each action (default: stdout).
 * @return {{written: Object[], skipped: Object[], unmatched: Object[], dryRun: boolean}} Outcome summary.
 */
function applyUpdates(updates, options = {}) {
	const cwd = options.cwd || process.cwd();
	const allowMajor = options.allowMajor === true;
	const dryRun = options.dryRun === true;
	const log =
		typeof options.log === 'function'
			? options.log
			: (line) => process.stdout.write(`${line}\n`);

	const written = [];
	const skipped = [];
	const unmatched = [];

	for (const update of updates) {
		const label = `${update.source} ${update.package} ${update.currentValue} -> ${update.latestValue}`;

		if (update.is_major && !allowMajor) {
			skipped.push(update);
			log(`[skip] major-bump-skipped: ${label} (pass --allow-major)`);
			continue;
		}

		const abs = path.join(cwd, update.file);
		let contents;
		try {
			contents = fs.readFileSync(abs, 'utf8');
		} catch (err) {
			throw new Error(
				`version-monitor: cannot read ${update.file}: ${err.message}`
			);
		}

		const next = rewrite(update, contents);
		if (next === contents) {
			unmatched.push(update);
			log(`[warn] no match for ${update.currentValue} in ${update.file}`);
			continue;
		}

		if (!dryRun) {
			fs.writeFileSync(abs, next);
		}
		written.push(update);
		log(`${dryRun ? '[dry-run] ' : ''}${update.file}: ${label}`);
	}

	return { written, skipped, unmatched, dryRun };
}

module.exports = {
	applyUpdates,
	rewrite,
	replaceJsonValue,
	replaceActionRef,
	replaceScalar,
	replaceImageTag,
	escapeRe,
};
