/**
 * Spinner -- async progress feedback.
 *
 * Zero external dependencies. Animates in TTY; plain text fallback otherwise.
 */
'use strict';

const { ANSI, isTTY, write, clearLine } = require('../core/terminal');

const FRAMES = ['|', '/', '-', '\\'];
const INTERVAL = 80;

/**
 * Create a spinner instance.
 *
 * @param {string} text - Initial spinner label.
 * @return {{ start: Function, succeed: Function, fail: Function, update: Function }} Spinner controls.
 */
function spinner(text) {
	let frameIndex = 0;
	let timer = null;
	let currentText = text;

	const instance = {
		/**
		 * Start the spinner animation.
		 *
		 * @return {void}
		 */
		start() {
			if (!isTTY()) {
				write(`${currentText}\n`);
				return;
			}
			timer = setInterval(() => {
				clearLine();
				const frame = FRAMES[frameIndex % FRAMES.length];
				write(`${ANSI.cyan}${frame}${ANSI.reset} ${currentText}`);
				frameIndex++;
			}, INTERVAL);
		},

		/**
		 * Stop the spinner with a success message.
		 *
		 * @param {string} [msg] - Success message. Defaults to current text.
		 * @return {void}
		 */
		succeed(msg) {
			const label = msg || currentText;
			if (timer) {
				clearInterval(timer);
				timer = null;
			}
			if (isTTY()) {
				clearLine();
			}
			write(`${ANSI.green}+${ANSI.reset} ${label}\n`);
		},

		/**
		 * Stop the spinner with a failure message.
		 *
		 * @param {string} [msg] - Failure message. Defaults to current text.
		 * @return {void}
		 */
		fail(msg) {
			const label = msg || currentText;
			if (timer) {
				clearInterval(timer);
				timer = null;
			}
			if (isTTY()) {
				clearLine();
			}
			write(`${ANSI.red}x${ANSI.reset} ${label}\n`);
		},

		/**
		 * Update the spinner text while it is running.
		 *
		 * @param {string} newText - New label text.
		 * @return {void}
		 */
		update(newText) {
			currentText = newText;
		},
	};

	return instance;
}

module.exports = { spinner };
