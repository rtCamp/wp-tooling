/**
 * Styled terminal output: colored status lines, headings, and a key/value table.
 *
 * Complements `@rtcamp/wp-tooling/ui` (which owns the interactive primitives:
 * Wizard, text, confirm, spinner). Colors are emitted only in a TTY, so piped /
 * CI output stays plain. Zero dependencies.
 */

'use strict';

/** ANSI escape sequences. */
const ANSI = {
	reset: '\x1b[0m',
	bold: '\x1b[1m',
	dim: '\x1b[2m',
	green: '\x1b[32m',
	red: '\x1b[31m',
	yellow: '\x1b[33m',
	cyan: '\x1b[36m',
	grey: '\x1b[90m',
};

/**
 * Whether stdout is a TTY.
 *
 * @return {boolean} True when stdout is a terminal.
 */
const isTTY = () => Boolean( process.stdout.isTTY );

/**
 * Build a painter that wraps a message in a color, only when in a TTY.
 *
 * @param {string} code - ANSI escape sequence.
 * @return {Function} A painter `( msg ) => string`.
 */
const paint = ( code ) => ( msg ) => ( isTTY() ? `${ code }${ msg }${ ANSI.reset }` : String( msg ) );

/** Color painters that no-op outside a TTY. */
const style = {
	bold: paint( ANSI.bold ),
	dim: paint( ANSI.dim ),
	green: paint( ANSI.green ),
	red: paint( ANSI.red ),
	yellow: paint( ANSI.yellow ),
	cyan: paint( ANSI.cyan ),
	grey: paint( ANSI.grey ),
};

/**
 * Print a section heading (blank line above, bold cyan).
 *
 * @param {string} message - Heading text.
 * @return {void}
 */
const heading = ( message ) => console.log( `\n${ style.bold( style.cyan( message ) ) }` );

/**
 * Print a success line (green plus).
 *
 * @param {string} message - Message text.
 * @return {void}
 */
const success = ( message ) => console.log( `${ style.green( '+' ) } ${ message }` );

/**
 * Print a warning line (yellow bang).
 *
 * @param {string} message - Message text.
 * @return {void}
 */
const warn = ( message ) => console.log( `${ style.yellow( '!' ) } ${ message }` );

/**
 * Print an error line (red cross).
 *
 * @param {string} message - Message text.
 * @return {void}
 */
const error = ( message ) => console.log( `${ style.red( 'x' ) } ${ message }` );

/**
 * Print a dim, indented detail line.
 *
 * @param {string} message - Message text.
 * @return {void}
 */
const info = ( message ) => console.log( `  ${ style.dim( message ) }` );

/**
 * Render a key/value table inside a box.
 *
 * Padding is computed from the raw (un-colored) text so ANSI codes never throw
 * the column widths off.
 *
 * @param {Object|Array<Array<string>>} rows            - Key/value pairs.
 * @param {Object}                      [options]       - Options.
 * @param {string}                      [options.title] - Optional bold title above the box.
 * @return {void}
 */
const table = ( rows, options = {} ) => {
	const entries = Array.isArray( rows ) ? rows : Object.entries( rows );
	if ( 0 === entries.length ) {
		return;
	}

	const keyWidth = Math.max( ...entries.map( ( [ key ] ) => key.length ) );
	const valueWidth = Math.max( ...entries.map( ( [ , value ] ) => String( value ).length ) );
	const inner = keyWidth + 2 + valueWidth + 2;

	if ( options.title ) {
		console.log( `\n${ style.bold( options.title ) }` );
	}

	console.log( style.grey( `+${ '-'.repeat( inner ) }+` ) );
	entries.forEach( ( [ key, value ] ) => {
		const label = `${ key }:`.padEnd( keyWidth + 2 );
		const rawLen = label.length + String( value ).length;
		const pad = ' '.repeat( Math.max( 0, inner - 2 - rawLen ) );
		console.log( `${ style.grey( '|' ) } ${ style.dim( label ) }${ style.bold( String( value ) ) }${ pad } ${ style.grey( '|' ) }` );
	} );
	console.log( style.grey( `+${ '-'.repeat( inner ) }+` ) );
};

module.exports = { style, heading, success, warn, error, info, table };
