/**
 * Tests for low-level TTY helpers.
 */
'use strict';

const { EventEmitter } = require('events');

// Mock readline so we can drive question/SIGINT/close synchronously.
jest.mock('readline', () => {
	const created = [];

	function createInterface() {
		const rl = new (require('events').EventEmitter)();
		rl.question = jest.fn((_prompt, cb) => {
			rl._questionCb = cb;
		});
		rl.close = jest.fn(() => {
			rl.emit('close');
		});
		created.push(rl);
		return rl;
	}

	return {
		createInterface: jest.fn(createInterface),
		emitKeypressEvents: jest.fn(),
		__getCreated: () => created,
		__reset: () => {
			created.length = 0;
		},
	};
});

const readline = require('readline');

let stdoutIsTTYDescriptor;
let stdinIsTTYDescriptor;
let stdoutWriteSpy;

function setStdoutTTY(value) {
	Object.defineProperty(process.stdout, 'isTTY', {
		value,
		configurable: true,
	});
}

function setStdinTTY(value) {
	Object.defineProperty(process.stdin, 'isTTY', {
		value,
		configurable: true,
	});
}

beforeEach(() => {
	jest.clearAllMocks();
	readline.__reset();
	stdoutIsTTYDescriptor = Object.getOwnPropertyDescriptor(
		process.stdout,
		'isTTY'
	);
	stdinIsTTYDescriptor = Object.getOwnPropertyDescriptor(
		process.stdin,
		'isTTY'
	);
	stdoutWriteSpy = jest
		.spyOn(process.stdout, 'write')
		.mockImplementation(() => true);
});

afterEach(() => {
	if (stdoutIsTTYDescriptor) {
		Object.defineProperty(process.stdout, 'isTTY', stdoutIsTTYDescriptor);
	} else {
		delete process.stdout.isTTY;
	}
	if (stdinIsTTYDescriptor) {
		Object.defineProperty(process.stdin, 'isTTY', stdinIsTTYDescriptor);
	} else {
		delete process.stdin.isTTY;
	}
	stdoutWriteSpy.mockRestore();
});

/**
 * Load a fresh copy of the terminal module so module-level state (the
 * non-TTY line queue) does not leak across tests.
 *
 * @return {Object} The freshly-loaded terminal module exports.
 */
function loadTerminal() {
	let mod;
	jest.isolateModules(() => {
		mod = require('../../src/ui/core/terminal');
	});
	return mod;
}

describe('ANSI', () => {
	it('should expose the expected escape sequences', () => {
		const { ANSI } = loadTerminal();
		expect(ANSI.reset).toBe('\x1b[0m');
		expect(ANSI.bold).toBe('\x1b[1m');
		expect(ANSI.cyan).toBe('\x1b[36m');
		expect(ANSI.hideCursor).toBe('\x1b[?25l');
		expect(ANSI.showCursor).toBe('\x1b[?25h');
	});
});

describe('isTTY', () => {
	it('should return true when stdout is a TTY', () => {
		setStdoutTTY(true);
		expect(loadTerminal().isTTY()).toBe(true);
	});

	it('should return false when stdout is not a TTY', () => {
		setStdoutTTY(false);
		expect(loadTerminal().isTTY()).toBe(false);
	});
});

describe('write / writeLine', () => {
	it('should write text without appending a newline', () => {
		loadTerminal().write('hello');
		expect(stdoutWriteSpy).toHaveBeenCalledWith('hello');
	});

	it('should append a newline when writeLine is called', () => {
		loadTerminal().writeLine('hi');
		expect(stdoutWriteSpy).toHaveBeenCalledWith('hi\n');
	});

	it('should default writeLine to an empty line', () => {
		loadTerminal().writeLine();
		expect(stdoutWriteSpy).toHaveBeenCalledWith('\n');
	});
});

describe('clearLine', () => {
	it('should write clear-line + carriage return when stdout is a TTY', () => {
		setStdoutTTY(true);
		const { clearLine, ANSI } = loadTerminal();
		clearLine();
		expect(stdoutWriteSpy).toHaveBeenCalledWith(
			ANSI.clearLine + ANSI.moveToColumn0
		);
	});

	it('should write nothing when stdout is not a TTY', () => {
		setStdoutTTY(false);
		loadTerminal().clearLine();
		expect(stdoutWriteSpy).not.toHaveBeenCalled();
	});
});

describe('moveCursorUp', () => {
	it('should emit the move-up escape when n > 0 in a TTY', () => {
		setStdoutTTY(true);
		loadTerminal().moveCursorUp(3);
		expect(stdoutWriteSpy).toHaveBeenCalledWith('\x1b[3A');
	});

	it('should not write anything when n is 0', () => {
		setStdoutTTY(true);
		loadTerminal().moveCursorUp(0);
		expect(stdoutWriteSpy).not.toHaveBeenCalled();
	});

	it('should not write anything in non-TTY', () => {
		setStdoutTTY(false);
		loadTerminal().moveCursorUp(2);
		expect(stdoutWriteSpy).not.toHaveBeenCalled();
	});
});

describe('hideCursor / showCursor', () => {
	it('should write the hide/show sequences in a TTY', () => {
		setStdoutTTY(true);
		const { hideCursor, showCursor, ANSI } = loadTerminal();
		hideCursor();
		showCursor();
		expect(stdoutWriteSpy).toHaveBeenNthCalledWith(1, ANSI.hideCursor);
		expect(stdoutWriteSpy).toHaveBeenNthCalledWith(2, ANSI.showCursor);
	});

	it('should write nothing in non-TTY', () => {
		setStdoutTTY(false);
		const { hideCursor, showCursor } = loadTerminal();
		hideCursor();
		showCursor();
		expect(stdoutWriteSpy).not.toHaveBeenCalled();
	});
});

describe('readLine -- TTY mode', () => {
	beforeEach(() => {
		setStdoutTTY(true);
		setStdinTTY(true);
	});

	it('should resolve with the typed answer', async () => {
		const { readLine } = loadTerminal();
		const promise = readLine('Name? ');

		const [rl] = readline.__getCreated();
		rl._questionCb('Adi');

		await expect(promise).resolves.toBe('Adi');
		expect(rl.close).toHaveBeenCalled();
	});

	it('should reject with CancelledError on SIGINT', async () => {
		const { readLine } = loadTerminal();

		const promise = readLine('Name? ');
		const [rl] = readline.__getCreated();
		rl.emit('SIGINT');

		// isolateModules gives terminal.js its own CancelledError instance,
		// so we match on the canonical name rather than constructor identity.
		await expect(promise).rejects.toMatchObject({
			name: 'CancelledError',
			message: 'Prompt cancelled by user.',
		});
	});

	it('should resolve empty when closed without an answer or cancellation', async () => {
		const { readLine } = loadTerminal();
		const promise = readLine('Name? ');
		const [rl] = readline.__getCreated();
		rl.emit('close');
		await expect(promise).resolves.toBe('');
	});
});

describe('readLine -- non-TTY mode', () => {
	beforeEach(() => {
		setStdoutTTY(false);
		setStdinTTY(false);
	});

	it('should buffer lines from stdin and resolve in order', async () => {
		const terminal = loadTerminal();

		const first = terminal.readLine('first: ');
		const [rl] = readline.__getCreated();
		rl.emit('line', 'one');
		await expect(first).resolves.toBe('one');

		const buffered = terminal.readLine('second: ');
		rl.emit('line', 'two');
		await expect(buffered).resolves.toBe('two');

		expect(stdoutWriteSpy).toHaveBeenCalledWith('first: ');
		expect(stdoutWriteSpy).toHaveBeenCalledWith('second: ');
	});

	it('should resolve queued waiters with an empty string when stdin closes', async () => {
		const terminal = loadTerminal();
		const pending = terminal.readLine('prompt: ');
		const [rl] = readline.__getCreated();
		rl.emit('close');
		await expect(pending).resolves.toBe('');
	});

	it('should resolve immediately with an empty string after stdin has closed', async () => {
		const terminal = loadTerminal();
		const priming = terminal.readLine('a: ');
		const [rl] = readline.__getCreated();
		rl.emit('close');
		await priming;

		await expect(terminal.readLine('b: ')).resolves.toBe('');
	});

	it('should buffer lines that arrive before a reader is waiting', async () => {
		const terminal = loadTerminal();
		const first = terminal.readLine('a: ');
		const [rl] = readline.__getCreated();
		rl.emit('line', 'one');
		rl.emit('line', 'two');
		await expect(first).resolves.toBe('one');
		await expect(terminal.readLine('b: ')).resolves.toBe('two');
	});
});

describe('onKeypress', () => {
	it('should return a no-op cleanup in non-TTY', () => {
		setStdinTTY(false);
		const { onKeypress } = loadTerminal();
		const cleanup = onKeypress(jest.fn());
		expect(typeof cleanup).toBe('function');
		cleanup();
		expect(readline.emitKeypressEvents).not.toHaveBeenCalled();
	});

	it('should wire up keypress events on stdin in a TTY and clean them up', () => {
		setStdinTTY(true);

		// Replace stdin with a stub EventEmitter so we can observe listener
		// add/remove without touching the real stdin used by Jest.
		const stub = new EventEmitter();
		stub.isTTY = true;
		stub.setRawMode = jest.fn();
		stub.resume = jest.fn();
		stub.pause = jest.fn();
		const originalStdin = process.stdin;
		Object.defineProperty(process, 'stdin', {
			value: stub,
			configurable: true,
		});

		try {
			const { onKeypress } = loadTerminal();
			const handler = jest.fn();
			const cleanup = onKeypress(handler);

			expect(readline.emitKeypressEvents).toHaveBeenCalledWith(stub);
			expect(stub.setRawMode).toHaveBeenCalledWith(true);
			expect(stub.resume).toHaveBeenCalled();
			expect(stub.listenerCount('keypress')).toBe(1);

			stub.emit('keypress', 'a', { name: 'a' });
			expect(handler).toHaveBeenCalledWith('a', { name: 'a' });

			cleanup();
			expect(stub.listenerCount('keypress')).toBe(0);
			expect(stub.setRawMode).toHaveBeenLastCalledWith(false);
			expect(stub.pause).toHaveBeenCalled();
		} finally {
			Object.defineProperty(process, 'stdin', {
				value: originalStdin,
				configurable: true,
			});
		}
	});

	it('should skip setRawMode when stdin does not support it', () => {
		setStdinTTY(true);

		const stub = new EventEmitter();
		stub.isTTY = true;
		stub.resume = jest.fn();
		stub.pause = jest.fn();
		// Note: no setRawMode.
		const originalStdin = process.stdin;
		Object.defineProperty(process, 'stdin', {
			value: stub,
			configurable: true,
		});

		try {
			const { onKeypress } = loadTerminal();
			const cleanup = onKeypress(jest.fn());
			cleanup();
			expect(stub.resume).toHaveBeenCalled();
			expect(stub.pause).toHaveBeenCalled();
		} finally {
			Object.defineProperty(process, 'stdin', {
				value: originalStdin,
				configurable: true,
			});
		}
	});
});
