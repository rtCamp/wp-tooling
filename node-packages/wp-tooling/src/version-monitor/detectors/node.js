/**
 * Node detector -- compares the Node version pinned across `.nvmrc`,
 * `package.json` `engines.node`, and workflow `node-version:` fields against
 * the current Node LTS line from the official distribution index.
 *
 * Only fully-qualified specs (carrying at least `major.minor`) are compared;
 * floating pins like `22`, `lts/*`, or matrix arrays are left alone. The
 * target is the newest LTS release within the same major when one exists, so
 * routine bumps stay in-line (`22.11.0` -> `22.13.1`) and major LTS jumps
 * surface as major bumps for the updater to gate.
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

/** The official Node release index; entries carry `version` and `lts`. */
const DIST_INDEX = 'https://nodejs.org/dist/index.json';

/** Matches a scalar `node-version:` value (not a matrix array). */
const NODE_VERSION_RE = /node-version:\s*['"]?([^\s'"#[\],]+)/g;

/**
 * Is the spec qualified enough to compare (has at least `major.minor`)?
 *
 * @param {string} spec Version spec.
 * @return {boolean} True when comparable.
 */
function isComparable(spec) {
	return semver.splitVersion(String(spec)).core.includes('.');
}

/**
 * Gather every Node version pin found across the configured files.
 *
 * @param {string}   cwd   Project root.
 * @param {string[]} files Resolved cwd-relative paths.
 * @return {Array<{file: string, value: string}>} Distinct file/value pins.
 */
function collectPins(cwd, files) {
	const pins = [];
	const seen = new Set();
	const add = (file, value) => {
		if (typeof value !== 'string' || value.trim() === '') {
			return;
		}
		const key = `${file}::${value.trim()}`;
		if (!seen.has(key)) {
			seen.add(key);
			pins.push({ file, value: value.trim() });
		}
	};

	for (const file of files) {
		if (file.endsWith('.nvmrc')) {
			const text = readFileSafe(cwd, file);
			if (text !== null) {
				add(file, text.trim());
			}
		} else if (file.endsWith('package.json')) {
			const pkg = readJsonSafe(cwd, file);
			if (pkg && pkg.engines && typeof pkg.engines.node === 'string') {
				add(file, pkg.engines.node);
			}
		} else {
			const text = readFileSafe(cwd, file);
			if (text === null) {
				continue;
			}
			let match;
			while ((match = NODE_VERSION_RE.exec(text)) !== null) {
				add(file, match[1]);
			}
		}
	}
	return pins;
}

/**
 * Pick the newest LTS release to target for a given current spec.
 *
 * @param {Object[]} index       Parsed dist index.
 * @param {string}   currentSpec The pin being evaluated.
 * @return {string|undefined} The target version, or `undefined` when no LTS is available.
 */
function pickLatestLts(index, currentSpec) {
	const lts = index.filter(
		(e) =>
			e &&
			e.lts !== false &&
			typeof e.version === 'string' &&
			!semver.isPreRelease(e.version)
	);
	if (lts.length === 0) {
		return undefined;
	}
	const currentMajor = semver.parse(currentSpec).major;
	const sameMajor = lts.filter(
		(e) => semver.parse(e.version).major === currentMajor
	);
	const pool = sameMajor.length ? sameMajor : lts;
	return pool.reduce(
		(best, e) => (semver.gt(e.version, best) ? e.version : best),
		pool[0].version
	);
}

/**
 * Detect Node version updates.
 *
 * @param {Object} config        Normalised config.
 * @param {Object} [options]
 * @param {string} [options.cwd] Project root.
 * @return {Promise<Object[]>} Update records.
 */
async function detect(config, options = {}) {
	const cwd = options.cwd || process.cwd();
	const files = expandPaths(cwd, config.sources.node.paths);
	const pins = collectPins(cwd, files).filter((p) => isComparable(p.value));
	if (pins.length === 0) {
		return [];
	}

	let index;
	try {
		index = await getJson(DIST_INDEX);
	} catch (err) {
		process.stderr.write(
			`version-monitor: node index lookup failed: ${err.message}\n`
		);
		if (!err.rateLimited && !isClientError(err)) {
			recordError(options, `node: ${err.message}`);
		}
		return [];
	}
	if (!Array.isArray(index)) {
		return [];
	}

	const updates = [];
	for (const { file, value } of pins) {
		const latest = pickLatestLts(index, value);
		if (!latest || !semver.gt(latest, value)) {
			continue;
		}
		updates.push({
			source: 'node',
			file,
			package: 'node',
			currentValue: value,
			latestValue: semver.formatLatest(value, latest),
			reason: 'newer-lts',
		});
	}
	return updates;
}

module.exports = { detect, collectPins, pickLatestLts, isComparable };
