'use strict';

const path = require('path');

jest.mock('../../src/version-monitor/http', () => ({
	...jest.requireActual('../../src/version-monitor/http'),
	getJson: jest.fn(),
}));
const { getJson } = require('../../src/version-monitor/http');
const wpCli = require('../../src/version-monitor/detectors/wp-cli');
const { configWith, FIXTURE_ROOT } = require('./_helpers');

const repo = path.join(FIXTURE_ROOT, 'repo');
const config = configWith('wp-cli', ['.github/workflows/*.yml']);

describe('wp-cli detector', () => {
	it('reports an update when a newer release exists', async () => {
		getJson.mockResolvedValue({ tag_name: 'v2.11.0' });
		const updates = await wpCli.detect(config, { cwd: repo });
		expect(updates).toEqual([
			{
				source: 'wp-cli',
				file: '.github/workflows/ci.yml',
				package: 'wp-cli',
				currentValue: '2.10.0',
				latestValue: '2.11.0',
				reason: 'newer-release',
			},
		]);
	});

	it('reports nothing when already on the latest release', async () => {
		getJson.mockResolvedValue({ tag_name: 'v2.10.0' });
		const updates = await wpCli.detect(config, { cwd: repo });
		expect(updates).toEqual([]);
	});

	it('makes no request when no wp-cli version is pinned', async () => {
		const updates = await wpCli.detect(
			configWith('wp-cli', ['Dockerfile']),
			{ cwd: repo }
		);
		expect(updates).toEqual([]);
		expect(getJson).not.toHaveBeenCalled();
	});
});
