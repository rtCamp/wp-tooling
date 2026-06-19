/**
 * Git initialization and Husky hook installation.
 *
 * Commands use the argv form of `execFileSync` (no shell) so project paths with
 * spaces or shell metacharacters are safe.
 */

'use strict';

const fs = require( 'fs' );
const path = require( 'path' );
const { execFileSync } = require( 'child_process' );

/**
 * Run a command without a shell, capturing output.
 *
 * @param {string}   cmd  - Executable.
 * @param {string[]} args - Arguments.
 * @param {string}   cwd  - Working directory.
 * @return {Buffer} stdout.
 */
const run = ( cmd, args, cwd ) => execFileSync( cmd, args, { cwd, stdio: 'pipe' } );

/**
 * Initialize a fresh git repository at `root`, removing any existing `.git`.
 *
 * @param {string} root - Project root.
 * @param {Object} ui   - `@rtcamp/wp-tooling/ui`.
 * @return {boolean} Whether the repository was initialized.
 */
const initRepo = ( root, ui ) => {
	const gitDir = path.join( root, '.git' );
	try {
		if ( fs.existsSync( gitDir ) ) {
			fs.rmSync( gitDir, { recursive: true, force: true } );
		}
	} catch ( err ) {
		ui.error( `Could not remove existing .git directory: ${ err.message }` );
		return false;
	}

	try {
		run( 'git', [ 'init', root ], root );
		ui.success( 'Git repository initialized' );
		return true;
	} catch ( err ) {
		ui.error( `git init failed: ${ err.message }` );
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
const commitAll = ( root, message, ui ) => {
	try {
		run( 'git', [ 'add', '-A' ], root );
		run( 'git', [ 'commit', '-m', message, '--no-verify' ], root );
		ui.success( 'Created initial commit' );
		return true;
	} catch ( err ) {
		ui.warn( `Could not create initial commit: ${ err.message }` );
		return false;
	}
};

/**
 * Install Husky and wire the pre-commit hook to `npm run lint:staged`.
 *
 * Requires an initialized git repository. Preserves an existing `prepare`
 * script (e.g. `npm run sync-ai`) by merging it after Husky overwrites it.
 *
 * @param {string} root - Project root.
 * @param {Object} ui   - `@rtcamp/wp-tooling/ui`.
 * @return {boolean} Whether Husky was installed.
 */
const installHusky = ( root, ui ) => {
	if ( ! fs.existsSync( path.join( root, '.git' ) ) ) {
		ui.warn( 'Git is not initialized; skipping Husky.' );
		return false;
	}

	const pkgPath = path.join( root, 'package.json' );
	let previousPrepare = '';
	if ( fs.existsSync( pkgPath ) ) {
		try {
			previousPrepare = JSON.parse( fs.readFileSync( pkgPath, 'utf8' ) ).scripts?.prepare || '';
		} catch {
			previousPrepare = '';
		}
	}

	const spin = ui.spinner( 'Installing Husky...' );
	spin.start();
	try {
		run( 'npm', [ 'install', 'husky@9.0.1', '--save-dev', '--prefix', root ], root );
		run( 'npx', [ 'husky', 'init' ], root );
		fs.writeFileSync( path.join( root, '.husky', 'pre-commit' ), 'npm run lint:staged\n', 'utf8' );

		// `husky init` resets prepare to "husky"; merge back the previous prepare.
		const extra = previousPrepare.replace( /^husky\s*&&\s*/, '' ).trim();
		if ( extra && 'husky' !== extra && fs.existsSync( pkgPath ) ) {
			const raw = fs.readFileSync( pkgPath, 'utf8' );
			const merged = raw.replace( /("prepare"\s*:\s*")husky(")/, `$1husky && ${ extra }$2` );
			fs.writeFileSync( pkgPath, merged, 'utf8' );
		}

		spin.succeed( 'Husky installed' );
		return true;
	} catch ( err ) {
		spin.fail( 'Husky installation failed' );
		ui.warn( err.message );
		return false;
	}
};

module.exports = { initRepo, commitAll, installHusky };
