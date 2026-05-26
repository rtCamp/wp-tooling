/**
 * Minimal version-comparison helpers for the version monitor.
 *
 * Not a full semver implementation -- it handles the shapes the detectors
 * actually meet: bare `X.Y.Z`, range-prefixed (`^29.0.0`, `>=8.1`), and
 * tag-prefixed (`v4.0.2`) strings, with optional pre-release suffixes
 * (`1.2.0-beta.1`). Comparisons ignore the pre-release segment and any
 * build metadata; only the numeric `major.minor.patch` triple is ranked.
 *
 * Zero runtime dependencies -- Node built-ins only.
 */

'use strict';

/**
 * Split a version spec into its leading non-numeric prefix and the numeric
 * core. The prefix captures range operators and the `v` tag marker so the
 * updater can re-attach it when writing the new value back.
 *
 *   `^29.0.0` -> { prefix: '^',  core: '29.0.0' }
 *   `v4.0.2`  -> { prefix: 'v',  core: '4.0.2' }
 *   `>=8.1`   -> { prefix: '>=', core: '8.1' }
 *   `22.11.0` -> { prefix: '',   core: '22.11.0' }
 *
 * @param {string} spec Raw version spec.
 * @return {{prefix: string, core: string}} Prefix and numeric core (core is `''` when no digits are present).
 */
function splitVersion(spec) {
	const text = String(spec).trim();
	const match = text.match(/^([^\d]*)(\d[\w.+-]*)$/);
	if (!match) {
		return { prefix: '', core: '' };
	}
	return { prefix: match[1], core: match[2] };
}

/**
 * Parse a version spec into numeric parts plus any pre-release tag.
 *
 * @param {string} spec Raw version spec (prefixes and `v` tolerated).
 * @return {{major: number, minor: number, patch: number, prerelease: string}} Parsed components.
 */
function parse(spec) {
	const { core } = splitVersion(spec);
	const withoutBuild = core.split('+')[0];
	const [main, ...preParts] = withoutBuild.split('-');
	const numbers = main.split('.').map((n) => parseInt(n, 10));
	return {
		major: Number.isFinite(numbers[0]) ? numbers[0] : 0,
		minor: Number.isFinite(numbers[1]) ? numbers[1] : 0,
		patch: Number.isFinite(numbers[2]) ? numbers[2] : 0,
		prerelease: preParts.join('-'),
	};
}

/**
 * Compare two specs by their numeric `major.minor.patch` triple. Pre-release
 * and build metadata are ignored.
 *
 * @param {string} a First spec.
 * @param {string} b Second spec.
 * @return {number} `-1` when `a < b`, `1` when `a > b`, `0` when equal.
 */
function compareStable(a, b) {
	const pa = parse(a);
	const pb = parse(b);
	for (const key of ['major', 'minor', 'patch']) {
		if (pa[key] !== pb[key]) {
			return pa[key] < pb[key] ? -1 : 1;
		}
	}
	return 0;
}

/**
 * Is `latest` strictly newer than `current` (numeric comparison)?
 *
 * @param {string} latest  Candidate newer spec.
 * @param {string} current Current spec.
 * @return {boolean} True when `latest > current`.
 */
function gt(latest, current) {
	return compareStable(latest, current) > 0;
}

/**
 * Is `latest` a major-version bump over `current`?
 *
 * @param {string} current Current spec.
 * @param {string} latest  Candidate newer spec.
 * @return {boolean} True when `latest`'s major exceeds `current`'s.
 */
function isMajorBump(current, latest) {
	return parse(latest).major > parse(current).major;
}

/** Pre-release markers, including the hyphen-less forms php.net uses (`8.4.0RC1`). */
const PRERELEASE_RE = /(?:alpha|beta|rc|dev|snapshot|pre|next|canary|nightly)/i;

/**
 * Does this spec carry a pre-release marker? Catches both SemVer hyphen tags
 * (`1.0.0-rc.1`) and the hyphen-less style php.net publishes (`8.4.0RC1`).
 *
 * @param {string} spec Version spec.
 * @return {boolean} True for pre-release versions.
 */
function isPreRelease(spec) {
	return parse(spec).prerelease !== '' || PRERELEASE_RE.test(String(spec));
}

/**
 * Render the latest version using the current spec's prefix, so the rewritten
 * value matches the form already in the file (`^29.0.0` stays `^`, `v4.0.2`
 * stays `v`).
 *
 * @param {string} currentSpec The spec found in the file.
 * @param {string} latestRaw   The latest version as returned by the source.
 * @return {string} Latest version carrying the current spec's prefix.
 */
function formatLatest(currentSpec, latestRaw) {
	const { prefix } = splitVersion(currentSpec);
	const { core } = splitVersion(latestRaw);
	return `${prefix}${core || String(latestRaw).trim()}`;
}

module.exports = {
	splitVersion,
	parse,
	compareStable,
	gt,
	isMajorBump,
	isPreRelease,
	formatLatest,
};
