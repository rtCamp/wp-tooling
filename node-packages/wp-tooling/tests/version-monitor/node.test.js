'use strict';

const path = require('path');

jest.mock('../../src/version-monitor/http', () => ({
	...jest.requireActual('../../src/version-monitor/http'),
	getJson: jest.fn(),
}));
const { getJson } = require('../../src/version-monitor/http');
const node = require('../../src/version-monitor/detectors/node');
const { configWith, FIXTURE_ROOT } = require('./_helpers');

const repo = path.join(FIXTURE_ROOT, 'repo');

const INDEX = [
	{ version: 'v23.1.0', lts: false },
	{ version: 'v22.13.1', lts: 'Jod' },
	{ version: 'v22.11.0', lts: 'Jod' },
	{ version: 'v20.18.0', lts: 'Iron' },
];

describe('node detector', () => {
	it('bumps .nvmrc to the newest LTS in the same major', async () => {
		getJson.mockResolvedValue(INDEX);
		const updates = await node.detect(configWith('node', ['.nvmrc']), {
			cwd: repo,
		});
		expect(updates).toEqual([
			{
				source: 'node',
				file: '.nvmrc',
				package: 'node',
				currentValue: '22.11.0',
				latestValue: '22.13.1',
				reason: 'newer-lts',
			},
		]);
	});

	it('preserves the range prefix in package.json engines', async () => {
		getJson.mockResolvedValue(INDEX);
		const updates = await node.detect(
			configWith('node', ['package.json']),
			{ cwd: repo }
		);
		expect(updates[0]).toMatchObject({
			file: 'package.json',
			currentValue: '>=22.11.0',
			latestValue: '>=22.13.1',
		});
	});

	it('reports nothing when already on the newest LTS', async () => {
		getJson.mockResolvedValue([
			{ version: 'v22.11.0', lts: 'Jod' },
			{ version: 'v23.1.0', lts: false },
		]);
		const updates = await node.detect(configWith('node', ['.nvmrc']), {
			cwd: repo,
		});
		expect(updates).toEqual([]);
	});
});
