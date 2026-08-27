/**
 * Shared helpers for the init test suites (mirrors tests/release/_helpers.js).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Create a throwaway project root under the OS temp dir.
 *
 * @param {string} [prefix] - mkdtemp prefix.
 * @return {string} Absolute root path.
 */
const makeRoot = (prefix = 'init-test-') =>
	fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/**
 * Create an empty (or content-filled) file, making parent dirs.
 *
 * @param {string} root      - Project root.
 * @param {string} rel       - Relative path to create.
 * @param {string} [content] - File body.
 * @return {void}
 */
const touch = (root, rel, content = '') => {
	const abs = path.join(root, rel);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, content);
};

/**
 * Run `fn` with process.stdout/stderr captured; always restores the streams.
 *
 * @param {Function} fn - Sync or async workload.
 * @return {Promise<{stdout: string, stderr: string}>} Captured output.
 */
const capture = async (fn) => {
	const outW = process.stdout.write.bind(process.stdout);
	const errW = process.stderr.write.bind(process.stderr);
	let stdout = '';
	let stderr = '';
	process.stdout.write = (chunk) => {
		stdout += chunk;
		return true;
	};
	process.stderr.write = (chunk) => {
		stderr += chunk;
		return true;
	};
	try {
		await fn();
	} finally {
		process.stdout.write = outW;
		process.stderr.write = errW;
	}
	return { stdout, stderr };
};

module.exports = { makeRoot, touch, capture };
