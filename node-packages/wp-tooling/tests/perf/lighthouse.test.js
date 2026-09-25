'use strict';

jest.mock('child_process');

const { execFileSync } = require('child_process');
const { runLighthouse, buildArgs } = require('../../src/perf/lighthouse');

const BIN_OBJ = { command: 'lighthouse', args: [] };
const LIGHTHOUSE_CFG = { categories: ['performance'] };

/**
 * Run `fn` and return whatever it throws (or null).
 *
 * @param {Function} fn Function expected to throw.
 * @return {Error|null} The thrown error, or null if it did not throw.
 */
function grab(fn) {
	try {
		fn();
	} catch (err) {
		return err;
	}
	return null;
}

describe('buildArgs', () => {
	test('builds the argument vector for one URL', () => {
		expect(buildArgs(BIN_OBJ, 'http://x/', LIGHTHOUSE_CFG)).toEqual([
			'http://x/',
			'--output=json',
			'--output-path=stdout',
			'--only-categories=performance',
			'--quiet',
			'--chrome-flags=--headless=new --no-sandbox',
		]);
	});

	test('joins multiple categories', () => {
		const args = buildArgs(BIN_OBJ, 'http://x/', {
			categories: ['performance', 'accessibility'],
		});
		expect(args).toContain('--only-categories=performance,accessibility');
	});
});

describe('runLighthouse', () => {
	test('passes CHROME_PATH when a chromePath is given', () => {
		execFileSync.mockReturnValue(JSON.stringify({ categories: {} }));
		runLighthouse(BIN_OBJ, 'http://x/', LIGHTHOUSE_CFG, {
			chromePath: '/path/to/chrome',
		});
		const [, , opts] = execFileSync.mock.calls[0];
		expect(opts.env.CHROME_PATH).toBe('/path/to/chrome');
	});

	test('leaves env untouched when no chromePath is given', () => {
		execFileSync.mockReturnValue(JSON.stringify({ categories: {} }));
		runLighthouse(BIN_OBJ, 'http://x/', LIGHTHOUSE_CFG, {});
		const [, , opts] = execFileSync.mock.calls[0];
		expect(opts.env).toBe(process.env);
	});

	test('returns the parsed LHR on success', () => {
		execFileSync.mockReturnValue(
			JSON.stringify({ categories: { performance: { score: 0.9 } } })
		);
		const lhr = runLighthouse(BIN_OBJ, 'http://x/', LIGHTHOUSE_CFG);
		expect(lhr.categories.performance.score).toBe(0.9);
	});

	test('throws RunnerError EBINFAIL when the binary fails to run', () => {
		execFileSync.mockImplementation(() => {
			const err = new Error('boom');
			err.stderr = 'Chrome crashed';
			throw err;
		});
		const err = grab(() =>
			runLighthouse(BIN_OBJ, 'http://x/', LIGHTHOUSE_CFG)
		);
		expect(err.code).toBe('EBINFAIL');
		expect(err.message).toMatch(/Chrome crashed/);
	});

	test('throws RunnerError EBADJSON on unparseable output', () => {
		execFileSync.mockReturnValue('not json at all');
		const err = grab(() =>
			runLighthouse(BIN_OBJ, 'http://x/', LIGHTHOUSE_CFG)
		);
		expect(err.code).toBe('EBADJSON');
	});
});
