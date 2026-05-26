'use strict';

const path = require('path');

jest.mock('../../src/version-monitor/http', () => ({
	...jest.requireActual('../../src/version-monitor/http'),
	getJson: jest.fn(),
}));
const { getJson } = require('../../src/version-monitor/http');
const php = require('../../src/version-monitor/detectors/php');
const { configWith, FIXTURE_ROOT } = require('./_helpers');

const repo = path.join(FIXTURE_ROOT, 'repo');

// php.net feed shape: keyed by branch, each value carries `version`.
const RELEASES = {
	8.3: { version: '8.3.2' },
	8.2: { version: '8.2.15' },
	8.1: { version: '8.1.27' },
};

describe('php detector', () => {
	it('targets the latest stable at the current granularity', async () => {
		getJson.mockResolvedValue(RELEASES);
		const updates = await php.detect(configWith('php', ['composer.json']), {
			cwd: repo,
		});
		expect(updates).toEqual([
			{
				source: 'php',
				file: 'composer.json',
				package: 'php',
				currentValue: '>=8.1',
				latestValue: '>=8.3',
				reason: 'newer-php',
			},
		]);
	});

	it('reports nothing when already on the latest branch', async () => {
		getJson.mockResolvedValue({ 8.1: { version: '8.1.27' } });
		const updates = await php.detect(configWith('php', ['composer.json']), {
			cwd: repo,
		});
		expect(updates).toEqual([]);
	});

	it('skips compound constraints', () => {
		expect(php.isSimpleConstraint('^8.1 || ^8.2')).toBe(false);
		expect(php.isSimpleConstraint('>=8.1')).toBe(true);
	});

	it('ignores pre-release releases when picking the latest', () => {
		expect(
			php.latestStable({
				8.4: { version: '8.4.0RC1' },
				8.3: { version: '8.3.2' },
			})
		).toBe('8.3.2');
	});
});
