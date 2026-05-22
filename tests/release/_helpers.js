'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const FIXTURE_ROOT = path.join(__dirname, 'fixtures');

/**
 * Copy a fixture tree into a fresh tmp directory and return its path.
 * Caller is responsible for `fs.rmSync(dir, { recursive: true })` in
 * the matching afterEach hook.
 *
 * @param {string} name Fixture directory name under tests/release/fixtures.
 * @return {string} Absolute path to the temp copy.
 */
function copyFixture(name) {
	const src = path.join(FIXTURE_ROOT, name);
	if (!fs.existsSync(src)) {
		throw new Error(`fixture not found: ${name}`);
	}
	const dst = fs.mkdtempSync(
		path.join(os.tmpdir(), `wp-tooling-release-${name}-`)
	);
	copyRecursive(src, dst);
	return dst;
}

function copyRecursive(srcDir, dstDir) {
	const entries = fs.readdirSync(srcDir, { withFileTypes: true });
	for (const entry of entries) {
		const s = path.join(srcDir, entry.name);
		const d = path.join(dstDir, entry.name);
		if (entry.isDirectory()) {
			fs.mkdirSync(d, { recursive: true });
			copyRecursive(s, d);
		} else if (entry.isFile()) {
			fs.copyFileSync(s, d);
			const mode = fs.statSync(s).mode;
			fs.chmodSync(d, mode);
		}
	}
}

/**
 * Recursively delete a directory if it exists. Safe no-op on missing.
 *
 * @param {string} dir
 */
function cleanup(dir) {
	if (dir && fs.existsSync(dir)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

module.exports = { copyFixture, cleanup, FIXTURE_ROOT };
