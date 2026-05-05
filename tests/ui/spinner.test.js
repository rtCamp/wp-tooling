/**
 * Tests for the spinner primitive.
 */
'use strict';

const { spinner } = require('../../src/ui/spinner/index');

let writtenOutput;

beforeEach(() => {
	writtenOutput = [];
	jest.spyOn(process.stdout, 'write').mockImplementation((text) => {
		writtenOutput.push(text);
		return true;
	});
	jest.useFakeTimers();
});

afterEach(() => {
	jest.useRealTimers();
	jest.restoreAllMocks();
});

describe('spinner', () => {
	it('should return an object with start, succeed, fail, update methods', () => {
		const s = spinner('Test');
		expect(typeof s.start).toBe('function');
		expect(typeof s.succeed).toBe('function');
		expect(typeof s.fail).toBe('function');
		expect(typeof s.update).toBe('function');
	});

	describe('non-TTY mode', () => {
		let stdoutTTYDescriptor;

		beforeEach(() => {
			stdoutTTYDescriptor = Object.getOwnPropertyDescriptor(
				process.stdout,
				'isTTY'
			);
			Object.defineProperty(process.stdout, 'isTTY', {
				value: false,
				configurable: true,
			});
		});

		afterEach(() => {
			if (stdoutTTYDescriptor) {
				Object.defineProperty(
					process.stdout,
					'isTTY',
					stdoutTTYDescriptor
				);
			} else {
				delete process.stdout.isTTY;
			}
		});

		it('should print plain text on start in non-TTY', () => {
			const s = spinner('Installing…');
			s.start();

			const output = writtenOutput.join('');
			expect(output).toContain('Installing…');
		});

		it('should print succeed message in non-TTY', () => {
			const s = spinner('Working…');
			s.start();
			writtenOutput = [];
			s.succeed('Done!');

			const output = writtenOutput.join('');
			expect(output).toContain('Done!');
			expect(output).toContain('+');
		});

		it('should print fail message in non-TTY', () => {
			const s = spinner('Working…');
			s.start();
			writtenOutput = [];
			s.fail('Error!');

			const output = writtenOutput.join('');
			expect(output).toContain('Error!');
			expect(output).toContain('x');
		});
	});

	describe('TTY mode', () => {
		let stdoutTTYDescriptor;

		beforeEach(() => {
			stdoutTTYDescriptor = Object.getOwnPropertyDescriptor(
				process.stdout,
				'isTTY'
			);
			Object.defineProperty(process.stdout, 'isTTY', {
				value: true,
				configurable: true,
			});
		});

		afterEach(() => {
			if (stdoutTTYDescriptor) {
				Object.defineProperty(
					process.stdout,
					'isTTY',
					stdoutTTYDescriptor
				);
			} else {
				delete process.stdout.isTTY;
			}
		});

		it('should animate frames on an interval', () => {
			const s = spinner('Loading…');
			s.start();

			jest.advanceTimersByTime(80 * 3);

			// Should have written multiple frames.
			expect(writtenOutput.length).toBeGreaterThanOrEqual(3);
			s.succeed();
		});

		it('should not create multiple intervals when start is called twice', () => {
			const setIntervalSpy = jest.spyOn(global, 'setInterval');
			try {
				const s = spinner('Loading…');
				s.start();
				s.start();

				expect(setIntervalSpy).toHaveBeenCalledTimes(1);
				s.succeed();
			} finally {
				setIntervalSpy.mockRestore();
			}
		});

		it('should stop animation on succeed', () => {
			const s = spinner('Loading…');
			s.start();

			jest.advanceTimersByTime(80);
			s.succeed('All done');

			const callCount = writtenOutput.length;
			jest.advanceTimersByTime(80 * 10);

			// No new writes after succeed.
			expect(writtenOutput.length).toBe(callCount);
		});

		it('should stop animation on fail', () => {
			const s = spinner('Loading…');
			s.start();

			jest.advanceTimersByTime(80);
			s.fail('Oops');

			const callCount = writtenOutput.length;
			jest.advanceTimersByTime(80 * 10);

			expect(writtenOutput.length).toBe(callCount);
		});

		it('should update text while running', () => {
			const s = spinner('Phase 1');
			s.start();

			jest.advanceTimersByTime(80);
			s.update('Phase 2');
			jest.advanceTimersByTime(80);

			const output = writtenOutput.join('');
			expect(output).toContain('Phase 2');
			s.succeed();
		});
	});

	it('should default to current text when succeed is called without args', () => {
		const stdoutTTYDescriptor = Object.getOwnPropertyDescriptor(
			process.stdout,
			'isTTY'
		);
		Object.defineProperty(process.stdout, 'isTTY', {
			value: false,
			configurable: true,
		});
		try {
			const s = spinner('Default text');
			s.start();
			writtenOutput = [];
			s.succeed();

			const output = writtenOutput.join('');
			expect(output).toContain('Default text');
		} finally {
			if (stdoutTTYDescriptor) {
				Object.defineProperty(
					process.stdout,
					'isTTY',
					stdoutTTYDescriptor
				);
			} else {
				delete process.stdout.isTTY;
			}
		}
	});
});
