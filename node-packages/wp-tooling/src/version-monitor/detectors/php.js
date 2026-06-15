/**
 * PHP detector -- compares the PHP version targeted by `composer.json`
 * (`require.php`) and workflow `php-version:` fields against the latest stable
 * PHP release published on php.net.
 *
 * Only simple single-version constraints are handled (`>=8.1`, `^8.1`,
 * `8.2`); compound ranges (`^8.1 || ^8.2`) are left untouched. The target is
 * rendered at the same granularity as the current pin -- a `8.1` pin proposes
 * `8.3`, a `8.1.0` pin proposes `8.3.2` -- and the existing range prefix is
 * preserved.
 *
 * Zero runtime dependencies -- Node built-ins via the shared `http` helper.
 */

'use strict';

const { getJson, isClientError } = require('../http');
const semver = require('../semver');
const {
	expandPaths,
	readFileSafe,
	readJsonSafe,
	recordError,
} = require('../util');

/** php.net release feed; keys are branch names, each value carries `version`. */
const RELEASES = 'https://www.php.net/releases/index.php?json&max=60';

/** Matches a scalar `php-version:` value in a workflow. */
const PHP_VERSION_RE = /php-version:\s*['"]?([\d.]+)/g;

/**
 * Is the constraint a single comparable version (not a compound range)?
 *
 * @param {string} spec Constraint.
 * @return {boolean} True when a single version with at least `major.minor`.
 */
function isSimpleConstraint(spec) {
	const value = String(spec).trim();
	if (/[|,\s]/.test(value)) {
		return false;
	}
	return semver.splitVersion(value).core.includes('.');
}

/**
 * Trim a version to the same number of dotted segments as a reference.
 *
 * @param {string} reference Spec whose granularity to match.
 * @param {string} version   Version to trim.
 * @return {string} `version` trimmed to `reference`'s segment count.
 */
function matchGranularity(reference, version) {
	const segments = semver.splitVersion(reference).core.split('.').length;
	return semver
		.splitVersion(version)
		.core.split('.')
		.slice(0, segments)
		.join('.');
}

/**
 * Pick the newest stable PHP version from the release feed.
 *
 * @param {Object|Array} data php.net JSON.
 * @return {string|undefined} Newest stable version, or `undefined`.
 */
function latestStable(data) {
	const versions = Object.values(data || {})
		.map((entry) => entry && entry.version)
		.filter((v) => typeof v === 'string' && !semver.isPreRelease(v));
	if (versions.length === 0) {
		return undefined;
	}
	return versions.reduce((best, v) => (semver.gt(v, best) ? v : best));
}

/**
 * Gather PHP version pins from the configured files.
 *
 * @param {string}   cwd   Project root.
 * @param {string[]} files Resolved cwd-relative paths.
 * @return {Array<{file: string, value: string}>} Distinct pins.
 */
function collectPins(cwd, files) {
	const pins = [];
	const seen = new Set();
	const add = (file, value) => {
		if (typeof value !== 'string') {
			return;
		}
		const key = `${file}::${value.trim()}`;
		if (!seen.has(key)) {
			seen.add(key);
			pins.push({ file, value: value.trim() });
		}
	};

	for (const file of files) {
		if (file.endsWith('composer.json')) {
			const composer = readJsonSafe(cwd, file);
			const phpReq = composer && composer.require && composer.require.php;
			if (typeof phpReq === 'string') {
				add(file, phpReq);
			}
		} else {
			const text = readFileSafe(cwd, file);
			if (text === null) {
				continue;
			}
			let match;
			while ((match = PHP_VERSION_RE.exec(text)) !== null) {
				add(file, match[1]);
			}
		}
	}
	return pins;
}

/**
 * Detect PHP version updates.
 *
 * @param {Object} config        Normalised config.
 * @param {Object} [options]
 * @param {string} [options.cwd] Project root.
 * @return {Promise<Object[]>} Update records.
 */
async function detect(config, options = {}) {
	const cwd = options.cwd || process.cwd();
	const files = expandPaths(cwd, config.sources.php.paths);
	const pins = collectPins(cwd, files).filter((p) =>
		isSimpleConstraint(p.value)
	);
	if (pins.length === 0) {
		return [];
	}

	let data;
	try {
		data = await getJson(RELEASES);
	} catch (err) {
		process.stderr.write(
			`version-monitor: php releases lookup failed: ${err.message}\n`
		);
		if (!err.rateLimited && !isClientError(err)) {
			recordError(options, `php: ${err.message}`);
		}
		return [];
	}

	const newest = latestStable(data);
	if (!newest) {
		return [];
	}

	const updates = [];
	for (const { file, value } of pins) {
		const target = matchGranularity(value, newest);
		if (!semver.gt(target, value)) {
			continue;
		}
		updates.push({
			source: 'php',
			file,
			package: 'php',
			currentValue: value,
			latestValue: semver.formatLatest(value, target),
			reason: 'newer-php',
		});
	}
	return updates;
}

module.exports = {
	detect,
	collectPins,
	latestStable,
	matchGranularity,
	isSimpleConstraint,
};
