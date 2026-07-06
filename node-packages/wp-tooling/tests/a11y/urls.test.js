'use strict';

const path = require('path');

const { resolveUrls, extractUrls } = require('../../src/a11y/urls');
const { RunnerError } = require('../../src/a11y/errors');

const FIXTURES = path.join(__dirname, 'fixtures');

/**
 * Run `fn` and return whatever it throws (or null). Keeps assertions out of a
 * catch block, which `jest/no-conditional-expect` forbids.
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

describe('resolveUrls', () => {
	test('reads string and { url } entries from the default config', () => {
		const r = resolveUrls({ cwd: FIXTURES });
		expect(r.urls).toEqual([
			'http://localhost:8888/',
			'http://localhost:8888/about',
		]);
		expect(r.configPath).toBe(path.join(FIXTURES, '.pa11yci.json'));
	});

	test('a custom --config path is resolved relative to cwd (empty urls -> ENOURLS)', () => {
		const err = grab(() =>
			resolveUrls({
				cwd: FIXTURES,
				configPath: 'empty-urls.pa11yci.json',
			})
		);
		expect(err).toBeInstanceOf(RunnerError);
		expect(err.code).toBe('ENOURLS');
	});

	test('a missing config throws ENOURLS with the install hint', () => {
		const err = grab(() =>
			resolveUrls({ cwd: FIXTURES, configPath: 'does-not-exist.json' })
		);
		expect(err.code).toBe('ENOURLS');
		expect(err.message).toMatch(/wp-tooling add setup\/pa11y/);
	});
});

describe('extractUrls', () => {
	test('handles strings, objects, and skips junk', () => {
		expect(
			extractUrls({
				urls: [
					'http://a/',
					{ url: 'http://b/' },
					{ nope: true },
					'',
					42,
				],
			})
		).toEqual(['http://a/', 'http://b/']);
	});

	test('returns [] when urls is absent or not an array', () => {
		expect(extractUrls({})).toEqual([]);
		expect(extractUrls({ urls: 'x' })).toEqual([]);
		expect(extractUrls(null)).toEqual([]);
	});
});
