/**
 * Tests for the status-line + table reporting helpers.
 */
'use strict';

const report = require('../../src/ui/report/index');

describe('report helpers', () => {
	let descriptor;
	let out;
	let spy;

	beforeEach(() => {
		descriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
		// Non-TTY so style helpers emit plain text (no ANSI to assert around).
		Object.defineProperty(process.stdout, 'isTTY', {
			value: false,
			configurable: true,
		});
		out = '';
		spy = jest.spyOn(process.stdout, 'write').mockImplementation((text) => {
			out += text;
			return true;
		});
	});

	afterEach(() => {
		spy.mockRestore();
		if (descriptor) {
			Object.defineProperty(process.stdout, 'isTTY', descriptor);
		} else {
			delete process.stdout.isTTY;
		}
	});

	it('prints a success line with a + marker', () => {
		report.success('done');
		expect(out).toBe('+ done\n');
	});

	it('prints warn and error lines with their markers', () => {
		report.warn('careful');
		report.error('boom');
		expect(out).toBe('! careful\nx boom\n');
	});

	it('prints a heading with a leading blank line', () => {
		report.heading('Setup');
		expect(out).toBe('\nSetup\n');
	});

	it('prints an indented info line', () => {
		report.info('detail');
		expect(out).toBe('  detail\n');
	});

	it('renders a key/value table with a title and box borders', () => {
		report.table({ Name: 'Acme' }, { title: 'Details' });
		const lines = out.split('\n');
		expect(lines[0]).toBe('');
		expect(lines[1]).toBe('Details');
		expect(lines[2].startsWith('+')).toBe(true);
		expect(lines[2].endsWith('+')).toBe(true);
		expect(lines[3]).toContain('Name:');
		expect(lines[3]).toContain('Acme');
		expect(lines[4].startsWith('+')).toBe(true);
	});

	it('skips empty tables', () => {
		report.table({});
		expect(out).toBe('');
	});
});
