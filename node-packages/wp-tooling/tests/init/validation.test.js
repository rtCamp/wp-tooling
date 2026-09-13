'use strict';
const fs = require('fs');
const path = require('path');
const {
	validateSetupFlags,
	validateFeatureFlags,
	validatePaths,
} = require('../../src/init/validation');
const { makeRoot } = require('./_helpers');
const config = {
	features: [{ key: 'demo', label: 'Demo' }],
	examples: { groups: [{ key: 'example', label: 'Example' }] },
};

test('feature flags reject unknown keys and incompatible selections', () => {
	expect(() =>
		validateFeatureFlags(config, { features: ['missing'] })
	).toThrow(/Unknown feature/);
	expect(() =>
		validateFeatureFlags(config, { features: [], enable: [] })
	).toThrow(/cannot be combined/);
	expect(() => validateFeatureFlags(config, { features: [] })).not.toThrow();
	expect(() =>
		validateFeatureFlags(config, { enable: ['demo'], disable: ['demo'] })
	).not.toThrow();
});

test.each(['.', '..', '../outside', '/absolute'])(
	'rejects destructive or escaping configured path %s',
	(target) => {
		const root = makeRoot();
		try {
			expect(() =>
				validatePaths({ cleanup: { targets: [target] } }, root)
			).toThrow();
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	}
);

test('setup validates explicit names, including empty strings', () => {
	expect(() => validateSetupFlags(config, { name: '' })).toThrow(/--name/);
	expect(() => validateSetupFlags(config, { name: '123' })).toThrow(/--name/);
});
test('feature source symlinks must stay inside the feature assets directory', () => {
	const root = makeRoot();
	try {
		fs.mkdirSync(path.join(root, 'bin/features'), { recursive: true });
		fs.writeFileSync(path.join(root, 'outside.txt'), 'content');
		fs.symlinkSync(
			'../../outside.txt',
			path.join(root, 'bin/features/escape.txt')
		);
		expect(() =>
			validatePaths(
				{
					features: [
						{
							key: 'demo',
							label: 'Demo',
							apply: {
								files: [{ from: 'escape.txt', to: 'demo.txt' }],
							},
						},
					],
				},
				root
			)
		).toThrow(/outside/);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
