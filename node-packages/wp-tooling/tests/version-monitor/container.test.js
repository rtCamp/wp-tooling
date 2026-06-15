'use strict';

const path = require('path');

jest.mock('../../src/version-monitor/http', () => ({
	...jest.requireActual('../../src/version-monitor/http'),
	getJson: jest.fn(),
}));
const { getJson } = require('../../src/version-monitor/http');
const container = require('../../src/version-monitor/detectors/container');
const { configWith, FIXTURE_ROOT } = require('./_helpers');

const repo = path.join(FIXTURE_ROOT, 'repo');
const config = configWith('container', [
	'Dockerfile',
	'.devcontainer/devcontainer.json',
]);

function mockHub(byRepo) {
	getJson.mockImplementation((url) => {
		for (const [repoPath, tags] of Object.entries(byRepo)) {
			if (url.includes(repoPath)) {
				return Promise.resolve({
					results: tags.map((name) => ({ name })),
				});
			}
		}
		return Promise.reject(new Error(`unexpected url ${url}`));
	});
}

describe('container helpers', () => {
	it('splits image references and skips digest pins', () => {
		expect(container.splitImageTag('node:22.11.0')).toEqual({
			image: 'node',
			tag: '22.11.0',
		});
		expect(container.splitImageTag('node@sha256:abc')).toBeNull();
		expect(container.splitImageTag('node')).toBeNull();
	});

	it('maps official images to library/* and rejects other registries', () => {
		expect(container.hubRepo('node')).toBe('library/node');
		expect(container.hubRepo('org/app')).toBe('org/app');
		expect(container.hubRepo('ghcr.io/org/app')).toBeNull();
	});

	it('picks the newest tag of the same numeric shape', () => {
		expect(
			container.pickLatestTag(
				['22.11.0', '22.13.1', 'latest', '22.13.1-alpine'],
				'22.11.0'
			)
		).toBe('22.13.1');
	});

	it('collects images past --platform flags and across multi-stage FROMs', () => {
		const pins = container.collectPins(repo, ['Dockerfile.platform']);
		expect(pins).toEqual([
			{ file: 'Dockerfile.platform', image: 'node', tag: '22.11.0' },
			{ file: 'Dockerfile.platform', image: 'nginx', tag: '1.27.0' },
		]);
	});
});

describe('container detector', () => {
	it('reports updates for Dockerfile and devcontainer images', async () => {
		mockHub({
			'library/node': ['22.11.0', '22.13.1', 'latest'],
			'library/php': ['8.1', '8.2', '8.3', '8.3-fpm'],
		});
		const updates = await container.detect(config, { cwd: repo });
		expect(updates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					source: 'container',
					file: 'Dockerfile',
					package: 'node',
					currentValue: '22.11.0',
					latestValue: '22.13.1',
					reason: 'newer-image',
				}),
				expect.objectContaining({
					file: '.devcontainer/devcontainer.json',
					package: 'php',
					currentValue: '8.1',
					latestValue: '8.3',
				}),
			])
		);
	});

	it('reports nothing when the current tag is newest', async () => {
		mockHub({
			'library/node': ['22.11.0', '22.10.0'],
			'library/php': ['8.1'],
		});
		const updates = await container.detect(config, { cwd: repo });
		expect(updates).toEqual([]);
	});
});
