'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const FIXTURE_ROOT = path.join(__dirname, 'fixtures');

/**
 * Copy a fixture tree into a fresh tmp directory and return its path. Caller
 * cleans up with `cleanup(dir)` in the matching afterEach hook.
 *
 * @param {string} name Fixture directory name under tests/version-monitor/fixtures.
 * @return {string} Absolute path to the temp copy.
 */
function copyFixture(name) {
	const src = path.join(FIXTURE_ROOT, name);
	if (!fs.existsSync(src)) {
		throw new Error(`fixture not found: ${name}`);
	}
	const dst = fs.mkdtempSync(
		path.join(os.tmpdir(), `wp-tooling-vm-${name}-`)
	);
	copyRecursive(src, dst);
	return dst;
}

function copyRecursive(srcDir, dstDir) {
	for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
		const s = path.join(srcDir, entry.name);
		const d = path.join(dstDir, entry.name);
		if (entry.isDirectory()) {
			fs.mkdirSync(d, { recursive: true });
			copyRecursive(s, d);
		} else if (entry.isFile()) {
			fs.copyFileSync(s, d);
		}
	}
}

/**
 * Recursively delete a directory if it exists.
 *
 * @param {string} dir Directory path.
 */
function cleanup(dir) {
	if (dir && fs.existsSync(dir)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

/**
 * Build a normalised config with one source enabled. All six sources are
 * present (mirroring `validate`'s output) so detectors read uniformly.
 *
 * @param {string}   source Source name to enable.
 * @param {string[]} paths  Paths for the enabled source.
 * @return {{sources: Object, policy: Object}} Normalised config.
 */
function configWith(source, paths) {
	const sources = {
		npm: { enabled: false, paths: ['package.json'] },
		actions: { enabled: false, paths: ['.github/workflows/*.yml'] },
		php: { enabled: false, paths: ['composer.json'] },
		node: { enabled: false, paths: ['.nvmrc'] },
		'wp-cli': { enabled: false, paths: ['.github/workflows/*.yml'] },
		container: { enabled: false, paths: ['Dockerfile'] },
	};
	sources[source] = { enabled: true, paths };
	return { sources, policy: {} };
}

module.exports = { copyFixture, cleanup, configWith, FIXTURE_ROOT };
