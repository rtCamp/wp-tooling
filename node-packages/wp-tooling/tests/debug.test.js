/**
 * Tests for src/debug.js -- the opt-in diagnostic logger. Every other caller
 * test loads this module with WP_TOOLING_DEBUG unset, so the enabled path
 * (stream patching, phase timing, error recording, report append) otherwise
 * has zero coverage. `ENABLED` is computed once at require time, so each
 * test resets modules and re-requires with the env var already set.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let logPath;

beforeEach(() => {
	logPath = path.join(
		fs.mkdtempSync(path.join(os.tmpdir(), 'wp-tooling-debug-')),
		'debug.log'
	);
	process.env.WP_TOOLING_DEBUG = '1';
	process.env.WP_TOOLING_DEBUG_LOG = logPath;
	jest.resetModules();
});

afterEach(() => {
	delete process.env.WP_TOOLING_DEBUG;
	delete process.env.WP_TOOLING_DEBUG_LOG;
	jest.resetModules();
});

test('records a successful phase and appends a report on finish', async () => {
	const debug = require('../src/debug');
	const beforeStart = process.stdout.write;

	debug.start('test command', { kind: 'plugin', cwd: '/tmp/x' });
	const duringPatch = process.stdout.write;
	expect(duringPatch).not.toBe(beforeStart);

	await debug.phase('setupFlow', async () => {
		process.stdout.write('hello\n');
	});
	debug.event('capabilities', { selected: 4 });
	debug.finish({ result: 'ok' });

	// unpatchStreams restores a bound copy of the pre-patch function rather
	// than the exact same reference, so assert restoration happened (the
	// active patch wrapper is gone), not object identity with beforeStart.
	expect(process.stdout.write).not.toBe(duringPatch);

	const report = fs.readFileSync(logPath, 'utf8');
	expect(report).toContain('command: test command');
	expect(report).toContain('result: ok');
	expect(report).toContain('setupFlow');
	expect(report).toContain('OK: no errors recorded.');
});

test('records a throwing phase, rethrows, and reflects the error in the report', async () => {
	const debug = require('../src/debug');

	debug.start('test command', {});
	const duringPatch = process.stdout.write;

	await expect(
		debug.phase('boom', async () => {
			throw new Error('kaboom');
		})
	).rejects.toThrow('kaboom');

	debug.finish({ result: 'error' });
	expect(process.stdout.write).not.toBe(duringPatch);

	const report = fs.readFileSync(logPath, 'utf8');
	expect(report).toContain('result: error');
	expect(report).toContain('ERROR in "boom": kaboom');
});

test('is a no-op when WP_TOOLING_DEBUG is unset', async () => {
	delete process.env.WP_TOOLING_DEBUG;
	jest.resetModules();
	const debug = require('../src/debug');
	const origWrite = process.stdout.write;

	debug.start('test command', {});
	expect(process.stdout.write).toBe(origWrite);
	expect(debug.enabled()).toBe(false);

	const ran = await debug.phase('setupFlow', async () => 'value');
	expect(ran).toBe('value');

	debug.finish({ result: 'ok' });
	expect(fs.existsSync(logPath)).toBe(false);
});
