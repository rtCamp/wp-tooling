'use strict';

const path = require('path');

jest.mock('../../src/version-monitor/http', () => ({
	...jest.requireActual('../../src/version-monitor/http'),
	getJson: jest.fn(),
}));
const { getJson } = require('../../src/version-monitor/http');
const actions = require('../../src/version-monitor/detectors/actions');
const { configWith, FIXTURE_ROOT } = require('./_helpers');

const repo = path.join(FIXTURE_ROOT, 'repo');
const config = configWith('actions', ['.github/workflows/*.yml']);

describe('actions.parseUses', () => {
	it('extracts version-tagged actions and skips non-tag refs', () => {
		const refs = actions.parseUses(
			[
				'      - uses: actions/checkout@v4.0.0',
				'      - uses: ./.github/actions/local@v1',
				'      - uses: docker://alpine:3',
				'      - uses: some/action@main',
				'      - uses: floating/major@v3',
			].join('\n')
		);
		expect(refs).toEqual([
			{
				action: 'actions/checkout',
				ref: 'v4.0.0',
				owner: 'actions',
				repo: 'checkout',
			},
		]);
	});
});

describe('actions detector', () => {
	it('reports an update when a newer release exists', async () => {
		getJson.mockResolvedValue({ tag_name: 'v4.2.0' });
		const updates = await actions.detect(config, { cwd: repo });
		expect(updates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					source: 'actions',
					package: 'actions/setup-node',
					currentValue: 'v4.0.2',
					latestValue: 'v4.2.0',
					reason: 'newer-release',
				}),
			])
		);
	});

	it('reports nothing when the pinned ref is already latest', async () => {
		getJson.mockImplementation((url) => {
			if (url.includes('checkout')) {
				return Promise.resolve({ tag_name: 'v4.0.0' });
			}
			return Promise.resolve({ tag_name: 'v4.0.2' });
		});
		const updates = await actions.detect(config, { cwd: repo });
		expect(updates).toEqual([]);
	});

	it('stops early on a rate-limit error', async () => {
		const err = new Error('rate limited');
		err.rateLimited = true;
		getJson.mockRejectedValue(err);
		const updates = await actions.detect(config, { cwd: repo });
		expect(updates).toEqual([]);
		expect(getJson).toHaveBeenCalledTimes(1);
	});
});
