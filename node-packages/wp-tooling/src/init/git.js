/**
 * Git initialization and git-hook installation.
 *
 * Commands use the argv form of `execFileSync` (no shell) so project paths with
 * spaces or shell metacharacters are safe. Hooks are installed via the native
 * `@rtcamp/wp-tooling/hooks` installer (zero-dep, ships `commit-msg` +
 * `pre-commit`) -- no Husky, matching the rest of the toolkit.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { installHooks } = require('../hooks');

/** The prepare-script command that reinstalls hooks after a fresh clone. */
const HOOKS_PREPARE = 'wp-tooling install-hooks || true';

/**
 * Run a command without a shell, capturing output.
 *
 * @param {string}   cmd  - Executable.
 * @param {string[]} args - Arguments.
 * @param {string}   cwd  - Working directory.
 * @return {Buffer} stdout.
 */
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'pipe' });

/**
 * Initialize a fresh git repository at `root`, removing any existing `.git`.
 *
 * @param {string} root - Project root.
 * @param {Object} ui   - `@rtcamp/wp-tooling/ui`.
 * @return {boolean} Whether the repository was initialized.
 */
const initRepo = (root, ui) => {
	const gitDir = path.join(root, '.git');
	try {
		if (fs.existsSync(gitDir)) {
			fs.rmSync(gitDir, { recursive: true, force: true });
		}
	} catch (err) {
		ui.error(`Could not remove existing .git directory: ${err.message}`);
		return false;
	}

	try {
		run('git', ['init', root], root);
		ui.success('Git repository initialized');
		return true;
	} catch (err) {
		ui.error(`git init failed: ${err.message}`);
		return false;
	}
};

/**
 * Stage everything and create the initial commit (skipping hooks).
 *
 * @param {string} root    - Project root.
 * @param {string} message - Commit message.
 * @param {Object} ui      - `@rtcamp/wp-tooling/ui`.
 * @return {boolean} Whether the commit succeeded.
 */
const commitAll = (root, message, ui) => {
	try {
		run('git', ['add', '-A'], root);
		run('git', ['commit', '-m', message, '--no-verify'], root);
		ui.success('Created initial commit');
		return true;
	} catch (err) {
		ui.warn(`Could not create initial commit: ${err.message}`);
		return false;
	}
};

/**
 * Point `package.json` `scripts.prepare` at `wp-tooling install-hooks` so the
 * hooks reinstall after a fresh clone (`.git/hooks` is never committed).
 *
 * Preserves any existing non-Husky `prepare` (e.g. `npm run sync-ai`) by
 * chaining the hook install after it; drops a Husky-based `prepare`. Idempotent.
 *
 * @param {string} root - Project root.
 * @return {void}
 */
const wirePrepareScript = (root) => {
	const pkgPath = path.join(root, 'package.json');
	if (!fs.existsSync(pkgPath)) {
		return;
	}

	const raw = fs.readFileSync(pkgPath, 'utf8');
	const indentMatch = raw.match(/\n([ \t]+)\S/);
	const indent = indentMatch ? indentMatch[1] : '\t';

	const pkg = JSON.parse(raw);
	pkg.scripts = pkg.scripts || {};

	const existing = (pkg.scripts.prepare || '').trim();
	if (existing.includes('wp-tooling install-hooks')) {
		return; // already wired
	}

	// Drop a Husky prepare; keep anything else and run the hook install after it.
	const keep = '' === existing || /^husky\b/.test(existing) ? '' : existing;
	pkg.scripts.prepare = keep ? `${keep} && ${HOOKS_PREPARE}` : HOOKS_PREPARE;

	fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, indent)}\n`, 'utf8');
};

/**
 * Install the native wp-tooling git hooks (`pre-commit` + `commit-msg`) into the
 * project's `.git/hooks`, then wire `prepare` so they survive a fresh clone.
 *
 * Requires an initialized git repository.
 *
 * @param {string} root - Project root.
 * @param {Object} ui   - `@rtcamp/wp-tooling/ui`.
 * @return {Promise<boolean>} Whether the hooks were installed.
 */
const installGitHooks = async (root, ui) => {
	if (!fs.existsSync(path.join(root, '.git'))) {
		ui.warn('Git is not initialized; skipping git hooks.');
		return false;
	}

	const spin = ui.spinner('Installing git hooks...');
	spin.start();
	try {
		const results = await installHooks(root, { force: true });
		wirePrepareScript(root);
		const installed = results
			.filter((r) => 'installed' === r.status)
			.map((r) => r.name);
		spin.succeed(`Git hooks installed (${installed.join(', ') || 'none'})`);
		return true;
	} catch (err) {
		spin.fail('Git hook installation failed');
		ui.warn(err.message);
		return false;
	}
};

module.exports = { initRepo, commitAll, installGitHooks };
