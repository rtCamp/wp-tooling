/**
 * Styled text helpers -- the public, TTY-aware colour API for the UI kit.
 *
 * Consumers (CLIs, init scripts) should use these instead of hand-rolling ANSI
 * escapes: each helper returns the plain string unchanged when stdout is not a
 * TTY (piped output / CI), so colour codes never leak into logs.
 *
 * Zero external dependencies.
 */
'use strict';

const { ANSI, isTTY } = require('../core/terminal');

/**
 * Build a styling function for one ANSI code that no-ops in non-TTY output.
 *
 * @param {string} code - ANSI escape sequence to wrap the text with.
 * @return {(text: string) => string} A function that styles its input.
 */
function wrap(code) {
	return (text) => (isTTY() ? `${code}${text}${ANSI.reset}` : String(text));
}

/** Semantic styling helpers. */
const style = {
	error: wrap(ANSI.red),
	success: wrap(ANSI.green),
	warning: wrap(ANSI.yellow),
	info: wrap(ANSI.cyan),
	muted: wrap(ANSI.grey),
	bold: wrap(ANSI.bold),
};

module.exports = { style };
