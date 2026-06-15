/**
 * Tests for select primitives (checkbox, radio, checkboxTree).
 */
'use strict';

const { checkbox, radio } = require('../../src/ui/selects/flat');
const { checkboxTree } = require('../../src/ui/selects/tree');
const { CancelledError } = require('../../src/ui/errors');

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

	it('should return unique selections in display order', async () => {
		terminal.readLine.mockResolvedValueOnce('3, 1, 1');

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

describe('flat select validation', () => {
	it('should throw when checkbox choices is missing', async () => {
		await expect(
			checkbox({
				message: 'Pick items',
			})
		).rejects.toThrow(
			'checkbox() expected "choices" to be a non-empty array, received undefined.'
		);
	});

	it('should throw when radio choices is empty', async () => {
		await expect(
			radio({
				message: 'Pick one',
				choices: [],
			})
		).rejects.toThrow(
			'radio() expected "choices" to be a non-empty array, received an empty array.'
		);
	});
});

describe('flat select (TTY) -- Ctrl+C', () => {
	it('should reject with CancelledError on Ctrl+C', async () => {
		terminal.isTTY.mockReturnValue(true);

		const stdinDescriptor = Object.getOwnPropertyDescriptor(
			process.stdin,
			'isTTY'
		);
		Object.defineProperty(process.stdin, 'isTTY', {
			value: true,
			configurable: true,
		});

		let keypressHandler;
		terminal.onKeypress.mockImplementation((handler) => {
			keypressHandler = handler;
			return () => {};
		});

		try {
			const p = checkbox({
				message: 'Pick items',
				choices: ['alpha', 'beta'],
			});

			keypressHandler(null, { name: 'c', ctrl: true });

			await expect(p).rejects.toThrow(CancelledError);
		} finally {
			if (stdinDescriptor) {
				Object.defineProperty(process.stdin, 'isTTY', stdinDescriptor);
			} else {
				delete process.stdin.isTTY;
			}
		}
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

	it('should return unique selections in display order', async () => {
		terminal.readLine.mockResolvedValueOnce('4, 1, 1');

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

	it('should throw when groups is missing', async () => {
		await expect(
			checkboxTree({
				message: 'Select modules',
			})
		).rejects.toThrow(
			'checkboxTree() expected "groups" to be an array, received undefined.'
		);
	});

	it('should throw when groups is null', async () => {
		await expect(
			checkboxTree({
				message: 'Select modules',
				groups: null,
			})
		).rejects.toThrow(
			'checkboxTree() expected "groups" to be an array, received null.'
		);
	});

	it('should throw when a group items is not an array', async () => {
		await expect(
			checkboxTree({
				message: 'Select modules',
				groups: [{ label: 'Utilities' }],
			})
		).rejects.toThrow(
			'checkboxTree() expected "groups[0].items" to be an array, received undefined.'
		);
	});

	it('should return an empty array for empty groups without prompting', async () => {
		const result = await checkboxTree({
			message: 'Select modules',
			groups: [],
		});

		expect(result).toEqual([]);
		expect(terminal.readLine).not.toHaveBeenCalled();
	});
});

describe('checkboxTree (TTY)', () => {
	it('should resolve selections in display order, not toggle order', async () => {
		terminal.isTTY.mockReturnValue(true);

		const stdinDescriptor = Object.getOwnPropertyDescriptor(
			process.stdin,
			'isTTY'
		);
		Object.defineProperty(process.stdin, 'isTTY', {
			value: true,
			configurable: true,
		});

		let keypressHandler;
		terminal.onKeypress.mockImplementation((handler) => {
			keypressHandler = handler;
			return () => {};
		});

		try {
			const selectionPromise = checkboxTree({
				message: 'Select modules',
				groups: [
					{ label: 'Utilities', items: ['cache', 'logger'] },
					{ label: 'Integrations', items: ['algolia', 'scheduler'] },
				],
			});

			keypressHandler(null, { name: 'down' });
			keypressHandler(null, { name: 'down' });
			keypressHandler(null, { name: 'down' });
			keypressHandler(null, { name: 'down' });
			keypressHandler(null, { name: 'down' });
			keypressHandler(null, { name: 'space' });

			keypressHandler(null, { name: 'up' });
			keypressHandler(null, { name: 'up' });
			keypressHandler(null, { name: 'up' });
			keypressHandler(null, { name: 'up' });
			keypressHandler(null, { name: 'space' });

			keypressHandler(null, { name: 'return' });

			await expect(selectionPromise).resolves.toEqual([
				'cache',
				'scheduler',
			]);
		} finally {
			if (stdinDescriptor) {
				Object.defineProperty(process.stdin, 'isTTY', stdinDescriptor);
			} else {
				delete process.stdin.isTTY;
			}
		}
	});

	it('should reject with CancelledError on Ctrl+C', async () => {
		terminal.isTTY.mockReturnValue(true);

		const stdinDescriptor = Object.getOwnPropertyDescriptor(
			process.stdin,
			'isTTY'
		);
		Object.defineProperty(process.stdin, 'isTTY', {
			value: true,
			configurable: true,
		});

		let keypressHandler;
		terminal.onKeypress.mockImplementation((handler) => {
			keypressHandler = handler;
			return () => {};
		});

		try {
			const p = checkboxTree({
				message: 'Select modules',
				groups: [{ label: 'Utilities', items: ['cache', 'logger'] }],
			});

			keypressHandler(null, { name: 'c', ctrl: true });

			await expect(p).rejects.toThrow(CancelledError);
		} finally {
			if (stdinDescriptor) {
				Object.defineProperty(process.stdin, 'isTTY', stdinDescriptor);
			} else {
				delete process.stdin.isTTY;
			}
		}
	});
});
