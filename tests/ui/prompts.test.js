/**
 * Tests for the prompt primitives (text, confirm, password).
 */
'use strict';

const { text, confirm, password } = require('../../src/ui/prompts/index');
const { CancelledError } = require('../../src/ui/errors');

// Mock terminal module to control readLine responses.
jest.mock('../../src/ui/core/terminal', () => {
	const actual = jest.requireActual('../../src/ui/core/terminal');
	return {
		...actual,
		isTTY: jest.fn(() => false),
		readLine: jest.fn(),
		write: jest.fn(),
		writeLine: jest.fn(),
		onKeypress: jest.fn(() => () => {}),
	};
});

const terminal = require('../../src/ui/core/terminal');

beforeEach(() => {
	jest.clearAllMocks();
});

describe('text', () => {
	it('should return the user input', async () => {
		terminal.readLine.mockResolvedValueOnce('hello');
		const result = await text({ message: 'Name?' });
		expect(result).toBe('hello');
	});

	it('should return defaultValue when input is empty', async () => {
		terminal.readLine.mockResolvedValueOnce('');
		const result = await text({ message: 'Name?', defaultValue: 'World' });
		expect(result).toBe('World');
	});

	it('should trim whitespace from input', async () => {
		terminal.readLine.mockResolvedValueOnce('  spaced  ');
		const result = await text({ message: 'Name?' });
		expect(result).toBe('spaced');
	});

	it('should retry when validation fails', async () => {
		terminal.readLine
			.mockResolvedValueOnce('')
			.mockResolvedValueOnce('valid');

		const result = await text({
			message: 'Name?',
			validate: (v) => (v ? undefined : 'Required'),
		});

		expect(result).toBe('valid');
		expect(terminal.readLine).toHaveBeenCalledTimes(2);
	});

	it('should accept a string message shortcut', async () => {
		terminal.readLine.mockResolvedValueOnce('hello');
		const result = await text('Name?');
		expect(result).toBe('hello');
		// Prompt rendered should reference the string message, not undefined.
		expect(terminal.readLine.mock.calls[0][0]).toContain('Name?');
	});

	it('should propagate CancelledError from readLine', async () => {
		terminal.readLine.mockRejectedValueOnce(new CancelledError());
		await expect(text({ message: 'Name?' })).rejects.toThrow(
			CancelledError
		);
	});
});

describe('confirm', () => {
	it('should return true for "y"', async () => {
		terminal.readLine.mockResolvedValueOnce('y');
		const result = await confirm({ message: 'Continue?' });
		expect(result).toBe(true);
	});

	it('should return true for "yes"', async () => {
		terminal.readLine.mockResolvedValueOnce('yes');
		const result = await confirm({ message: 'Continue?' });
		expect(result).toBe(true);
	});

	it('should return false for "n"', async () => {
		terminal.readLine.mockResolvedValueOnce('n');
		const result = await confirm({ message: 'Continue?' });
		expect(result).toBe(false);
	});

	it('should return defaultValue on empty input', async () => {
		terminal.readLine.mockResolvedValueOnce('');
		const result = await confirm({
			message: 'Continue?',
			defaultValue: true,
		});
		expect(result).toBe(true);
	});

	it('should default to false when no defaultValue', async () => {
		terminal.readLine.mockResolvedValueOnce('');
		const result = await confirm({ message: 'Continue?' });
		expect(result).toBe(false);
	});

	it('should accept a string message shortcut', async () => {
		terminal.readLine.mockResolvedValueOnce('y');
		const result = await confirm('Continue?');
		expect(result).toBe(true);
		expect(terminal.readLine.mock.calls[0][0]).toContain('Continue?');
	});

	it('should propagate CancelledError from readLine', async () => {
		terminal.readLine.mockRejectedValueOnce(new CancelledError());
		await expect(confirm({ message: 'Continue?' })).rejects.toThrow(
			CancelledError
		);
	});
});

describe('password', () => {
	it('should fall back to readLine in non-TTY', async () => {
		terminal.isTTY.mockReturnValue(false);
		terminal.readLine.mockResolvedValueOnce('secret123');

		const result = await password({ message: 'Password' });
		expect(result).toBe('secret123');
	});

	it('should accept a string message shortcut', async () => {
		terminal.isTTY.mockReturnValue(false);
		terminal.readLine.mockResolvedValueOnce('shhh');
		const result = await password('Token?');
		expect(result).toBe('shhh');
		expect(terminal.readLine.mock.calls[0][0]).toContain('Token?');
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
			const p = password({ message: 'Password:' });

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
