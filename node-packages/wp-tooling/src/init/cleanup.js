/**
 * Remove scaffolding-only files/directories after a successful setup.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { resolveWithin, validateRelativePath } = require('./transform');

/**
 * Validate every cleanup target before deletion starts.
 *
 * @param {string}   root    - Project root.
 * @param {string[]} targets - Project-relative paths to remove.
 * @return {Object[]} Validated relative and absolute paths.
 */
const resolveCleanupTargets = (root, targets = []) => {
	if (!Array.isArray(targets)) {
		throw new Error(
			`Expected cleanup.targets to be an array, received ${JSON.stringify(targets)}`
		);
	}
	return targets.map((target) => {
		validateRelativePath(target);
		const full = resolveWithin(root, target);
		if (full === path.resolve(root)) {
			throw new Error(`Refusing to remove the project root: ${target}`);
		}
		return { target, full };
	});
};

/**
 * Delete validated cleanup targets, skipping paths that no longer exist.
 *
 * @param {string}   root    Project root.
 * @param {string[]} targets Relative paths to remove.
 * @param {Object}   ui      Status output.
 * @return {number} Number of targets removed.
 */
const runCleanup = (root, targets, ui) => {
	const resolved = resolveCleanupTargets(root, targets);
	let removed = 0;
	for (const { target, full } of resolved) {
		if (!fs.existsSync(full)) {
			continue;
		}
		fs.rmSync(full, { recursive: true, force: true });
		ui.info(`removed ${target}`);
		removed++;
	}
	return removed;
};

module.exports = { runCleanup, resolveCleanupTargets };
