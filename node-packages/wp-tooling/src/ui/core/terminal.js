/**
 * Low-level TTY helpers -- ANSI codes, cursor control, keypress reading.
 *
 * Zero external dependencies. Uses only Node.js built-ins.
 */
'use strict';

const readline = require('readline');
const { CancelledError } = require('../errors');

/** ANSI escape sequences. */
const ANSI = {
	reset: '\x1b[0m',
	bold: '\x1b[1m',
	dim: '\x1b[2m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	red: '\x1b[31m',
	cyan: '\x1b[36m',
	grey: '\x1b[90m',
	hideCursor: '\x1b[?25l',
	showCursor: '\x1b[?25h',
	clearLine: '\x1b[2K',
	moveToColumn0: '\r',
};

/**
 * Whether the current stdout is a TTY.
 *
 * @return {boolean} True if stdout is a TTY.
 */
function isTTY() {
	return !!process.stdout.isTTY;
}

/**
 * Write text to stdout without a newline.
 *
 * @param {string} text - Text to write.
 */
function write(text) {
	process.stdout.write(text);
}

/**
 * Write a line to stdout.
 *
 * @param {string} [text=''] - Text to write.
 */
function writeLine(text = '') {
	process.stdout.write(text + '\n');
}

/**
 * Clear the current line and move cursor to column 0.
 */
function clearLine() {
	if (isTTY()) {
		write(ANSI.clearLine + ANSI.moveToColumn0);
	}
}

/**
 * Move the cursor up by `n` lines.
 *
 * @param {number} n - Number of lines to move up.
 */
function moveCursorUp(n) {
	if (isTTY() && n > 0) {
		write(`\x1b[${n}A`);
	}
}

/**
 * Hide the terminal cursor.
 */
function hideCursor() {
	if (isTTY()) {
		write(ANSI.hideCursor);
	}
}

/**
 * Show the terminal cursor.
 */
function showCursor() {
	if (isTTY()) {
		write(ANSI.showCursor);
	}
}

/**
 * Shared line buffer for non-TTY stdin.
 *
 * When stdin is piped, a single readline interface reads all lines up-front
 * into a queue. Sequential `readLine` calls consume from that queue so no
 * data is lost between calls.
 */
let _lineQueue = null;
let _lineQueueClosed = false;

/**
 * Ensure the shared non-TTY line queue is initialised.
 *
 * @return {{ shift: Function, readonly closed: boolean }} The line queue.
 */
function _getLineQueue() {
	if (_lineQueue) {
		return _lineQueue;
	}

	const lines = [];
	const waiters = [];
	let closed = false;

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: false,
	});

	rl.on('line', (line) => {
		if (waiters.length > 0) {
			waiters.shift()(line);
		} else {
			lines.push(line);
		}
	});

	rl.once('close', () => {
		closed = true;
		_lineQueueClosed = true;
		// Resolve any remaining waiters with empty string.
		while (waiters.length > 0) {
			waiters.shift()('');
		}
	});

	_lineQueue = {
		shift() {
			return new Promise((resolve) => {
				if (lines.length > 0) {
					resolve(lines.shift());
				} else if (closed) {
					resolve('');
				} else {
					waiters.push(resolve);
				}
			});
		},
		get closed() {
			return _lineQueueClosed;
		},
	};

	return _lineQueue;
}

/**
 * Read a single line from stdin.
 *
 * In TTY mode a fresh readline interface asks the user a question. Ctrl+C
 * rejects the returned promise with `CancelledError` so callers can treat
 * cancellation distinctly from empty input.
 *
 * In non-TTY (piped) mode a shared line queue is used so that
 * successive calls do not discard buffered input.
 *
 * @param {string} prompt - Prompt text shown to the user.
 * @return {Promise<string>} The line entered by the user.
 */
function readLine(prompt) {
	// Non-TTY: use the shared line queue.
	if (!process.stdin.isTTY) {
		write(prompt);
		return _getLineQueue().shift();
	}

	// TTY: interactive question per call.
	return new Promise((resolve, reject) => {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		let answered = false;
		let cancelled = false;

		// Without an explicit SIGINT listener, readline only pauses on Ctrl+C.
		// We catch it, mark the call cancelled, and let the close handler reject.
		rl.on('SIGINT', () => {
			cancelled = true;
			rl.close();
		});

		rl.question(prompt, (answer) => {
			answered = true;
			rl.close();
			resolve(answer);
		});

		rl.once('close', () => {
			if (cancelled) {
				writeLine();
				reject(new CancelledError());
			} else if (!answered) {
				resolve('');
			}
		});
	});
}

/**
 * Listen for keypress events on stdin. Returns a cleanup function.
 *
 * @param {Function} handler - Called with (str, key) on each keypress.
 * @return {Function} A function to call to stop listening.
 */
function onKeypress(handler) {
	if (!process.stdin.isTTY) {
		return () => {};
	}
	readline.emitKeypressEvents(process.stdin);
	if (process.stdin.setRawMode) {
		process.stdin.setRawMode(true);
	}
	process.stdin.resume();

	process.stdin.on('keypress', handler);

	return () => {
		process.stdin.removeListener('keypress', handler);
		if (process.stdin.setRawMode) {
			process.stdin.setRawMode(false);
		}
		process.stdin.pause();
	};
}

module.exports = {
	ANSI,
	isTTY,
	write,
	writeLine,
	clearLine,
	moveCursorUp,
	hideCursor,
	showCursor,
	readLine,
	onKeypress,
};
