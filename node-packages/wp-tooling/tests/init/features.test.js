/**
 * Feature kernel tests -- the FeatureApi editing surface and the enable /
 * disable / detect round trip that consumer feature declarations ride on.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const {
	makeFeatureApi,
	enableFeature,
	disableFeature,
	detectFeature,
	toggleFeatures,
} = require('../../src/init/features');
const { makeRoot, touch } = require('./_helpers');

/**
 * Recording UI double. Captures every line the kernel prints so tests can
 * assert on ordering and content without matching ANSI styling.
 *
 * @return {Object} UI with a `.calls` record.
 */
const fakeUi = () => {
	const calls = { info: [], warn: [], success: [], error: [], heading: [] };
	const push = (bucket) => (msg) => calls[bucket].push(String(msg));
	return {
		calls,
		info: push('info'),
		warn: push('warn'),
		success: push('success'),
		error: push('error'),
		heading: push('heading'),
		table: () => {},
		spinner: () => ({
			start: () => {},
			succeed: () => {},
			fail: () => {},
		}),
		confirm: async () => true,
		radio: async () => 'Apply changes',
	};
};

const readJson = (root, rel) =>
	JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

const raw = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const IDENTITY = { kind: 'plugin', slug: 'demo', features: {} };

describe('api.editJson', () => {
	let root;
	let api;

	beforeEach(() => {
		root = makeRoot();
		api = makeFeatureApi(root, IDENTITY, fakeUi());
	});

	afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

	it('preserves tab indentation', () => {
		touch(root, 'composer.json', '{\n\t"name": "acme/demo"\n}\n');

		api.editJson('composer.json', (obj) => {
			obj['require-dev'] = { 'rtcamp/wp-dev-tools': 'dev-main' };
		});

		expect(raw(root, 'composer.json')).toBe(
			'{\n\t"name": "acme/demo",\n\t"require-dev": {\n\t\t"rtcamp/wp-dev-tools": "dev-main"\n\t}\n}\n'
		);
	});

	it('preserves two-space indentation', () => {
		touch(root, '.wp-env.json', '{\n  "core": null\n}\n');

		api.editJson('.wp-env.json', (obj) => {
			obj.port = 8888;
		});

		expect(raw(root, '.wp-env.json')).toBe(
			'{\n  "core": null,\n  "port": 8888\n}\n'
		);
	});

	it('throws for a missing file without create', () => {
		expect(() => api.editJson('nope.json', () => {})).toThrow(
			'editJson: nope.json not found'
		);
		expect(fs.existsSync(path.join(root, 'nope.json'))).toBe(false);
	});

	it('names the offending file when the JSON is unparseable', () => {
		touch(root, '.wp-env.override.json', '{ this is not json');

		expect(() => api.editJson('.wp-env.override.json', () => {})).toThrow(
			/editJson: \.wp-env\.override\.json is not valid JSON/
		);

		// The broken file is left exactly as found, never clobbered.
		expect(raw(root, '.wp-env.override.json')).toBe('{ this is not json');
	});

	it('creates a missing file with create, defaulting to tab indent', () => {
		api.editJson(
			'.wp-env.override.json',
			(obj) => {
				obj.env = { development: { config: { SAVEQUERIES: true } } };
			},
			{ create: true }
		);

		expect(raw(root, '.wp-env.override.json')).toBe(
			'{\n\t"env": {\n\t\t"development": {\n\t\t\t"config": {\n\t\t\t\t"SAVEQUERIES": true\n\t\t\t}\n\t\t}\n\t}\n}\n'
		);
	});

	it('takes a created file indent from indentFrom', () => {
		touch(root, '.wp-env.json', '{\n  "core": null\n}\n');

		api.editJson(
			'.wp-env.override.json',
			(obj) => {
				obj.port = 9999;
			},
			{ create: true, indentFrom: '.wp-env.json' }
		);

		expect(raw(root, '.wp-env.override.json')).toBe(
			'{\n  "port": 9999\n}\n'
		);
	});

	it('leaves an existing file untouched when the mutator throws', () => {
		const before = '{\n\t"name": "acme/demo"\n}\n';
		touch(root, 'composer.json', before);

		expect(() =>
			api.editJson('composer.json', () => {
				throw new Error('boom');
			})
		).toThrow('boom');

		// The write never happened, so the journal has nothing to undo.
		expect(raw(root, 'composer.json')).toBe(before);
	});

	it('rolls back a completed edit when a later hook step throws', () => {
		const before = '{\n\t"name": "acme/demo"\n}\n';
		touch(root, 'composer.json', before);
		touch(root, 'package.json', '{\n\t"name": "demo"\n}\n');

		const feature = {
			key: 'rollback',
			label: 'Rollback',
			onEnable: (a) => {
				a.editJson('composer.json', (obj) => {
					obj['require-dev'] = { 'rtcamp/wp-dev-tools': 'dev-main' };
				});
				a.editJson(
					'.wp-env.override.json',
					(obj) => {
						obj.env = {};
					},
					{ create: true }
				);
				throw new Error('late failure');
			},
			onDisable: () => {},
		};

		expect(() => enableFeature(feature, api, 'bin/features')).toThrow(
			'late failure'
		);

		expect(raw(root, 'composer.json')).toBe(before);
		expect(fs.existsSync(path.join(root, '.wp-env.override.json'))).toBe(
			false
		);
	});

	it('still backs editPackageJson, which keeps its own indent', () => {
		touch(root, 'package.json', '{\n  "name": "demo"\n}\n');

		api.editPackageJson((pkg) => {
			pkg.scripts = { 'dev:connect': 'claude mcp add wp-dev-tools' };
		});

		expect(readJson(root, 'package.json').scripts['dev:connect']).toBe(
			'claude mcp add wp-dev-tools'
		);
		expect(raw(root, 'package.json')).toContain('\n  "scripts": {');
	});
});

describe('api.note', () => {
	let root;

	beforeEach(() => {
		root = makeRoot();
		touch(root, 'package.json', '{\n\t"name": "demo"\n}\n');
	});

	afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

	const noteFeature = (message) => ({
		key: 'noted',
		label: 'Noted',
		onEnable: (a) => a.note(message),
		onDisable: () => {},
		detect: (a) => a.exists('enabled.flag'),
	});

	it('queues rather than printing during the hook', () => {
		const ui = fakeUi();
		const api = makeFeatureApi(root, IDENTITY, ui);

		enableFeature(noteFeature('run composer install'), api, 'bin/features');

		expect(ui.calls.info).toEqual([]);
		expect(api._notes).toEqual(['run composer install']);
	});

	it('flushes once after the transition and drains the queue', async () => {
		const ui = fakeUi();
		const api = makeFeatureApi(root, IDENTITY, ui);
		const config = { features: [noteFeature('run composer install')] };

		await toggleFeatures(config, root, {
			mode: 'scaffold',
			wantOn: new Set(['noted']),
			flags: { yes: true },
			api,
			ui,
		});

		expect(ui.calls.heading).toContain('Next steps');
		expect(ui.calls.info).toEqual(['run composer install']);
		expect(api._notes).toEqual([]);
	});

	it('drops notes queued by a hook that then threw', () => {
		const api = makeFeatureApi(root, IDENTITY, fakeUi());
		const feature = {
			key: 'boom',
			label: 'Boom',
			onEnable: (a) => {
				a.note('never shown');
				throw new Error('nope');
			},
			onDisable: () => {},
		};

		expect(() => enableFeature(feature, api, 'bin/features')).toThrow(
			'nope'
		);
		expect(api._notes).toEqual([]);
	});

	it('prints no Next steps heading when nothing was noted', async () => {
		const ui = fakeUi();
		const api = makeFeatureApi(root, IDENTITY, ui);
		const config = {
			features: [
				{
					key: 'quiet',
					label: 'Quiet',
					onEnable: () => {},
					onDisable: () => {},
					detect: () => false,
				},
			],
		};

		await toggleFeatures(config, root, {
			mode: 'scaffold',
			wantOn: new Set(['quiet']),
			flags: { yes: true },
			api,
			ui,
		});

		expect(ui.calls.heading).not.toContain('Next steps');
	});
});

describe('npm install hint', () => {
	let root;

	beforeEach(() => {
		root = makeRoot();
		touch(root, 'package.json', '{\n\t"name": "demo"\n}\n');
	});

	afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

	const hintShown = (ui) =>
		ui.calls.warn.some((line) => line.includes('npm install'));

	const run = async (apply) => {
		const ui = fakeUi();
		const api = makeFeatureApi(root, IDENTITY, ui);
		const config = {
			features: [
				{
					key: 'probe',
					label: 'Probe',
					apply,
					detect: (a) => a.hasDep('left-pad'),
				},
			],
		};
		await toggleFeatures(config, root, {
			mode: 'scaffold',
			wantOn: new Set(['probe']),
			flags: { yes: true },
			api,
			ui,
		});
		return ui;
	};

	it('stays quiet for a scripts-only feature', async () => {
		expect(
			hintShown(await run({ scripts: { 'dev:connect': 'noop' } }))
		).toBe(false);
	});

	it('fires when devDependencies change', async () => {
		expect(
			hintShown(await run({ devDependencies: { 'left-pad': '^1' } }))
		).toBe(true);
	});
});

describe('enable / disable / detect round trip', () => {
	let root;

	// A stand-in for the consumer-declared dev-tools entry: committed manifest
	// wiring plus a gitignored local env override, with a composite probe.
	const feature = {
		key: 'probe-tools',
		label: 'Probe Tools',
		apply: { scripts: { 'dev:connect': 'claude mcp add probe' } },
		onEnable: (a) => {
			a.editJson('composer.json', (obj) => {
				obj['require-dev'] = obj['require-dev'] || {};
				obj['require-dev']['acme/probe'] = 'dev-main';
			});
			a.editJson(
				'.env.override.json',
				(obj) => {
					obj.config = { ...(obj.config || {}), PROBE_MODE: true };
				},
				{ create: true, indentFrom: 'composer.json' }
			);
		},
		onDisable: (a) => {
			a.editJson('composer.json', (obj) => {
				delete (obj['require-dev'] || {})['acme/probe'];
			});
			if (!a.exists('.env.override.json')) {
				return;
			}
			// Prune through editJson so the result is written back, then drop
			// the file only if nothing of ours is left holding it up.
			a.editJson('.env.override.json', (obj) => {
				delete (obj.config || {}).PROBE_MODE;
				if (obj.config && !Object.keys(obj.config).length) {
					delete obj.config;
				}
			});
			if (!Object.keys(JSON.parse(a.read('.env.override.json'))).length) {
				a.remove('.env.override.json');
			}
		},
		detect: (a) => {
			const composer = JSON.parse(a.read('composer.json') || '{}');
			const override = JSON.parse(a.read('.env.override.json') || '{}');
			return Boolean(
				(composer['require-dev'] || {})['acme/probe'] &&
				true === (override.config || {}).PROBE_MODE
			);
		},
	};

	beforeEach(() => {
		root = makeRoot();
		touch(root, 'package.json', '{\n\t"name": "demo"\n}\n');
		touch(root, 'composer.json', '{\n\t"name": "acme/demo"\n}\n');
	});

	afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

	it('writes both halves on enable and reads back as detected', () => {
		const api = makeFeatureApi(root, IDENTITY, fakeUi());
		expect(detectFeature(feature, api)).toBe(false);

		enableFeature(feature, api, 'bin/features');

		expect(readJson(root, 'composer.json')['require-dev']).toEqual({
			'acme/probe': 'dev-main',
		});
		expect(readJson(root, '.env.override.json').config.PROBE_MODE).toBe(
			true
		);
		expect(readJson(root, 'package.json').scripts['dev:connect']).toBe(
			'claude mcp add probe'
		);
		expect(detectFeature(feature, api)).toBe(true);
	});

	it('is idempotent on re-enable', () => {
		const api = makeFeatureApi(root, IDENTITY, fakeUi());
		enableFeature(feature, api, 'bin/features');
		const after = raw(root, 'composer.json');

		enableFeature(feature, api, 'bin/features');

		expect(raw(root, 'composer.json')).toBe(after);
	});

	it('leaves no trace on disable', () => {
		const api = makeFeatureApi(root, IDENTITY, fakeUi());
		enableFeature(feature, api, 'bin/features');

		disableFeature(feature, api, []);

		expect(readJson(root, 'composer.json')['require-dev']).toEqual({});
		expect(fs.existsSync(path.join(root, '.env.override.json'))).toBe(
			false
		);
		expect(readJson(root, 'package.json').scripts).toEqual({});
		expect(detectFeature(feature, api)).toBe(false);
	});

	it('keeps unrelated override content on disable', () => {
		const api = makeFeatureApi(root, IDENTITY, fakeUi());
		enableFeature(feature, api, 'bin/features');
		api.editJson('.env.override.json', (obj) => {
			obj.config.MY_OWN_KEY = 'keep me';
		});

		disableFeature(feature, api, []);

		expect(readJson(root, '.env.override.json').config).toEqual({
			MY_OWN_KEY: 'keep me',
		});
	});

	it('reads as disabled when only the committed half is present', () => {
		const api = makeFeatureApi(root, IDENTITY, fakeUi());
		api.editJson('composer.json', (obj) => {
			obj['require-dev'] = { 'acme/probe': 'dev-main' };
		});

		expect(detectFeature(feature, api)).toBe(false);
	});

	it('reads as disabled when only the local half is present', () => {
		const api = makeFeatureApi(root, IDENTITY, fakeUi());
		api.editJson(
			'.env.override.json',
			(obj) => {
				obj.config = { PROBE_MODE: true };
			},
			{ create: true }
		);

		expect(detectFeature(feature, api)).toBe(false);
	});

	it('does not throw probing an empty project', () => {
		const bare = makeRoot();
		try {
			const api = makeFeatureApi(bare, IDENTITY, fakeUi());
			expect(() => detectFeature(feature, api)).not.toThrow();
			expect(detectFeature(feature, api)).toBe(false);
		} finally {
			fs.rmSync(bare, { recursive: true, force: true });
		}
	});
});
