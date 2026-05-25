/**
 * Grouped tree select -- checkboxTree (multi-select with groups).
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
const { CancelledError } = require('../errors');

/**
 * Validate grouped checkboxTree input.
 *
 * @param {*} groups - The received groups value.
 * @return {void}
 */
function validateGroups(groups) {
	if (!Array.isArray(groups)) {
		const received = groups === null ? 'null' : typeof groups;
		throw new TypeError(
			`checkboxTree() expected "groups" to be an array, received ${received}.`
		);
	}

	for (let i = 0; i < groups.length; i++) {
		const group = groups[i];
		const items = group && group.items;
		if (!Array.isArray(items)) {
			const received = items === null ? 'null' : typeof items;
			throw new TypeError(
				`checkboxTree() expected "groups[${i}].items" to be an array, received ${received}.`
			);
		}
	}
}

/**
 * Build a flat list of renderable rows from groups.
 *
 * @param {Array<{label: string, items: string[]}>} groups - Grouped items.
 * @return {Array<{type: string, label: string, groupIndex?: number, itemIndex?: number}>} Flat rows.
 */
function buildRows(groups) {
	const rows = [];
	for (let g = 0; g < groups.length; g++) {
		rows.push({ type: 'group', label: groups[g].label, groupIndex: g });
		for (let i = 0; i < groups[g].items.length; i++) {
			rows.push({
				type: 'item',
				label: groups[g].items[i],
				groupIndex: g,
				itemIndex: i,
			});
		}
	}
	return rows;
}

/**
 * Interactive TTY checkboxTree.
 *
 * @param {Object}                                  options         - Options.
 * @param {string}                                  options.message - Prompt label.
 * @param {Array<{label: string, items: string[]}>} options.groups  - Grouped items.
 * @return {Promise<string[]>} Selected item labels.
 */
function interactiveCheckboxTree({ message, groups }) {
	return new Promise((resolve, reject) => {
		hideCursor();

		const rows = buildRows(groups);
		let cursor = 0;
		const selected = new Set(); // stores "groupIndex:itemIndex" keys

		/**
		 * Check if every item in a group is selected.
		 *
		 * @param {number} groupIndex - The group index.
		 * @return {boolean} True if all items are selected.
		 */
		const isGroupFullySelected = (groupIndex) => {
			return groups[groupIndex].items.every((_, i) =>
				selected.has(`${groupIndex}:${i}`)
			);
		};

		/**
		 * Check if some (but not all) items in a group are selected.
		 *
		 * @param {number} groupIndex - The group index.
		 * @return {boolean} True if partially selected.
		 */
		const isGroupPartiallySelected = (groupIndex) => {
			return (
				groups[groupIndex].items.some((_, i) =>
					selected.has(`${groupIndex}:${i}`)
				) && !isGroupFullySelected(groupIndex)
			);
		};

		const render = () => {
			moveCursorUp(rows.length);

			for (let r = 0; r < rows.length; r++) {
				clearLine();
				const row = rows[r];
				const isCursor = r === cursor;
				const pointer = isCursor ? `${ANSI.cyan}>${ANSI.reset}` : ' ';

				if (row.type === 'group') {
					let marker;
					if (isGroupFullySelected(row.groupIndex)) {
						marker = `${ANSI.green}[x]${ANSI.reset}`;
					} else if (isGroupPartiallySelected(row.groupIndex)) {
						marker = `${ANSI.yellow}[-]${ANSI.reset}`;
					} else {
						marker = '[ ]';
					}
					writeLine(
						`${pointer} ${marker} ${ANSI.bold}${row.label}${ANSI.reset}`
					);
				} else {
					const key = `${row.groupIndex}:${row.itemIndex}`;
					const checked = selected.has(key);
					const marker = checked
						? `${ANSI.green}x${ANSI.reset}`
						: ' ';
					writeLine(`${pointer}   [${marker}] ${row.label}`);
				}
			}
		};

		// Header.
		writeLine(
			`${ANSI.cyan}?${ANSI.reset} ${ANSI.bold}${message}${ANSI.reset} ${ANSI.dim}(up/down navigate, space toggle, enter confirm)${ANSI.reset}`
		);

		// Print placeholder lines.
		for (let r = 0; r < rows.length; r++) {
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
			} else if (key.name === 'down' && cursor < rows.length - 1) {
				cursor++;
				render();
			} else if (key.name === 'space') {
				const row = rows[cursor];
				if (row.type === 'group') {
					// Toggle entire group.
					const allSelected = isGroupFullySelected(row.groupIndex);
					const items = groups[row.groupIndex].items;
					for (let i = 0; i < items.length; i++) {
						const k = `${row.groupIndex}:${i}`;
						if (allSelected) {
							selected.delete(k);
						} else {
							selected.add(k);
						}
					}
				} else {
					const k = `${row.groupIndex}:${row.itemIndex}`;
					if (selected.has(k)) {
						selected.delete(k);
					} else {
						selected.add(k);
					}
				}
				render();
			} else if (key.name === 'return') {
				cleanup();
				showCursor();
				const result = [];
				for (let g = 0; g < groups.length; g++) {
					for (let i = 0; i < groups[g].items.length; i++) {
						if (selected.has(`${g}:${i}`)) {
							result.push(groups[g].items[i]);
						}
					}
				}
				resolve(result);
			} else if (key.ctrl && key.name === 'c') {
				cleanup();
				showCursor();
				reject(new CancelledError());
			}
		});
	});
}

/**
 * Non-TTY fallback for checkboxTree.
 *
 * @param {Object}                                  options         - Options.
 * @param {string}                                  options.message - Prompt label.
 * @param {Array<{label: string, items: string[]}>} options.groups  - Grouped items.
 * @return {Promise<string[]>} Selected item labels.
 */
async function plainCheckboxTree({ message, groups }) {
	writeLine(`${message}:`);
	const allItems = [];
	let counter = 1;
	for (const group of groups) {
		writeLine(`  ${group.label}:`);
		for (const item of group.items) {
			writeLine(`    ${counter}. ${item}`);
			allItems.push(item);
			counter++;
		}
	}

	const answer = await readLine('Enter numbers separated by commas: ');
	const indices = answer
		.split(',')
		.map((s) => parseInt(s.trim(), 10) - 1)
		.filter((i) => i >= 0 && i < allItems.length);
	const normalizedIndices = [...new Set(indices)].sort((a, b) => a - b);

	return normalizedIndices.map((i) => allItems[i]);
}

/**
 * Grouped tree multi-select.
 *
 * Renders a tree of groups, each with selectable items. Groups can be
 * toggled to select/deselect all children.
 *
 * @param {Object}                                  options         - Options.
 * @param {string}                                  options.message - Prompt label shown above the tree.
 * @param {Array<{label: string, items: string[]}>} options.groups  - Groups of selectable items with array-based "items".
 * @return {Promise<string[]>} Array of selected item labels.
 */
async function checkboxTree({ message, groups } = {}) {
	validateGroups(groups);

	if (groups.length === 0) {
		return [];
	}

	if (isTTY() && process.stdin.isTTY) {
		return interactiveCheckboxTree({ message, groups });
	}
	return plainCheckboxTree({ message, groups });
}

module.exports = { checkboxTree };
