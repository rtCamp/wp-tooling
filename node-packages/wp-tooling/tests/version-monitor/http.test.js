'use strict';

const { EventEmitter } = require('events');

jest.mock('https');
const https = require('https');
const { getJson } = require('../../src/version-monitor/http');

/**
 * Drive `https.get` with a canned response. Returns the request emitter so a
 * test can fire a transport `error` if it wants.
 *
 * @param {{statusCode: number, body: string}} response Canned response.
 * @return {{captured: Object}} Holder populated with the options passed to https.get.
 */
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

describe('getJson', () => {
	it('resolves parsed JSON on a 2xx response', async () => {
		stubResponse({ statusCode: 200, body: '{"version":"1.2.3"}' });
		await expect(getJson('https://example.test/x')).resolves.toEqual({
			version: '1.2.3',
		});
	});

	it('sends a User-Agent and a bearer token when given one', async () => {
		const { captured } = stubResponse({ statusCode: 200, body: '{}' });
		await getJson('https://example.test/x', { token: 'abc123' });
		expect(captured.options.headers['User-Agent']).toBeDefined();
		expect(captured.options.headers.Authorization).toBe('Bearer abc123');
	});

	it('rejects on a non-2xx status', async () => {
		stubResponse({ statusCode: 404, body: 'not found' });
		await expect(getJson('https://example.test/x')).rejects.toThrow(
			/HTTP 404/
		);
	});

	it('flags rate-limit responses', async () => {
		stubResponse({
			statusCode: 403,
			body: '{"message":"API rate limit exceeded"}',
		});
		await expect(getJson('https://example.test/x')).rejects.toMatchObject({
			rateLimited: true,
		});
	});

	it('rejects on invalid JSON', async () => {
		stubResponse({ statusCode: 200, body: 'not-json' });
		await expect(getJson('https://example.test/x')).rejects.toThrow(
			/invalid JSON/
		);
	});

	it('rejects on a transport error', async () => {
		https.get.mockImplementation(() => {
			const req = new EventEmitter();
			req.destroy = () => {};
			process.nextTick(() => req.emit('error', new Error('ECONNRESET')));
			return req;
		});
		await expect(getJson('https://example.test/x')).rejects.toThrow(
			/ECONNRESET/
		);
	});

	it('rejects and tears down the request on timeout', async () => {
		let destroyed = false;
		https.get.mockImplementation(() => {
			const req = new EventEmitter();
			req.destroy = () => {
				destroyed = true;
			};
			process.nextTick(() => req.emit('timeout'));
			return req;
		});
		await expect(getJson('https://example.test/x')).rejects.toThrow(
			/timed out/
		);
		expect(destroyed).toBe(true);
	});
});

describe('isClientError', () => {
	const { isClientError } = require('../../src/version-monitor/http');

	it('is true for a non-rate-limit 4xx', () => {
		expect(isClientError({ statusCode: 404 })).toBe(true);
		expect(isClientError({ statusCode: 401 })).toBe(true);
	});

	it('is false for rate limits, 5xx, and transport errors', () => {
		expect(isClientError({ statusCode: 403, rateLimited: true })).toBe(
			false
		);
		expect(isClientError({ statusCode: 500 })).toBe(false);
		expect(isClientError({})).toBe(false);
	});
});
