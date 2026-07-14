/**
 * Consumer module resolution for the perf runner.
 *
 * `puppeteer` and `web-vitals` are consumer dev dependencies, never runtime
 * dependencies of `@rtcamp/wp-tooling`. These helpers walk up from `cwd`
 * looking for an installed copy in `node_modules`, the same shape as
 * `resolve-bin.js` for binaries. Unlike `detectBin`, no child process is
 * spawned — the version comes straight from the module's own package.json.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Walk up from `cwd` looking for `node_modules/<moduleName>`.
 *
 * @param {string} moduleName Package name (e.g. `puppeteer`).
 * @param {string} cwd        Directory to start the search from.
 * @return {{dir: string, source: 'local'|'hoisted'}|null} The resolved
 *   module directory, or `null` when no installed copy is found.
 */
function findModuleDir(moduleName, cwd) {
	const start = path.resolve(cwd);
	let dir = start;
	for (;;) {
		const candidate = path.join(dir, 'node_modules', moduleName);
		if (fs.existsSync(path.join(candidate, 'package.json'))) {
			return {
				dir: candidate,
				source: dir === start ? 'local' : 'hoisted',
			};
		}
		const parent = path.dirname(dir);
		if (parent === dir) {
			return null;
		}
		dir = parent;
	}
}

/**
 * Resolve a consumer-installed module's directory.
 *
 * @param {string} moduleName    Package name.
 * @param {Object} [options]
 * @param {string} [options.cwd] Directory to resolve from.
 * @return {string|null} Absolute directory, or `null` when not installed.
 */
function resolveModuleDir(moduleName, options = {}) {
	const cwd = options.cwd || process.cwd();
	const found = findModuleDir(moduleName, cwd);
	return found ? found.dir : null;
}

/**
 * Resolve an absolute path to a file inside a consumer-installed module.
 *
 * @param {string} moduleName    Package name.
 * @param {string} relFile       File path relative to the module's directory.
 * @param {Object} [options]
 * @param {string} [options.cwd] Directory to resolve from.
 * @return {string|null} Absolute file path when it exists, else `null`.
 */
function resolveModuleFile(moduleName, relFile, options = {}) {
	const dir = resolveModuleDir(moduleName, options);
	if (!dir) {
		return null;
	}
	const file = path.join(dir, relFile);
	return fs.existsSync(file) ? file : null;
}

/**
 * Resolve AND `require` a consumer-installed module, returning the loaded
 * module (never a path) so callers — and their tests — depend only on this
 * function's return value, not on Node's real module resolution. `run.js`
 * uses this exclusively to obtain `puppeteer`; tests substitute a fake
 * module by mocking this file, no real puppeteer install required.
 *
 * @param {string} moduleName    Package name.
 * @param {Object} [options]
 * @param {string} [options.cwd] Directory to resolve from.
 * @return {*} The loaded module, or `null` when not installed.
 */
function requireModule(moduleName, options = {}) {
	const dir = resolveModuleDir(moduleName, options);
	if (!dir) {
		return null;
	}
	// Intentional dynamic require: path resolved by walking the consumer's
	// own node_modules for a known package name, mirroring the dispatcher's
	// command auto-discovery in src/cli/index.js. No user input involved.

	return require(dir);
}

/**
 * Detect a consumer-installed module and report its declared version.
 *
 * @param {string} moduleName    Package name.
 * @param {Object} [options]
 * @param {string} [options.cwd] Directory to resolve from.
 * @return {{available: boolean, version: string|null, dir: string|null,
 *   source: 'local'|'hoisted'|null}} Detection result.
 */
function detectModule(moduleName, options = {}) {
	const cwd = options.cwd || process.cwd();
	const found = findModuleDir(moduleName, cwd);
	if (!found) {
		return { available: false, version: null, dir: null, source: null };
	}
	let version = null;
	try {
		const pkg = JSON.parse(
			fs.readFileSync(path.join(found.dir, 'package.json'), 'utf8')
		);
		version = typeof pkg.version === 'string' ? pkg.version : null;
	} catch {
		version = null;
	}
	return {
		available: true,
		version,
		dir: found.dir,
		source: found.source,
	};
}

module.exports = {
	findModuleDir,
	resolveModuleDir,
	resolveModuleFile,
	requireModule,
	detectModule,
};
