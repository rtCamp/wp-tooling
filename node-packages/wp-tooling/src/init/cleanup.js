/**
 * Remove scaffolding-only files/directories after a successful setup.
 */

'use strict';

const fs = require( 'fs' );
const { resolveWithin } = require( './transform' );

/**
 * Delete each target (file or directory) under `root` if it exists. Targets that
 * resolve outside the project root are refused, never deleted.
 *
 * @param {string}   root    - Project root.
 * @param {string[]} targets - Project-relative paths to remove.
 * @param {Object}   ui      - `@rtcamp/wp-tooling/ui`.
 * @return {number} Count of targets removed.
 */
const runCleanup = ( root, targets, ui ) => {
	let removed = 0;
	( targets || [] ).forEach( ( target ) => {
		let full;
		try {
			full = resolveWithin( root, target );
		} catch ( err ) {
			ui.warn( err.message );
			return;
		}
		if ( ! fs.existsSync( full ) ) {
			return;
		}
		try {
			fs.rmSync( full, { recursive: true, force: true } );
			ui.info( `removed ${ target }` );
			removed++;
		} catch ( err ) {
			ui.warn( `Could not remove ${ target }: ${ err.message }` );
		}
	} );
	return removed;
};

module.exports = { runCleanup };
