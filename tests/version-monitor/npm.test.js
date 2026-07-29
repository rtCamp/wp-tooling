'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../../src/version-monitor/http', () => ({
	...jest.requireActual('../../src/version-monitor/http'),
	getJson: jest.fn(),
}));
const { getJson } = require('../../src/version-monitor/http');
const npm = require('../../src/version-monitor/detectors/npm');
const {
	configWith,
	copyFixture,
	cleanup,
	FIXTURE_ROOT,
} = require('./_helpers');

const repo = path.join(FIXTURE_ROOT, 'repo');
const config = configWith('npm', ['package.json']);

/**
 * Resolve a canned latest version per package name.
 *
 * @param {Object<string, string>} versions Package -> latest version.
 */
function mockRegistry(versions) {
	getJson.mockImplementation((url) => {
		for (const [name, version] of Object.entries(versions)) {
			if (url.includes(name)) {
				return Promise.resolve({ version });
			}
		}
		return Promise.reject(new Error(`unexpected url ${url}`));
	});
}

describe('npm detector', () => {
	it('reports an update when a newer version is published', async () => {
		mockRegistry({ lodash: '4.17.21', jest: '29.7.0' });
		const updates = await npm.detect(config, { cwd: repo });
		const lodash = updates.find((u) => u.package === 'lodash');
		expect(lodash).toMatchObject({
			source: 'npm',
			file: 'package.json',
			currentValue: '^4.17.0',
			latestValue: '^4.17.21',
			reason: 'newer-on-registry',
		});
		expect(updates.find((u) => u.package === 'jest').latestValue).toBe(
			'^29.7.0'
		);
	});

	it('reports nothing when current equals latest', async () => {
		mockRegistry({ lodash: '4.17.0', jest: '29.0.0' });
		const updates = await npm.detect(config, { cwd: repo });
		expect(updates).toEqual([]);
	});

	it('skips floating pins like "*"', async () => {
		mockRegistry({ lodash: '4.17.21', jest: '29.7.0' });
		const updates = await npm.detect(config, { cwd: repo });
		expect(updates.some((u) => u.package === 'left-pad')).toBe(false);
		expect(getJson).not.toHaveBeenCalledWith(
			expect.stringContaining('left-pad')
		);
	});

	it('skips pre-release publishes', async () => {
		mockRegistry({ lodash: '5.0.0-beta.1', jest: '29.0.0' });
		const updates = await npm.detect(config, { cwd: repo });
		expect(updates.some((u) => u.package === 'lodash')).toBe(false);
	});

	it('percent-encodes the slash in a scoped package name', async () => {
		const dir = copyFixture('repo');
		try {
			fs.writeFileSync(
				path.join(dir, 'package.json'),
				JSON.stringify({
					name: 'scoped-fixture',
					dependencies: { '@wordpress/scripts': '^30.0.0' },
				})
			);
			mockRegistry({ '@wordpress%2Fscripts': '30.1.0' });
			await npm.detect(config, { cwd: dir });
			expect(getJson).toHaveBeenCalledWith(
				expect.stringContaining('/@wordpress%2Fscripts/latest')
			);
		} finally {
			cleanup(dir);
		}
	});
});
