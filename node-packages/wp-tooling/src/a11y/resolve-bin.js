/**
 * Resolve the consumer's installed Node CLI, including workspace-hoisted copies.
 * Launch its package.json bin entry with Node on every platform: npm's .bin
 * shims are platform-specific and Windows .cmd files cannot use execFileSync.
 * No npx fallback: a cached/global package is not the consumer's dependency.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const VERSION_PROBE_TIMEOUT_MS = 20000;

/**
 * Find the nearest installed package without depending on its exports map.
 *
 * @param {string} packageName Package whose Node CLI should run.
 * @param {string} cwd         Directory to start the search from.
 * @return {{packageDir: string, source: 'local'|'hoisted'}|null} Installation.
 */
function findInNodeModules(packageName, cwd) {
	const start = path.resolve(cwd);
	let dir = start;
	while (true) {
		const packageDir = path.join(dir, 'node_modules', packageName);
		if (fs.existsSync(packageDir)) {
			return { packageDir, source: dir === start ? 'local' : 'hoisted' };
		}
		const parent = path.dirname(dir);
		if (parent === dir) {
			return null;
		}
		dir = parent;
	}
}

/**
 * Resolve a Node CLI's bin entry from its installed package manifest.
 * Resolution errors retain the installation's source for EBINFAIL reporting.
 *
 * @param {string} binName       Package and binary name (e.g. pa11y-ci).
 * @param {Object} [options]
 * @param {string} [options.cwd] Directory to resolve from.
 * @return {{command: string, args: string[], source: string, error?: string}}
 *   Node executable, entry-point argument, and installation status.
 */
function resolveBin(binName, options = {}) {
	const found = findInNodeModules(binName, options.cwd || process.cwd());
	const result = {
		command: process.execPath,
		args: [],
		source: found ? found.source : 'missing',
	};
	if (!found) {
		return result;
	}
	try {
		const manifest = JSON.parse(
			fs.readFileSync(path.join(found.packageDir, 'package.json'), 'utf8')
		);
		const entry =
			typeof manifest.bin === 'string'
				? manifest.bin
				: manifest.bin?.[binName];
		if (typeof entry !== 'string' || !entry.trim()) {
			throw new Error(
				`Expected a bin entry for ${binName} in ${found.packageDir}/package.json; received ${JSON.stringify(manifest.bin)}`
			);
		}
		result.args = [path.resolve(found.packageDir, entry)];
	} catch (err) {
		result.error = err.message;
	}
	return result;
}

/**
 * Probe the installed CLI's --version using the same invocation as the scan.
 *
 * @param {string} binName       Package and binary name.
 * @param {Object} [options]
 * @param {string} [options.cwd] Directory to run in.
 * @return {{available: boolean, version: string|null, command: string,
 *   args: string[], source: string, error?: string}} Probe result.
 */
function detectBin(binName, options = {}) {
	const cwd = options.cwd || process.cwd();
	const resolved = resolveBin(binName, { cwd });
	const result = { ...resolved, available: false, version: null };
	if (resolved.source === 'missing' || resolved.error) {
		return result;
	}
	try {
		const out = execFileSync(
			resolved.command,
			[...resolved.args, '--version'],
			{
				cwd,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'pipe'],
				timeout: VERSION_PROBE_TIMEOUT_MS,
			}
		);
		return { ...result, available: true, version: out.toString().trim() };
	} catch (err) {
		return {
			...result,
			error: (
				err.stderr?.toString().trim() ||
				err.message ||
				''
			).toString(),
		};
	}
}

module.exports = { resolveBin, detectBin, findInNodeModules };
