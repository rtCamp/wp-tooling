/**
 * Consumer binary resolution for the perf runner.
 *
 * `@rtcamp/wp-tooling` has zero runtime dependencies, so `lighthouse` is
 * never a dependency here — it lives in the CONSUMER project's own dev
 * dependencies. These helpers locate that consumer-installed binary
 * (a direct or workspace-hoisted `node_modules/.bin/<bin>`), falling back to
 * `npx --no-install` so we never silently fetch it from the network.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const VERSION_PROBE_TIMEOUT_MS = 20000;

/**
 * Walk up from `cwd` looking for `node_modules/.bin/<binName>`.
 *
 * @param {string} binName Binary name (e.g. `lighthouse`).
 * @param {string} cwd     Directory to start the search from.
 * @return {{command: string, source: 'local'|'hoisted'}|null} The resolved
 *   binary, or `null` when no installed copy is found.
 */
function findInNodeModules(binName, cwd) {
	const start = path.resolve(cwd);
	let dir = start;
	for (;;) {
		const candidate = path.join(dir, 'node_modules', '.bin', binName);
		if (fs.existsSync(candidate)) {
			return {
				command: candidate,
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
 * Resolve how to invoke a consumer-installed binary.
 *
 * @param {string} binName       Binary name.
 * @param {Object} [options]
 * @param {string} [options.cwd] Directory to resolve from.
 * @return {{command: string, args: string[], source: 'local'|'hoisted'|'npx'}}
 *   Command + leading args + how it was resolved.
 */
function resolveBin(binName, options = {}) {
	const cwd = options.cwd || process.cwd();
	const found = findInNodeModules(binName, cwd);
	if (found) {
		return { command: found.command, args: [], source: found.source };
	}
	// `--no-install` keeps npx from fetching the package: if the consumer has
	// not installed it, the probe below simply reports it unavailable and the
	// caller surfaces the install hint.
	return { command: 'npx', args: ['--no-install', binName], source: 'npx' };
}

/**
 * Probe a binary's `--version` to confirm it is actually runnable.
 *
 * @param {string} binName       Binary name.
 * @param {Object} [options]
 * @param {string} [options.cwd] Directory to run in.
 * @return {{available: boolean, version: string|null, command: string,
 *   args: string[], source: string, error?: string}} Probe result.
 */
function detectBin(binName, options = {}) {
	const cwd = options.cwd || process.cwd();
	const { command, args, source } = resolveBin(binName, { cwd });
	try {
		const out = execFileSync(command, [...args, '--version'], {
			cwd,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
			timeout: VERSION_PROBE_TIMEOUT_MS,
		});
		return {
			available: true,
			version: out.toString().trim(),
			command,
			args,
			source,
		};
	} catch (err) {
		return {
			available: false,
			version: null,
			command,
			args,
			source,
			error: (err.stderr || err.message || '').toString().trim(),
		};
	}
}

module.exports = { resolveBin, detectBin, findInNodeModules };
