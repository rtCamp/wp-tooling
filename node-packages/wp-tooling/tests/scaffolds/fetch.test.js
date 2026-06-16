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
	readCached,
	defaultCacheDir,
	_internal,
} = require('../../src/scaffolds/fetch');

function makeTmpDir(prefix = 'wpt-fetch-') {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Queue-based https.get mock. Each call consumes the next response (the last
// response repeats once the queue is exhausted). Records the captured
// `{ url, options }` per call so tests can assert headers / conditional GETs.
function stubResponses(responses) {
	const calls = [];
	let i = 0;
	https.get.mockImplementation((url, options, callback) => {
		const r = responses[Math.min(i, responses.length - 1)];
		i++;
		calls.push({ url, options });
		const req = new EventEmitter();
		req.destroy = () => {};
		const res = new EventEmitter();
		res.statusCode = r.statusCode;
		res.headers = r.etag ? { etag: r.etag } : {};
		res.setEncoding = () => {};
		process.nextTick(() => {
			callback(res);
			res.emit('data', r.body || '');
			res.emit('end');
		});
		return req;
	});
	return { calls };
}

function stubTransportError(message = 'ECONNRESET') {
	https.get.mockImplementation(() => {
		const req = new EventEmitter();
		req.destroy = () => {};
		process.nextTick(() => req.emit('error', new Error(message)));
		return req;
	});
}

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
				repository: 'rtCamp/wp-shared-workflows',
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
				repository: '/rtCamp/wp-shared-workflows/',
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
		repository: 'rtCamp/wp-shared-workflows',
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

	test('cache miss fetches, writes body + ETag sidecar', async () => {
		stubResponses([{ statusCode: 200, body: 'BODY', etag: 'W/"v1"' }]);
		const body = await fetchRemoteFile(repo, fileSrc, { cacheDir });
		expect(body).toBe('BODY');
		expect(https.get).toHaveBeenCalledTimes(1);
		expect(fs.readFileSync(cachePathFor(expectedUrl), 'utf8')).toBe('BODY');
		expect(
			fs.readFileSync(`${cachePathFor(expectedUrl)}.etag`, 'utf8')
		).toBe('W/"v1"');
	});

	test('cache hit revalidates with If-None-Match; 304 serves cache', async () => {
		await fsp.mkdir(cacheDir, { recursive: true });
		await fsp.writeFile(cachePathFor(expectedUrl), 'CACHED', 'utf8');
		await fsp.writeFile(
			`${cachePathFor(expectedUrl)}.etag`,
			'W/"v1"',
			'utf8'
		);
		const { calls } = stubResponses([{ statusCode: 304 }]);
		const body = await fetchRemoteFile(repo, fileSrc, { cacheDir });
		expect(body).toBe('CACHED');
		expect(https.get).toHaveBeenCalledTimes(1);
		expect(calls[0].options.headers['If-None-Match']).toBe('W/"v1"');
	});

	test('200 with a new body updates the cache', async () => {
		await fsp.mkdir(cacheDir, { recursive: true });
		await fsp.writeFile(cachePathFor(expectedUrl), 'OLD', 'utf8');
		await fsp.writeFile(
			`${cachePathFor(expectedUrl)}.etag`,
			'W/"v1"',
			'utf8'
		);
		stubResponses([{ statusCode: 200, body: 'NEW', etag: 'W/"v2"' }]);
		const body = await fetchRemoteFile(repo, fileSrc, { cacheDir });
		expect(body).toBe('NEW');
		expect(fs.readFileSync(cachePathFor(expectedUrl), 'utf8')).toBe('NEW');
		expect(
			fs.readFileSync(`${cachePathFor(expectedUrl)}.etag`, 'utf8')
		).toBe('W/"v2"');
	});

	test('--refresh re-fetches without a conditional header', async () => {
		await fsp.mkdir(cacheDir, { recursive: true });
		await fsp.writeFile(cachePathFor(expectedUrl), 'CACHED', 'utf8');
		await fsp.writeFile(
			`${cachePathFor(expectedUrl)}.etag`,
			'W/"v1"',
			'utf8'
		);
		const { calls } = stubResponses([
			{ statusCode: 200, body: 'FRESH', etag: 'W/"v2"' },
		]);
		const body = await fetchRemoteFile(repo, fileSrc, {
			cacheDir,
			refresh: true,
		});
		expect(body).toBe('FRESH');
		expect(calls[0].options.headers['If-None-Match']).toBeUndefined();
		expect(fs.readFileSync(cachePathFor(expectedUrl), 'utf8')).toBe(
			'FRESH'
		);
	});

	test('offline (transport error) with a cached copy serves cache + warns', async () => {
		await fsp.mkdir(cacheDir, { recursive: true });
		await fsp.writeFile(cachePathFor(expectedUrl), 'CACHED', 'utf8');
		stubTransportError();
		const warnings = [];
		const body = await fetchRemoteFile(repo, fileSrc, {
			cacheDir,
			warnings,
		});
		expect(body).toBe('CACHED');
		expect(warnings.some((w) => /serving cached/.test(w))).toBe(true);
	});

	test('404 with a cached copy still throws (does not serve stale)', async () => {
		await fsp.mkdir(cacheDir, { recursive: true });
		await fsp.writeFile(cachePathFor(expectedUrl), 'CACHED', 'utf8');
		stubResponses([{ statusCode: 404, body: 'not found' }]);
		await expect(
			fetchRemoteFile(repo, fileSrc, { cacheDir })
		).rejects.toMatchObject({ code: 'EFETCHFAIL', statusCode: 404 });
	});

	test('sends User-Agent and Authorization when token supplied', async () => {
		const { calls } = stubResponses([{ statusCode: 200, body: 'BODY' }]);
		await fetchRemoteFile(repo, fileSrc, { cacheDir, token: 'abc123' });
		expect(calls[0].options.headers['User-Agent']).toBe(
			'rtcamp-wp-tooling'
		);
		expect(calls[0].options.headers.Authorization).toBe('Bearer abc123');
	});

	test('falls back to WP_TOOLING_GITHUB_TOKEN env var', async () => {
		const saved = process.env.WP_TOOLING_GITHUB_TOKEN;
		process.env.WP_TOOLING_GITHUB_TOKEN = 'envtoken';
		try {
			const { calls } = stubResponses([
				{ statusCode: 200, body: 'BODY' },
			]);
			await fetchRemoteFile(repo, fileSrc, { cacheDir });
			expect(calls[0].options.headers.Authorization).toBe(
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

	test('non-2xx with no cache throws EFETCHFAIL with statusCode', async () => {
		stubResponses([{ statusCode: 404, body: 'not found' }]);
		await expect(
			fetchRemoteFile(repo, fileSrc, { cacheDir })
		).rejects.toMatchObject({
			code: 'EFETCHFAIL',
			statusCode: 404,
			url: expectedUrl,
		});
	});

	test('403 + rate-limit body sets rateLimited', async () => {
		stubResponses([
			{ statusCode: 403, body: '{"message":"API rate limit exceeded"}' },
		]);
		await expect(
			fetchRemoteFile(repo, fileSrc, { cacheDir })
		).rejects.toMatchObject({
			code: 'EFETCHFAIL',
			statusCode: 403,
			rateLimited: true,
		});
	});

	test('transport error with no cache throws EFETCHFAIL with cause', async () => {
		stubTransportError('ECONNRESET');
		await expect(
			fetchRemoteFile(repo, fileSrc, { cacheDir })
		).rejects.toMatchObject({
			code: 'EFETCHFAIL',
			cause: 'ECONNRESET',
		});
	});

	test('timeout with no cache throws EFETCHFAIL', async () => {
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
		stubResponses([{ statusCode: 200, body: 'BODY' }]);
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

describe('readCached', () => {
	let cacheDir;
	const repo = {
		repository: 'rtCamp/wp-shared-workflows',
		ref: 'v1',
		path: 'scaffolds',
	};

	beforeEach(() => {
		cacheDir = makeTmpDir();
		jest.clearAllMocks();
	});
	afterEach(() => {
		fs.rmSync(cacheDir, { recursive: true, force: true });
	});

	function cachePathFor(relPath) {
		const url = _internal.composeUrl(repo, relPath);
		const hash = crypto.createHash('sha256').update(url).digest('hex');
		return path.join(cacheDir, hash);
	}

	test('returns null when nothing is cached, never hits the network', async () => {
		expect(await readCached(repo, 'index.json', { cacheDir })).toBeNull();
		expect(https.get).not.toHaveBeenCalled();
	});

	test('returns the cached body when present', async () => {
		fs.mkdirSync(cacheDir, { recursive: true });
		fs.writeFileSync(
			cachePathFor('index.json'),
			'{"scaffolds":[]}',
			'utf8'
		);
		expect(await readCached(repo, 'index.json', { cacheDir })).toBe(
			'{"scaffolds":[]}'
		);
		expect(https.get).not.toHaveBeenCalled();
	});
});
