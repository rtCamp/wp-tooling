/**
 * Tests for select primitives (checkbox, radio, checkboxTree).
 */
'use strict';

const { checkbox, radio } = require('../../src/ui/selects/flat');
const { checkboxTree } = require('../../src/ui/selects/tree');

// Mock terminal module.
jest.mock('../../src/ui/core/terminal', () => {
	const actual = jest.requireActual('../../src/ui/core/terminal');
	return {
		...actual,
		isTTY: jest.fn(() => false),
		readLine: jest.fn(),
		write: jest.fn(),
		writeLine: jest.fn(),
		clearLine: jest.fn(),
		moveCursorUp: jest.fn(),
		hideCursor: jest.fn(),
		showCursor: jest.fn(),
		onKeypress: jest.fn(() => () => {}),
	};
});

const terminal = require('../../src/ui/core/terminal');

beforeEach(() => {
	jest.clearAllMocks();
	terminal.isTTY.mockReturnValue(false);
});

describe('checkbox (non-TTY)', () => {
	it('should return selected items by number', async () => {
		terminal.readLine.mockResolvedValueOnce('1, 3');

		const result = await checkbox({
			message: 'Pick items',
			choices: ['alpha', 'beta', 'gamma'],
		});

		expect(result).toEqual(['alpha', 'gamma']);
	});

	it('should handle empty input gracefully', async () => {
		terminal.readLine.mockResolvedValueOnce('');

		const result = await checkbox({
			message: 'Pick items',
			choices: ['alpha', 'beta'],
		});

		expect(result).toEqual([]);
	});
});

describe('radio (non-TTY)', () => {
	it('should return a single selected item', async () => {
		terminal.readLine.mockResolvedValueOnce('2');

		const result = await radio({
			message: 'Pick one',
			choices: ['alpha', 'beta', 'gamma'],
		});

		expect(result).toBe('beta');
	});

	it('should default to first choice on invalid input', async () => {
		terminal.readLine.mockResolvedValueOnce('invalid');

		const result = await radio({
			message: 'Pick one',
			choices: ['alpha', 'beta'],
		});

		expect(result).toBe('alpha');
	});
});

describe('checkboxTree (non-TTY)', () => {
	it('should return selected items from groups by number', async () => {
		terminal.readLine.mockResolvedValueOnce('1, 4');

		const result = await checkboxTree({
			message: 'Select modules',
			groups: [
				{
					label: 'Utilities',
					items: ['cache', 'logger', 'transients'],
				},
				{
					label: 'Integrations',
					items: ['algolia', 'action-scheduler'],
				},
			],
		});

		expect(result).toEqual(['cache', 'algolia']);
	});

	it('should handle empty selection', async () => {
		terminal.readLine.mockResolvedValueOnce('');

		const result = await checkboxTree({
			message: 'Select modules',
			groups: [{ label: 'Group A', items: ['item1'] }],
		});

		expect(result).toEqual([]);
	});
});
