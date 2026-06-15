/**
 * WP-CLI detector -- finds a newer WP-CLI release than the version referenced
 * in the configured workflow files.
 *
 * WP-CLI is pinned in many shapes (a Docker tag `wp-cli/wp-cli:2.10.0`, an
 * env var `WP_CLI_VERSION: 2.10.0`, an input, ...), so this scans any line
 * mentioning `wp-cli`/`wp_cli` for a `major.minor[.patch]` token and compares
 * it to the latest release of `wp-cli/wp-cli` on GitHub. Best-effort by
 * design; ambiguous lines simply produce no update.
 *
 * Zero runtime dependencies -- Node built-ins via the shared `http` helper.
 */

'use strict';

const { getJson, isClientError } = require('../http');
const semver = require('../semver');
const { expandPaths, readFileSafe, recordError } = require('../util');

/** Latest-release endpoint for the WP-CLI project. */
const RELEASE = 'https://api.github.com/repos/wp-cli/wp-cli/releases/latest';

/** A `major.minor[.patch]` token, optionally `v`-prefixed. */
const VERSION_TOKEN_RE = /v?\d+\.\d+(?:\.\d+)?/;

/**
 * Gather WP-CLI version pins from the configured files.
 *
 * @param {string}   cwd   Project root.
 * @param {string[]} files Resolved cwd-relative paths.
 * @return {Array<{file: string, value: string}>} Distinct pins.
 */
function collectPins(cwd, files) {
	const pins = [];
	const seen = new Set();
	for (const file of files) {
		const text = readFileSafe(cwd, file);
		if (text === null) {
			continue;
		}
		for (const line of text.split(/\r?\n/)) {
			if (!/wp[-_]cli/i.test(line)) {
				continue;
			}
			const match = line.match(VERSION_TOKEN_RE);
			if (!match) {
				continue;
			}
			const value = match[0];
			const key = `${file}::${value}`;
			if (!seen.has(key)) {
				seen.add(key);
				pins.push({ file, value });
			}
		}
	}
	return pins;
}

/**
 * Detect WP-CLI updates.
 *
 * @param {Object} config        Normalised config.
 * @param {Object} [options]
 * @param {string} [options.cwd] Project root.
 * @return {Promise<Object[]>} Update records.
 */
async function detect(config, options = {}) {
	const cwd = options.cwd || process.cwd();
	const files = expandPaths(cwd, config.sources['wp-cli'].paths);
	const pins = collectPins(cwd, files);
	if (pins.length === 0) {
		return [];
	}

	let tag;
	try {
		const data = await getJson(RELEASE, {
			token: process.env.GITHUB_TOKEN,
			headers: { Accept: 'application/vnd.github+json' },
		});
		tag = data && data.tag_name;
	} catch (err) {
		process.stderr.write(
			`version-monitor: wp-cli lookup failed: ${err.message}\n`
		);
		if (!err.rateLimited && !isClientError(err)) {
			recordError(options, `wp-cli: ${err.message}`);
		}
		return [];
	}
	if (!tag || semver.isPreRelease(tag)) {
		return [];
	}

	const updates = [];
	for (const { file, value } of pins) {
		if (!semver.gt(tag, value)) {
			continue;
		}
		updates.push({
			source: 'wp-cli',
			file,
			package: 'wp-cli',
			currentValue: value,
			latestValue: semver.formatLatest(value, tag),
			reason: 'newer-release',
		});
	}
	return updates;
}

module.exports = { detect, collectPins };
