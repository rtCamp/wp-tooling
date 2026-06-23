/**
 * Status-line + table reporting helpers -- the printing counterparts to the
 * `style` colourisers.
 *
 * Each helper writes a formatted, TTY-aware line to stdout (colour only in a
 * TTY, plain in pipes / CI). Consumers (CLIs, init flows) should use these
 * instead of hand-rolling `console.log`, so output stays consistent and the
 * `no-console` lint rule is satisfied in one place.
 *
 * Zero external dependencies.
 */
'use strict';

const { writeLine } = require('../core/terminal');
const { style } = require('../style/index');

/**
 * Print a section heading (blank line above, bold).
 *
 * @param {string} message - Heading text.
 * @return {void}
 */
function heading(message) {
	writeLine(`\n${style.bold(message)}`);
}

/**
 * Print a success line (green `+`).
 *
 * @param {string} message - Message text.
 * @return {void}
 */
function success(message) {
	writeLine(`${style.success('+')} ${message}`);
}

/**
 * Print a warning line (yellow `!`).
 *
 * @param {string} message - Message text.
 * @return {void}
 */
function warn(message) {
	writeLine(`${style.warning('!')} ${message}`);
}

/**
 * Print an error line (red `x`).
 *
 * @param {string} message - Message text.
 * @return {void}
 */
function error(message) {
	writeLine(`${style.error('x')} ${message}`);
}

/**
 * Print a muted, indented detail line.
 *
 * @param {string} message - Message text.
 * @return {void}
 */
function info(message) {
	writeLine(`  ${style.muted(message)}`);
}

/**
 * Render a key/value table inside a box.
 *
 * Padding is computed from the raw (un-coloured) text so ANSI codes never throw
 * the column widths off.
 *
 * @param {Object|Array<Array<string>>} rows            - Key/value pairs.
 * @param {Object}                      [options]       - Options.
 * @param {string}                      [options.title] - Optional bold title above the box.
 * @return {void}
 */
function table(rows, options = {}) {
	const entries = Array.isArray(rows) ? rows : Object.entries(rows);
	if (entries.length === 0) {
		return;
	}

	const keyWidth = Math.max(...entries.map(([key]) => key.length));
	const valueWidth = Math.max(
		...entries.map(([, value]) => String(value).length)
	);
	const inner = keyWidth + 2 + valueWidth + 2;

	if (options.title) {
		writeLine(`\n${style.bold(options.title)}`);
	}

	writeLine(style.muted(`+${'-'.repeat(inner)}+`));
	entries.forEach(([key, value]) => {
		const label = `${key}:`.padEnd(keyWidth + 2);
		const rawLen = label.length + String(value).length;
		const pad = ' '.repeat(Math.max(0, inner - 2 - rawLen));
		writeLine(
			`${style.muted('|')} ${style.muted(label)}${style.bold(
				String(value)
			)}${pad} ${style.muted('|')}`
		);
	});
	writeLine(style.muted(`+${'-'.repeat(inner)}+`));
}

module.exports = { heading, success, warn, error, info, table };
