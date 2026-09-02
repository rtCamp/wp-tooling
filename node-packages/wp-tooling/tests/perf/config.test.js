'use strict';

const path = require('path');

const {
	resolveConfig,
	mergeConfig,
	DEFAULTS,
} = require('../../src/perf/config');
const { RunnerError } = require('../../src/perf/errors');

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

describe('resolveConfig — default path', () => {
	test('reads urls and every section from the default .perfrc.json', () => {
		const r = resolveConfig({ cwd: FIXTURES });
		expect(r.urls).toEqual([
			'http://localhost:8888/',
			'http://localhost:8888/?p=1',
		]);
		expect(r.configPath).toBe(path.join(FIXTURES, '.perfrc.json'));
		expect(r.config.lighthouse.enabled).toBe(true);
		expect(r.config.server.enabled).toBe(true);
		expect(r.config.server.shim).toBe('server-profile.php');
	});
});

describe('resolveConfig — --config', () => {
	test('resolves a custom --config path relative to cwd', () => {
		const r = resolveConfig({
			cwd: FIXTURES,
			configPath: 'partial.perfrc.json',
		});
		expect(r.configPath).toBe(path.join(FIXTURES, 'partial.perfrc.json'));
		expect(r.urls).toEqual(['http://localhost:8888/']);
	});
});

describe('resolveConfig — --url precedence', () => {
	test('--url replaces the config urls[] entirely, other sections still come from the file', () => {
		const r = resolveConfig({
			cwd: FIXTURES,
			urls: ['http://example.test/'],
		});
		expect(r.urls).toEqual(['http://example.test/']);
		expect(r.config.urls).toEqual(['http://example.test/']);
		// Non-urls sections still come from the config file.
		expect(r.config.server.enabled).toBe(true);
	});

	test('a missing config file + --url falls back to defaults with configPath null', () => {
		const r = resolveConfig({
			cwd: FIXTURES,
			configPath: 'does-not-exist.json',
			urls: ['http://example.test/'],
		});
		expect(r.configPath).toBeNull();
		expect(r.urls).toEqual(['http://example.test/']);
		expect(r.config.lighthouse).toEqual(DEFAULTS.lighthouse);
		expect(r.config.server.enabled).toBe(false);
	});
});

describe('resolveConfig — errors', () => {
	test('a missing config with no --url throws ENOURLS with the install hint', () => {
		const err = grab(() =>
			resolveConfig({ cwd: FIXTURES, configPath: 'does-not-exist.json' })
		);
		expect(err).toBeInstanceOf(RunnerError);
		expect(err.code).toBe('ENOURLS');
		expect(err.message).toMatch(/wp-tooling add setup\/perf/);
	});

	test('empty urls with no --url throws ENOURLS', () => {
		const err = grab(() =>
			resolveConfig({
				cwd: FIXTURES,
				configPath: '.perfrc.no-urls.json',
			})
		);
		expect(err.code).toBe('ENOURLS');
	});

	test('malformed JSON throws EBADJSON even when --url is given', () => {
		const err = grab(() =>
			resolveConfig({
				cwd: FIXTURES,
				configPath: 'malformed.perfrc.json',
				urls: ['http://example.test/'],
			})
		);
		expect(err).toBeInstanceOf(RunnerError);
		expect(err.code).toBe('EBADJSON');
	});

	test('a config path that is a directory throws ECONFIGREAD, not a silent fallback', () => {
		const err = grab(() =>
			resolveConfig({ cwd: FIXTURES, configPath: '.' })
		);
		expect(err).toBeInstanceOf(RunnerError);
		expect(err.code).toBe('ECONFIGREAD');
	});

	test('a config path that is a directory throws ECONFIGREAD even when --url is given', () => {
		const err = grab(() =>
			resolveConfig({
				cwd: FIXTURES,
				configPath: '.',
				urls: ['http://example.test/'],
			})
		);
		expect(err).toBeInstanceOf(RunnerError);
		expect(err.code).toBe('ECONFIGREAD');
	});
});

describe('mergeConfig', () => {
	test('merges a partial section over its defaults without touching others', () => {
		const merged = mergeConfig({
			urls: ['http://x/'],
			lighthouse: { enabled: false },
		});
		expect(merged.lighthouse).toEqual({
			enabled: false,
			categories: DEFAULTS.lighthouse.categories,
			topAudits: DEFAULTS.lighthouse.topAudits,
		});
		expect(merged.webVitals).toEqual(DEFAULTS.webVitals);
		expect(merged.server).toEqual(DEFAULTS.server);
		expect(merged.thresholds).toEqual(DEFAULTS.thresholds);
	});

	test('tolerates null/undefined/non-object input', () => {
		expect(mergeConfig(null)).toEqual({ ...DEFAULTS });
		expect(mergeConfig(undefined)).toEqual({ ...DEFAULTS });
		expect(mergeConfig('nope').urls).toEqual([]);
	});

	test('filters non-string / empty entries out of urls', () => {
		expect(mergeConfig({ urls: ['a', '', 42, null, 'b'] }).urls).toEqual([
			'a',
			'b',
		]);
	});
});
