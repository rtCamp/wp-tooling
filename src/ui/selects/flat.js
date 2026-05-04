/**
 * Flat select primitives -- checkbox (multi) and radio (single).
 *
 * Zero external dependencies. Degrades to numbered-list fallback in non-TTY.
 */
'use strict';

const {
	ANSI,
	isTTY,
	writeLine,
	clearLine,
	moveCursorUp,
	hideCursor,
	showCursor,
	onKeypress,
	readLine,
} = require('../core/terminal');

/**
 * Render a flat list of options for TTY interactive selection.
 *
 * @param {Object}   options          - Select options.
 * @param {string}   options.message  - The prompt label.
 * @param {string[]} options.choices  - Array of choice labels.
 * @param {boolean}  options.multiple - If true, multi-select (checkbox). If false, single (radio).
 * @return {Promise<string[]|string>} Selected value(s). Array for multi, string for single.
 */
function interactiveSelect({ message, choices, multiple }) {
	return new Promise((resolve) => {
		hideCursor();

		let cursor = 0;
		const selected = new Set();

		const render = () => {
			// Move up to overwrite previous render (except on first draw).
			moveCursorUp(choices.length);

			for (let i = 0; i < choices.length; i++) {
				clearLine();
				const isCursor = i === cursor;
				const isSelected = selected.has(i);

				let marker;
				if (multiple) {
					marker = isSelected
						? `${ANSI.green}[x]${ANSI.reset}`
						: '[ ]';
				} else {
					marker = isSelected
						? `${ANSI.green}(*)${ANSI.reset}`
						: '( )';
				}

				const label = isCursor
					? `${ANSI.cyan}>${ANSI.reset} ${marker} ${choices[i]}`
					: `  ${marker} ${choices[i]}`;

				writeLine(label);
			}
		};

		// Initial header.
		writeLine(
			`${ANSI.cyan}?${ANSI.reset} ${ANSI.bold}${message}${ANSI.reset} ${ANSI.dim}(use arrow keys, space to select, enter to confirm)${ANSI.reset}`
		);

		// Print placeholder lines so the first render can overwrite them.
		for (let i = 0; i < choices.length; i++) {
			writeLine();
		}
		render();

		const cleanup = onKeypress((_ch, key) => {
			if (!key) {
				return;
			}

			if (key.name === 'up' && cursor > 0) {
				cursor--;
				render();
			} else if (key.name === 'down' && cursor < choices.length - 1) {
				cursor++;
				render();
			} else if (key.name === 'space') {
				if (multiple) {
					if (selected.has(cursor)) {
						selected.delete(cursor);
					} else {
						selected.add(cursor);
					}
				} else {
					selected.clear();
					selected.add(cursor);
				}
				render();
			} else if (key.name === 'return') {
				// For radio, if nothing selected, pick the cursor item.
				if (!multiple && selected.size === 0) {
					selected.add(cursor);
				}
				cleanup();
				showCursor();
				if (multiple) {
					resolve([...selected].sort().map((i) => choices[i]));
				} else {
					const idx = [...selected][0];
					resolve(choices[idx]);
				}
			} else if (key.ctrl && key.name === 'c') {
				cleanup();
				showCursor();
				process.exit(130);
			}
		});
	});
}

/**
 * Non-TTY fallback: numbered list, user types numbers.
 *
 * @param {Object}   options          - Select options.
 * @param {string}   options.message  - The prompt label.
 * @param {string[]} options.choices  - Array of choice labels.
 * @param {boolean}  options.multiple - Multi-select or single.
 * @return {Promise<string[]|string>} Selected value(s).
 */
async function plainSelect({ message, choices, multiple }) {
	writeLine(`${message}:`);
	choices.forEach((c, i) => {
		writeLine(`  ${i + 1}. ${c}`);
	});

	const hint = multiple
		? 'Enter numbers separated by commas'
		: 'Enter a number';
	const answer = await readLine(`${hint}: `);

	const indices = answer
		.split(',')
		.map((s) => parseInt(s.trim(), 10) - 1)
		.filter((i) => i >= 0 && i < choices.length);

	if (multiple) {
		return indices.map((i) => choices[i]);
	}
	return choices[indices[0]] || choices[0];
}

/**
 * Multi-select checkbox.
 *
 * @param {Object}   options         - Checkbox options.
 * @param {string}   options.message - The prompt label.
 * @param {string[]} options.choices - Array of choice labels.
 * @return {Promise<string[]>} Array of selected labels.
 */
async function checkbox({ message, choices } = {}) {
	if (isTTY() && process.stdin.isTTY) {
		return interactiveSelect({ message, choices, multiple: true });
	}
	return plainSelect({ message, choices, multiple: true });
}

/**
 * Single-select radio.
 *
 * @param {Object}   options         - Radio options.
 * @param {string}   options.message - The prompt label.
 * @param {string[]} options.choices - Array of choice labels.
 * @return {Promise<string>} The selected label.
 */
async function radio({ message, choices } = {}) {
	if (isTTY() && process.stdin.isTTY) {
		return interactiveSelect({ message, choices, multiple: false });
	}
	return plainSelect({ message, choices, multiple: false });
}

module.exports = { checkbox, radio };
