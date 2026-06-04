/**
 * Tests for the public, TTY-aware `style` helpers.
 */
'use strict';

const { style } = require('../../src/ui/style/index');

describe('style', () => {
	let descriptor;

	beforeEach(() => {
		descriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
	});

	afterEach(() => {
		if (descriptor) {
			Object.defineProperty(process.stdout, 'isTTY', descriptor);
		} else {
			delete process.stdout.isTTY;
		}
	});

	it('wraps text in ANSI codes when stdout is a TTY', () => {
		Object.defineProperty(process.stdout, 'isTTY', {
			value: true,
			configurable: true,
		});
		const out = style.error('boom');
		expect(out).toContain('boom');
		expect(out.startsWith('\x1b[31m')).toBe(true);
		expect(out.endsWith('\x1b[0m')).toBe(true);
	});

	it('returns plain text when stdout is not a TTY (no ANSI leaks into logs)', () => {
		Object.defineProperty(process.stdout, 'isTTY', {
			value: false,
			configurable: true,
		});
		expect(style.success('ok')).toBe('ok');
		expect(style.warning('w')).toBe('w');
		expect(style.info('i')).toBe('i');
		expect(style.muted('m')).toBe('m');
		expect(style.bold('b')).toBe('b');
	});

	it('exposes the full set of semantic helpers', () => {
		for (const key of [
			'error',
			'success',
			'warning',
			'info',
			'muted',
			'bold',
		]) {
			expect(typeof style[key]).toBe('function');
		}
	});
});
