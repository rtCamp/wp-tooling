/**
 * Text, confirm, and password prompts.
 *
 * Zero external dependencies. Degrades gracefully in non-TTY environments.
 */
'use strict';

const {
	ANSI,
	isTTY,
	readLine,
	write,
	writeLine,
	onKeypress,
} = require('../core/terminal');
const { CancelledError } = require('../errors');

/**
 * Prompt the user for a text value.
 *
 * @param {Object}   options                - Prompt options.
 * @param {string}   options.message        - The label / question to display.
 * @param {string}   [options.defaultValue] - Default value if the user presses Enter without typing.
 * @param {Function} [options.validate]     - Validation function. Return a string message on failure, or undefined on success.
 * @return {Promise<string>} The user's input.
 */
async function text({ message, defaultValue, validate } = {}) {
	const defaultHint =
		defaultValue !== undefined
			? ` ${ANSI.dim}(${defaultValue})${ANSI.reset}`
			: '';
	const prompt = `${ANSI.cyan}?${ANSI.reset} ${ANSI.bold}${message}${ANSI.reset}${defaultHint} `;

	// eslint-disable-next-line no-constant-condition
	while (true) {
		const answer = await readLine(isTTY() ? prompt : `${message}: `);
		const value = answer.trim() || defaultValue || '';

		if (validate) {
			const error = validate(value);
			if (error) {
				writeLine(`${ANSI.red}  x ${error}${ANSI.reset}`);
				continue;
			}
		}

		return value;
	}
}

/**
 * Prompt the user for a yes/no confirmation.
 *
 * @param {Object}  options                      - Prompt options.
 * @param {string}  options.message              - The label / question to display.
 * @param {boolean} [options.defaultValue=false] - Default if the user presses Enter.
 * @return {Promise<boolean>} True for yes, false for no.
 */
async function confirm({ message, defaultValue = false } = {}) {
	const hint = defaultValue ? 'Y/n' : 'y/N';
	const prompt = isTTY()
		? `${ANSI.cyan}?${ANSI.reset} ${ANSI.bold}${message}${ANSI.reset} ${ANSI.dim}(${hint})${ANSI.reset} `
		: `${message} (${hint}): `;

	const answer = await readLine(prompt);
	const normalised = answer.trim().toLowerCase();

	if (normalised === '') {
		return defaultValue;
	}
	return normalised === 'y' || normalised === 'yes';
}

/**
 * Prompt the user for a password (masked input).
 *
 * In non-TTY mode, reads from stdin as plain text (no masking possible).
 *
 * @param {Object} options            - Prompt options.
 * @param {string} options.message    - The label / question to display.
 * @param {string} [options.mask='*'] - Character used to mask each typed character.
 * @return {Promise<string>} The entered password.
 */
async function password({ message, mask = '*' } = {}) {
	if (!isTTY() || !process.stdin.isTTY) {
		return readLine(`${message}: `);
	}

	const prompt = `${ANSI.cyan}?${ANSI.reset} ${ANSI.bold}${message}${ANSI.reset} `;
	write(prompt);

	return new Promise((resolve, reject) => {
		let value = '';

		const cleanup = onKeypress((ch, key) => {
			if (key && key.name === 'return') {
				cleanup();
				writeLine();
				resolve(value);
				return;
			}

			if (key && (key.name === 'backspace' || key.name === 'delete')) {
				if (value.length > 0) {
					value = value.slice(0, -1);
					write('\b \b');
				}
				return;
			}

			// Ctrl+C -- cancel prompt.
			if (key && key.ctrl && key.name === 'c') {
				cleanup();
				writeLine();
				reject(new CancelledError());
			}

			if (ch) {
				value += ch;
				write(mask);
			}
		});
	});
}

module.exports = { text, confirm, password };
