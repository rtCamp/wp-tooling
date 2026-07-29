/**
 * npm detector -- finds newer published versions of the dependencies in each
 * `package.json` the config points at.
 *
 * Covers what Dependabot's npm ecosystem misses in our setup (e.g. packages
 * pulled through custom resolvers). Skips floating pins (`*`, `latest`) and
 * non-registry specs (`workspace:`, `file:`, git URLs) where "latest" has no
 * meaning, and ignores pre-release publishes.
 *
 * Zero runtime dependencies -- Node built-ins via the shared `http` helper.
 */

'use strict';

const { getJson, isClientError } = require('../http');
const semver = require('../semver');
const { expandPaths, readJsonSafe, recordError } = require('../util');

/** npm registry base. The `/latest` dist-tag document carries `.version`. */
const REGISTRY = 'https://registry.npmjs.org';

/**
 * Should this spec be skipped because "latest on the registry" is undefined
 * for it?
 *
 * @param {string} spec Dependency version spec.
 * @return {boolean} True when the spec is floating or non-registry.
 */
function isUnresolvable(spec) {
	const value = String(spec).trim();
	if (value === '' || value === '*' || value === 'latest') {
		return true;
	}
	if (/^(?:workspace|file|link|npm|git\+ssh|git\+https):/.test(value)) {
		return true;
	}
	return value.includes('://');
}

/**
 * Fetch the latest published version of a package.
 *
 * @param {string} name Package name (scoped names are URL-encoded).
 * @return {Promise<string|undefined>} Latest version, or `undefined`.
 */
async function fetchLatest(name) {
	// Global: a string argument replaces only the first match. Scoped names hold
	// a single '/' today, so this is defensive rather than a live fix.
	const encoded = name.replace(/\//g, '%2F');
	const data = await getJson(`${REGISTRY}/${encoded}/latest`);
	return data && data.version;
}

/**
 * Detect npm dependency updates.
 *
 * @param {Object} config        Normalised config.
 * @param {Object} [options]
 * @param {string} [options.cwd] Project root (defaults to `process.cwd()`).
 * @return {Promise<Object[]>} Update records.
 */
async function detect(config, options = {}) {
	const cwd = options.cwd || process.cwd();
	const updates = [];
	const files = expandPaths(cwd, config.sources.npm.paths);

	for (const file of files) {
		const pkg = readJsonSafe(cwd, file);
		if (!pkg) {
			continue;
		}
		const deps = {
			...(pkg.dependencies || {}),
			...(pkg.devDependencies || {}),
		};
		for (const [name, currentSpec] of Object.entries(deps)) {
			if (isUnresolvable(currentSpec)) {
				continue;
			}
			if (!semver.splitVersion(currentSpec).core) {
				continue;
			}
			let latest;
			try {
				latest = await fetchLatest(name);
			} catch (err) {
				process.stderr.write(
					`version-monitor: npm lookup for "${name}" failed: ${err.message}\n`
				);
				if (err.rateLimited) {
					return updates;
				}
				if (!isClientError(err)) {
					recordError(options, `npm "${name}": ${err.message}`);
				}
				continue;
			}
			if (!latest || semver.isPreRelease(latest)) {
				continue;
			}
			if (!semver.gt(latest, currentSpec)) {
				continue;
			}
			updates.push({
				source: 'npm',
				file,
				package: name,
				currentValue: currentSpec,
				latestValue: semver.formatLatest(currentSpec, latest),
				reason: 'newer-on-registry',
			});
		}
	}

	return updates;
}

module.exports = { detect, isUnresolvable };
