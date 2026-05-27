'use strict';

const path = require('path');

jest.mock('../../src/version-monitor/http', () => ({
	...jest.requireActual('../../src/version-monitor/http'),
	getJson: jest.fn(),
}));
const { getJson } = require('../../src/version-monitor/http');
const { detect } = require('../../src/version-monitor/detect');
const { configWith, FIXTURE_ROOT } = require('./_helpers');

const repo = path.join(FIXTURE_ROOT, 'repo');

function allDisabled() {
	const cfg = configWith('npm', ['package.json']);
	cfg.sources.npm.enabled = false;
	return cfg;
}

describe('detect orchestrator', () => {
	it('annotates each update with is_major', async () => {
		getJson.mockImplementation((url) =>
			url.includes('lodash')
				? Promise.resolve({ version: '5.0.0' })
				: Promise.resolve({ version: '29.7.0' })
		);
		const updates = await detect(configWith('npm', ['package.json']), {
			cwd: repo,
		});
		expect(updates.find((u) => u.package === 'lodash').is_major).toBe(true);
		expect(updates.find((u) => u.package === 'jest').is_major).toBe(false);
	});

	it('runs no detector when every source is disabled', async () => {
		const updates = await detect(allDisabled(), { cwd: repo });
		expect(updates).toEqual([]);
		expect(getJson).not.toHaveBeenCalled();
	});

	it('records hard failures so the run is not silently empty', async () => {
		getJson.mockRejectedValue(new Error('network down'));
		const errors = [];
		const updates = await detect(configWith('npm', ['package.json']), {
			cwd: repo,
			errors,
		});
		expect(updates).toEqual([]);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors[0]).toMatch(/npm/);
	});

	it('treats a rate limit as soft (no recorded error)', async () => {
		const limited = new Error('rate limited');
		limited.rateLimited = true;
		getJson.mockRejectedValue(limited);
		const errors = [];
		const updates = await detect(configWith('npm', ['package.json']), {
			cwd: repo,
			errors,
		});
		expect(updates).toEqual([]);
		expect(errors).toEqual([]);
	});

	it('does not record an expected 404 as a hard failure', async () => {
		const notFound = new Error('not found');
		notFound.statusCode = 404;
		getJson.mockRejectedValue(notFound);
		const errors = [];
		const updates = await detect(configWith('npm', ['package.json']), {
			cwd: repo,
			errors,
		});
		expect(updates).toEqual([]);
		expect(errors).toEqual([]);
	});
});
