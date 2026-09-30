'use strict';
const fs = require('fs');
const {
	selectFeatures,
	selectCapabilities,
} = require('../../src/init/selection');
const { makeRoot } = require('./_helpers');

test('exact empty selection overrides defaults', () => {
	expect([...selectFeatures({ features: [] }, ['demo'])]).toEqual([]);
});

test('disable wins when both deltas name the same feature', () => {
	expect([
		...selectFeatures({ enable: ['demo'], disable: ['demo'] }, []),
	]).toEqual([]);
});

test.each(['theme', 'plugin'])(
	'interactive %s defaults agree with detected features',
	async (kind) => {
		const root = makeRoot();
		const ui = { checkboxTree: jest.fn(async () => ['Detected']) };
		try {
			const result = await selectCapabilities(
				{
					kind,
					features: [
						{
							key: 'detected',
							label: 'Detected',
							detect: () => true,
						},
					],
				},
				root,
				{},
				{},
				false,
				ui
			);
			expect([...result.wantOn]).toEqual(['detected']);
			expect(ui.checkboxTree).toHaveBeenCalledWith({
				message: `Select the capabilities to include in your ${kind}`,
				groups: [
					{
						label: 'Other',
						items: [{ label: 'Detected', checked: true }],
					},
				],
			});
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	}
);
