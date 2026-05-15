/**
 * install-hooks -- copy bundled POSIX hook templates into the current repo's
 * `.git/hooks/` directory.
 *
 * Library API:
 *   const { installHooks } = require( '@rtcamp/wp-tooling/hooks' );
 *
 * CLI:
 *   wp-tooling install-hooks [--force] [--dry-run]
 *
 * Zero runtime dependencies -- Node built-ins plus the `git` CLI.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PKG = require('../../package.json');

/**
 * Hook names shipped by this installer. The order matters only for
 * deterministic test output -- the installer treats each entry independently.
 */
const TEMPLATES = ['commit-msg', 'pre-commit'];

/**
 * Absolute path to the bundled templates directory.
 *
 * @return {string} Resolved templates directory.
 */
function templatesDir() {
	return path.join(__dirname, 'templates');
}

/**
 * Resolve the active git common directory for `repoRoot`. Returns the
 * absolute path to the hooks directory (e.g. `.git/hooks`, or the linked
 * worktree's common hooks dir).
 *
 * Uses `git rev-parse --git-common-dir` so submodules (where `.git` is a
 * file) and linked worktrees resolve correctly.
 *
 * @param {string} repoRoot Working tree directory to inspect.
 * @return {string} Absolute path to the hooks directory.
 * @throws {Error} When `repoRoot` is not inside a git repo.
 */
function resolveHooksDir(repoRoot) {
	let raw;
	try {
		raw = execFileSync('git', ['rev-parse', '--git-common-dir'], {
			cwd: repoRoot,
			stdio: ['ignore', 'pipe', 'pipe'],
		})
			.toString()
			.trim();
	} catch (err) {
		throw new Error(
			`not a git repository (or git is unavailable): ${repoRoot}`
		);
	}
	const gitDir = path.isAbsolute(raw) ? raw : path.join(repoRoot, raw);
	return path.join(gitDir, 'hooks');
}

/**
 * Heuristic: does `body` look like a Husky-managed hook? Husky-installed
 * hooks reference `.husky/` or `husky.sh` in their preamble.
 *
 * @param {string} body Existing hook file contents.
 * @return {boolean} True when the body matches a known Husky signature.
 */
function looksLikeHusky(body) {
	return /\.husky\/|husky\.sh/.test(body);
}

/**
 * Inject the version-tracking comment immediately after the shebang. Future
 * runs can grep this header to detect drift without re-reading package.json
 * inside the hook.
 *
 * @param {string} body    Raw template body.
 * @param {string} version Package version string.
 * @return {string} Body with the header line inserted on line 2.
 */
function injectVersionHeader(body, version) {
	const newlineAt = body.indexOf('\n');
	if (newlineAt === -1) {
		return body;
	}
	const shebang = body.slice(0, newlineAt);
	const rest = body.slice(newlineAt + 1);
	return `${shebang}\n# wp-tooling install-hooks v${version}\n${rest}`;
}

/**
 * Install bundled hooks into `repoRoot`'s git hooks directory.
 *
 * @param {string}  repoRoot         Working tree directory.
 * @param {Object}  [options]
 * @param {boolean} [options.force]  Overwrite existing hooks. Default false.
 * @param {boolean} [options.dryRun] Plan only -- do not touch the filesystem.
 * @return {Array<Object>} One result per template: `{ name, status, reason?, dest }`.
 *   `status` is one of `installed`, `would-install`, `skipped`.
 *   `reason` (when skipped) is `husky` or `exists`.
 * @throws {Error} When `repoRoot` is not inside a git repo.
 */
function installHooks(repoRoot, options = {}) {
	const force = options.force === true;
	const dryRun = options.dryRun === true;

	const hooksDir = resolveHooksDir(repoRoot);
	if (!fs.existsSync(hooksDir)) {
		if (dryRun) {
			// In dry-run, treat the missing hooks dir as a plan-time hint
			// rather than an error -- the caller can decide what to do.
		} else {
			fs.mkdirSync(hooksDir, { recursive: true });
		}
	}

	const results = [];
	for (const name of TEMPLATES) {
		const dest = path.join(hooksDir, name);
		const srcPath = path.join(templatesDir(), name);

		if (fs.existsSync(dest) && !force) {
			const existing = fs.readFileSync(dest, 'utf8');
			results.push({
				name,
				dest,
				status: 'skipped',
				reason: looksLikeHusky(existing) ? 'husky' : 'exists',
			});
			continue;
		}

		const body = injectVersionHeader(
			fs.readFileSync(srcPath, 'utf8'),
			PKG.version
		);

		if (dryRun) {
			results.push({ name, dest, status: 'would-install' });
			continue;
		}

		fs.writeFileSync(dest, body, { mode: 0o755 });
		// Some environments ignore the `mode` option (e.g. when the file
		// already existed). `chmod` after write guarantees the exec bit.
		fs.chmodSync(dest, 0o755);
		results.push({ name, dest, status: 'installed' });
	}

	return results;
}

/**
 * Parse argv for the `install-hooks` subcommand.
 *
 * @param {string[]} argv argv slice (without the subcommand name).
 * @return {Object} Parsed flags keyed by option name.
 */
function parseArgs(argv) {
	const opts = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		switch (arg) {
			case '--force':
				opts.force = true;
				break;
			case '--dry-run':
				opts.dryRun = true;
				break;
			case '--help':
			case '-h':
				opts.help = true;
				break;
			default:
				throw new Error(`unknown argument: ${arg}`);
		}
	}
	return opts;
}

/**
 * Render usage text to stdout.
 */
function printUsage() {
	process.stdout.write(
		[
			'Usage: install-hooks [options]',
			'',
			'  --force      Overwrite existing hooks (including Husky-managed ones).',
			'  --dry-run    Print the planned actions without writing any files.',
			'  --help, -h   Print this help.',
			'',
			'Installs commit-msg and pre-commit hooks into the current repo.',
			'',
		].join('\n')
	);
}

/**
 * Format a single result line for human-readable output.
 *
 * @param {Object} result Result entry from `installHooks`.
 * @return {string} Human-readable line describing the result.
 */
function formatResult(result) {
	switch (result.status) {
		case 'installed':
			return `installed  ${result.name}  -> ${result.dest}`;
		case 'would-install':
			return `[dry-run]  would install ${result.name} -> ${result.dest}`;
		case 'skipped':
			if (result.reason === 'husky') {
				return (
					`skipped    ${result.name}  (Husky-managed hook detected at ${result.dest}; ` +
					`pass --force to replace)`
				);
			}
			return (
				`skipped    ${result.name}  (already exists at ${result.dest}; ` +
				`pass --force to replace)`
			);
		default:
			return `${result.status}  ${result.name}`;
	}
}

/**
 * Run the CLI. Returns the intended exit code.
 *
 * @param {string[]} argv argv slice (without the subcommand name).
 * @return {number} 0 on success, 1 on I/O failure, 2 on usage error.
 */
function runCli(argv) {
	let opts;
	try {
		opts = parseArgs(argv);
	} catch (err) {
		process.stderr.write(`install-hooks: ${err.message}\n`);
		return 2;
	}

	if (opts.help) {
		printUsage();
		return 0;
	}

	let results;
	try {
		results = installHooks(process.cwd(), {
			force: opts.force === true,
			dryRun: opts.dryRun === true,
		});
	} catch (err) {
		process.stderr.write(`install-hooks: ${err.message}\n`);
		return 1;
	}

	for (const result of results) {
		process.stdout.write(`${formatResult(result)}\n`);
	}
	return 0;
}

module.exports = {
	installHooks,
	runCli,
	parseArgs,
	resolveHooksDir,
	injectVersionHeader,
	looksLikeHusky,
	TEMPLATES,
};
