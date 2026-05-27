/**
 * Detection orchestrator -- runs every enabled detector and returns a single
 * flat list of update records.
 *
 * Each detector is isolated: a failure (network error, parse error) is logged
 * to stderr and that detector contributes nothing, rather than aborting the
 * whole run. Every record is annotated with `is_major` here so detectors stay
 * focused on discovery and the major-bump policy lives in one place.
 *
 * Zero runtime dependencies -- Node built-ins via the detectors' `http` helper.
 */

'use strict';

const semver = require('./semver');

/** Detector registry, keyed by config source name (report order). */
const DETECTORS = {
	npm: require('./detectors/npm'),
	actions: require('./detectors/actions'),
	php: require('./detectors/php'),
	node: require('./detectors/node'),
	'wp-cli': require('./detectors/wp-cli'),
	container: require('./detectors/container'),
};

/**
 * Run every enabled detector and collect their updates. Hard failures (a
 * detector throwing, or an unexpected network/parse error inside one) are
 * pushed onto `options.errors` so the caller can tell a clean "no updates"
 * apart from "couldn't check"; expected conditions (rate limits, a source
 * with nothing published) are not recorded.
 *
 * @param {Object}   config           Normalised config (from `loadConfig`).
 * @param {Object}   [options]
 * @param {string}   [options.cwd]    Project root (defaults to `process.cwd()`).
 * @param {string[]} [options.errors] Collector for hard-failure messages (mutated in place).
 * @return {Promise<Object[]>} Flat list of update records, each annotated with `is_major`.
 */
async function detect(config, options = {}) {
	const cwd = options.cwd || process.cwd();
	const errors = Array.isArray(options.errors) ? options.errors : [];
	const updates = [];

	for (const [name, detector] of Object.entries(DETECTORS)) {
		const source = config.sources[name];
		if (!source || !source.enabled) {
			continue;
		}
		try {
			const found = await detector.detect(config, { cwd, errors });
			for (const update of found) {
				updates.push(update);
			}
		} catch (err) {
			errors.push(`${name}: ${err.message}`);
			process.stderr.write(
				`version-monitor: ${name} detector failed: ${err.message}\n`
			);
		}
	}

	for (const update of updates) {
		update.is_major = semver.isMajorBump(
			update.currentValue,
			update.latestValue
		);
	}

	return updates;
}

module.exports = { detect, DETECTORS };
