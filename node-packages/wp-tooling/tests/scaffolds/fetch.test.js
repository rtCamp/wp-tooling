'use strict';

const { EventEmitter } = require('events');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

jest.mock('https');
const https = require('https');

const {
	fetchRemoteFile,
	defaultCacheDir,
	isCacheableRef,
	_internal,
} = require('../../src/scaffolds/fetch');

function makeTmpDir(prefix = 'wpt-fetch-') {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function stubResponse(response) {
	const captured = {};
	https.get.mockImplementation((url, options, callback) => {
		captured.url = url;
		captured.options = options;
		const req = new EventEmitter();
		req.destroy = () => {};
		const res = new EventEmitter();
		res.statusCode = response.statusCode;
		res.setEncoding = () => {};
		process.nextTick(() => {
			callback(res);
			res.emit('data', response.body);
			res.emit('end');
		});
		return req;
	});
	return { captured };
}

describe('isCacheableRef', () => {
	test.each([
		['v1', true],
		['v1.2', true],
		['v1.2.3', true],
		['v1.2.3-rc1', true],
		['v1.2.3+build', true],
		['a'.repeat(40), true],
		['0123456789abcdef0123456789abcdef01234567', true],
		['main', false],
		['master', false],
		['develop', false],
		['HEAD', false],
		['feature/x', false],
		['abc1234', false],
		['1.2.3', false],
		['', false],
	])('isCacheableRef(%j) -> %s', (ref, expected) => {
		expect(isCacheableRef(ref)).toBe(expected);
	});

	test('rejects non-strings', () => {
		expect(isCacheableRef(undefined)).toBe(false);
		expect(isCacheableRef(null)).toBe(false);
		expect(isCacheableRef(123)).toBe(false);
	});
});

describe('defaultCacheDir', () => {
	const savedXdg = process.env.XDG_CACHE_HOME;
	afterEach(() => {
		if (savedXdg === undefined) {
			delete process.env.XDG_CACHE_HOME;
		} else {
			process.env.XDG_CACHE_HOME = savedXdg;
		}
	});

	test('honours XDG_CACHE_HOME when set', () => {
		process.env.XDG_CACHE_HOME = '/var/xdg-test';
		expect(defaultCacheDir()).toBe('/var/xdg-test/wp-tooling/remote');
	});

	test('falls back to ~/.cache when XDG_CACHE_HOME is empty', () => {
		process.env.XDG_CACHE_HOME = '';
		expect(defaultCacheDir()).toBe(
			path.join(os.homedir(), '.cache', 'wp-tooling', 'remote')
		);
	});
});

describe('composeUrl', () => {
	const { composeUrl } = _internal;

	test('builds a raw-content URL', () => {
		const url = composeUrl(
			{
				github: 'rtCamp/wp-shared-workflows',
				ref: 'v1',
				path: 'scaffolds/ci/test-php',
			},
			'ci-test-php.yml.mustache'
		);
		expect(url).toBe(
			'https://raw.githubusercontent.com/rtCamp/wp-shared-workflows/v1/scaffolds/ci/test-php/ci-test-php.yml.mustache'
		);
	});

	test('normalises leading and trailing slashes on each segment', () => {
		const url = composeUrl(
			{
				github: '/rtCamp/wp-shared-workflows/',
				ref: '/v1/',
				path: '/scaffolds/ci/test-php/',
			},
			'/ci-test-php.yml.mustache'
		);
		expect(url).toBe(
			'https://raw.githubusercontent.com/rtCamp/wp-shared-workflows/v1/scaffolds/ci/test-php/ci-test-php.yml.mustache'
		);
	});
});

describe('fetchRemoteFile', () => {
	let cacheDir;
	const repo = {
		github: 'rtCamp/wp-shared-workflows',
		ref: 'v1',
		path: 'scaffolds/ci/test-php',
	};
	const fileSrc = 'ci-test-php.yml.mustache';
	const expectedUrl =
		'https://raw.githubusercontent.com/rtCamp/wp-shared-workflows/v1/scaffolds/ci/test-php/ci-test-php.yml.mustache';

	beforeEach(() => {
		cacheDir = makeTmpDir();
		jest.clearAllMocks();
	});

	afterEach(() => {
		fs.rmSync(cacheDir, { recursive: true, force: true });
	});

	function cachePathFor(url) {
		const hash = crypto.createHash('sha256').update(url).digest('hex');
		return path.join(cacheDir, hash);
	}

	test('cacheable ref + cache miss fetches and writes to cache', async () => {
		stubResponse({ statusCode: 200, body: 'BODY' });
		const body = await fetchRemoteFile(repo, fileSrc, { cacheDir });
		expect(body).toBe('BODY');
		expect(https.get).toHaveBeenCalledTimes(1);
		expect(fs.readFileSync(cachePathFor(expectedUrl), 'utf8')).toBe('BODY');
	});

	test('cacheable ref + cache hit reads from disk, no HTTP', async () => {
		await fsp.mkdir(cacheDir, { recursive: true });
		await fsp.writeFile(cachePathFor(expectedUrl), 'CACHED', 'utf8');
		const body = await fetchRemoteFile(repo, fileSrc, { cacheDir });
		expect(body).toBe('CACHED');
		expect(https.get).not.toHaveBeenCalled();
	});

	test('--refresh bypasses cache and re-fetches', async () => {
		await fsp.mkdir(cacheDir, { recursive: true });
		await fsp.writeFile(cachePathFor(expectedUrl), 'CACHED', 'utf8');
		stubResponse({ statusCode: 200, body: 'FRESH' });
		const body = await fetchRemoteFile(repo, fileSrc, {
			cacheDir,
			refresh: true,
		});
		expect(body).toBe('FRESH');
		expect(https.get).toHaveBeenCalledTimes(1);
		expect(fs.readFileSync(cachePathFor(expectedUrl), 'utf8')).toBe(
			'FRESH'
		);
	});

	test('mutable ref always fetches and never writes to cache', async () => {
		stubResponse({ statusCode: 200, body: 'BODY' });
		const mutableRepo = { ...repo, ref: 'main' };
		await fetchRemoteFile(mutableRepo, fileSrc, { cacheDir });
		await fetchRemoteFile(mutableRepo, fileSrc, { cacheDir });
		expect(https.get).toHaveBeenCalledTimes(2);
		expect(fs.readdirSync(cacheDir)).toEqual([]);
	});

	test('sends User-Agent and Authorization when token supplied', async () => {
		const { captured } = stubResponse({ statusCode: 200, body: 'BODY' });
		await fetchRemoteFile(repo, fileSrc, { cacheDir, token: 'abc123' });
		expect(captured.options.headers['User-Agent']).toBe(
			'rtcamp-wp-tooling'
		);
		expect(captured.options.headers.Authorization).toBe('Bearer abc123');
	});

	test('falls back to WP_TOOLING_GITHUB_TOKEN env var', async () => {
		const saved = process.env.WP_TOOLING_GITHUB_TOKEN;
		process.env.WP_TOOLING_GITHUB_TOKEN = 'envtoken';
		try {
			const { captured } = stubResponse({
				statusCode: 200,
				body: 'BODY',
			});
			await fetchRemoteFile(repo, fileSrc, { cacheDir });
			expect(captured.options.headers.Authorization).toBe(
				'Bearer envtoken'
			);
		} finally {
			if (saved === undefined) {
				delete process.env.WP_TOOLING_GITHUB_TOKEN;
			} else {
				process.env.WP_TOOLING_GITHUB_TOKEN = saved;
			}
		}
	});

	test('non-2xx throws EFETCHFAIL with statusCode', async () => {
		stubResponse({ statusCode: 404, body: 'not found' });
		await expect(
			fetchRemoteFile(repo, fileSrc, { cacheDir })
		).rejects.toMatchObject({
			code: 'EFETCHFAIL',
			statusCode: 404,
			url: expectedUrl,
		});
	});

	test('403 + rate-limit body sets rateLimited', async () => {
		stubResponse({
			statusCode: 403,
			body: '{"message":"API rate limit exceeded"}',
		});
		await expect(
			fetchRemoteFile(repo, fileSrc, { cacheDir })
		).rejects.toMatchObject({
			code: 'EFETCHFAIL',
			statusCode: 403,
			rateLimited: true,
		});
	});

	test('transport error throws EFETCHFAIL with cause', async () => {
		https.get.mockImplementation(() => {
			const req = new EventEmitter();
			req.destroy = () => {};
			process.nextTick(() => req.emit('error', new Error('ECONNRESET')));
			return req;
		});
		await expect(
			fetchRemoteFile(repo, fileSrc, { cacheDir })
		).rejects.toMatchObject({
			code: 'EFETCHFAIL',
			cause: 'ECONNRESET',
		});
	});

	test('timeout throws EFETCHFAIL', async () => {
		let destroyed = false;
		https.get.mockImplementation(() => {
			const req = new EventEmitter();
			req.destroy = () => {
				destroyed = true;
			};
			process.nextTick(() => req.emit('timeout'));
			return req;
		});
		await expect(
			fetchRemoteFile(repo, fileSrc, { cacheDir })
		).rejects.toMatchObject({
			code: 'EFETCHFAIL',
		});
		expect(destroyed).toBe(true);
	});

	test('cache write failure records a warning but returns body', async () => {
		stubResponse({ statusCode: 200, body: 'BODY' });
		// Point cacheDir at a regular file so mkdir + writeFile fail.
		const blocker = path.join(makeTmpDir(), 'blocker');
		fs.writeFileSync(blocker, 'x');
		const warnings = [];
		try {
			const body = await fetchRemoteFile(repo, fileSrc, {
				cacheDir: blocker,
				warnings,
			});
			expect(body).toBe('BODY');
			expect(warnings.length).toBeGreaterThan(0);
			expect(warnings[0]).toMatch(/cache (read|write) failed/);
		} finally {
			fs.rmSync(path.dirname(blocker), { recursive: true, force: true });
		}
	});
});
