/**
 * Tests for `--list`: the capability reconciler (src/init/capabilities.js) and
 * the run() list flow (setup / manage, the JSON contract, guarded detection,
 * corrupt-identity handling, and usage errors).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const {
	listCapabilities,
	showCapabilities,
} = require('../../src/init/capabilities');
const { run } = require('../../src/init/index');
const { IDENTITY_FILE } = require('../../src/init/persist');
const { makeRoot, touch, capture } = require('./_helpers');

const CONFIG = {
	kind: 'plugin',
	features: [
		{
			key: 'hmr',
			label: 'HMR',
			category: 'Dev',
			defaultOn: true,
			detect: () => true,
		},
		{
			key: 'tailwind',
			label: 'Tailwind',
			category: 'Editor',
			detect: () => false,
		},
		{
			key: 'detected-only',
			label: 'Detected Only',
			category: 'Dev',
			detect: (api) => api.exists('detected-only.flag'),
		},
	],
	examples: {
		groups: [
			{
				key: 'post-types',
				label: 'Post Types',
				category: 'Content',
				marker: 'wp:example:post-types',
				strip: ['inc/Main.php'],
				remove: [
					'inc/Modules/PostTypes.php',
					'inc/Modules/PostTypes',
					'tests/php/PostTypesTest.php',
				],
			},
			{
				key: 'cron',
				label: 'Cron',
				category: 'APIs',
				marker: 'wp:example:cron',
				strip: ['inc/Main.php', 'inc/Core/PluginSetup.php'],
				remove: ['inc/Modules/Cron.php', 'inc/Modules/Cron'],
			},
			{
				key: 'ci-lint-php',
				label: 'CI: PHPCS',
				category: 'Developer Tooling',
				marker: 'wp:ci:ci-lint-php',
				module: null,
				strip: [],
				remove: ['.github/workflows/ci-lint-php.yml'],
			},
			{
				key: 'declared',
				label: 'Declared Module',
				category: 'Other',
				marker: 'wp:example:declared',
				module: 'Custom',
				strip: [],
				remove: ['lib/whatever.php'],
			},
			{
				key: 'dashed',
				label: 'Dashed Module',
				category: 'Other',
				marker: 'wp:example:dashed',
				strip: [],
				remove: ['inc/Modules/my-mod.php'],
			},
			{
				key: 'globonly',
				label: 'Glob Only',
				category: 'Other',
				marker: 'wp:example:globonly',
				strip: [],
				remove: ['src/blocks/example-*'],
			},
		],
	},
};

const byKey = (rows) => Object.fromEntries(rows.map((r) => [r.key, r]));

const writeIdentity = (root, payload) =>
	fs.writeFileSync(path.join(root, IDENTITY_FILE), JSON.stringify(payload));

let root;

beforeEach(() => {
	root = makeRoot('init-list-');
	// Present artifacts; Cron is intentionally left absent (i.e. removed).
	touch(root, 'inc/Modules/PostTypes.php');
	touch(root, '.github/workflows/ci-lint-php.yml');
	touch(root, 'lib/whatever.php');
	touch(root, 'inc/Modules/my-mod.php');
});

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
	// run() sets process.exitCode on usage errors; clear it so a failing-flag
	// test does not leak a non-zero exit code into the Jest process.
	process.exitCode = 0;
});

describe('listCapabilities (no identity: detection only)', () => {
	it('detects present/removed from the first concrete remove path', () => {
		const caps = byKey(listCapabilities(CONFIG, root));
		expect(caps['post-types']).toMatchObject({
			present: true,
			detected: true,
			intent: null,
			drift: false,
		});
		expect(caps.cron).toMatchObject({ present: false, detected: false });
	});

	it('reports unknown detection (glob-only group) as present', () => {
		const caps = byKey(listCapabilities(CONFIG, root));
		expect(caps.globonly).toMatchObject({
			present: true,
			detected: null,
			intent: null,
			drift: false,
		});
	});

	it('prefers a config-declared module and falls back to the artifact', () => {
		const caps = byKey(listCapabilities(CONFIG, root));
		expect(caps.declared.module).toBe('Custom');
		expect(caps['ci-lint-php'].module).toBeNull(); // declared null
		expect(caps['post-types'].module).toBe('PostTypes'); // fallback
		expect(caps.dashed.module).toBe('my-mod'); // dashed fallback
	});

	it('returns [] when no examples are declared', () => {
		expect(listCapabilities({ kind: 'plugin' }, root)).toEqual([]);
	});
});

describe('listCapabilities (identity record: reconcile)', () => {
	const identity = (removed) => ({ name: 'X', examples: { removed } });

	it('agreement: recorded removal + missing artifact -> removed, no drift', () => {
		const caps = byKey(listCapabilities(CONFIG, root, identity(['cron'])));
		expect(caps.cron).toMatchObject({
			present: false,
			detected: false,
			intent: false,
			drift: false,
		});
		expect(caps['post-types']).toMatchObject({
			present: true,
			intent: true,
			drift: false,
		});
	});

	it('manual removal after setup -> present false + drift', () => {
		fs.rmSync(path.join(root, 'inc/Modules/PostTypes.php'));
		const caps = byKey(listCapabilities(CONFIG, root, identity([])));
		expect(caps['post-types']).toMatchObject({
			present: false,
			detected: false,
			intent: true,
			drift: true,
		});
	});

	it('glob-only group follows recorded intent (no detection to lie)', () => {
		const caps = byKey(
			listCapabilities(CONFIG, root, identity(['globonly']))
		);
		expect(caps.globonly).toMatchObject({
			present: false,
			detected: null,
			intent: false,
			drift: false,
		});
	});

	it('legacy identity (no examples key) -> intent null, detection only', () => {
		const caps = byKey(listCapabilities(CONFIG, root, { name: 'X' }));
		expect(caps['post-types']).toMatchObject({
			present: true,
			intent: null,
			drift: false,
		});
	});
});

describe('showCapabilities', () => {
	const fakeUi = () => {
		const calls = { table: [], info: [] };
		return {
			ui: {
				table: (rows, opts) => calls.table.push({ rows, opts }),
				info: (msg) => calls.info.push(msg),
			},
			calls,
		};
	};

	it('renders a Capabilities table', () => {
		const { ui, calls } = fakeUi();
		showCapabilities(listCapabilities(CONFIG, root), ui, { mode: 'setup' });
		expect(calls.table).toHaveLength(1);
		expect(calls.table[0].opts).toEqual({ title: 'Capabilities' });
	});

	it('marks drifted rows in the table', () => {
		fs.rmSync(path.join(root, 'inc/Modules/PostTypes.php'));
		const { ui, calls } = fakeUi();
		showCapabilities(
			listCapabilities(CONFIG, root, { examples: { removed: [] } }),
			ui,
			{ mode: 'manage' }
		);
		const row = calls.table[0].rows.find(
			([label]) => 'Post Types' === label
		);
		expect(row[1]).toMatch(/removed\s+\(drift\)/);
	});

	it('shows the empty message when there are no capabilities', () => {
		const { ui, calls } = fakeUi();
		showCapabilities([], ui, {});
		expect(calls.table).toHaveLength(0);
		expect(calls.info).toHaveLength(1);
	});

	it('adds an npx re-add hint in manage mode when a capability is removed', () => {
		const { ui, calls } = fakeUi();
		showCapabilities(listCapabilities(CONFIG, root), ui, {
			mode: 'manage',
		});
		expect(calls.info.some((m) => /npx wp-tooling add/.test(m))).toBe(true);
	});
});

describe('run --list (JSON contract)', () => {
	it('setup mode: one stdout line, empty stderr, exit 0', async () => {
		const { stdout, stderr } = await capture(() =>
			run(CONFIG, { root, argv: ['--list', '--json'] })
		);
		expect(process.exitCode || 0).toBe(0);
		expect(stderr).toBe('');
		const lines = stdout.trim().split('\n');
		expect(lines).toHaveLength(1);
		const payload = JSON.parse(lines[0]);
		expect(payload.mode).toBe('setup');
		expect(payload.warnings).toEqual([]);
	});

	it('setup mode: capabilities carry only the documented keys', async () => {
		const { stdout } = await capture(() =>
			run(CONFIG, { root, argv: ['--list', '--json'] })
		);
		const payload = JSON.parse(stdout.trim());
		for (const cap of payload.capabilities) {
			expect(Object.keys(cap).sort()).toEqual([
				'category',
				'key',
				'label',
				'module',
				'present',
			]);
		}
	});

	it('setup mode: `on` is the non-interactive default (defaultOn || detected)', async () => {
		touch(root, 'detected-only.flag');
		const { stdout } = await capture(() =>
			run(CONFIG, { root, argv: ['--list', '--json'] })
		);
		const features = byKey(JSON.parse(stdout.trim()).features);
		expect(features.hmr.on).toBe(true); // defaultOn
		expect(features.tailwind.on).toBe(false); // detected false
		expect(features['detected-only'].on).toBe(true); // detected true
		expect(features.hmr.intent).toBeUndefined();
		expect(features.hmr.drift).toBeUndefined();
	});

	it('manage mode: reconciled capabilities + feature intent/drift', async () => {
		writeIdentity(root, {
			name: 'X',
			examples: { removed: ['cron', 'globonly'] },
			features: { hmr: true, tailwind: true, retired: true },
		});
		const { stdout, stderr } = await capture(() =>
			run(CONFIG, { root, argv: ['--list', '--json'] })
		);
		expect(stderr).toBe('');
		const payload = JSON.parse(stdout.trim());
		expect(payload.mode).toBe('manage');

		const caps = byKey(payload.capabilities);
		expect(caps.cron).toMatchObject({
			present: false,
			intent: false,
			drift: false,
		});
		expect(caps.globonly).toMatchObject({ present: false, intent: false });
		expect(caps['post-types']).toMatchObject({
			present: true,
			intent: true,
		});

		const features = byKey(payload.features);
		expect(features.hmr).toMatchObject({
			on: true,
			intent: true,
			drift: false,
		});
		// Persisted true but detect() says false -> drift.
		expect(features.tailwind).toMatchObject({
			on: false,
			intent: true,
			drift: true,
		});
		expect(payload.warnings.some((w) => /retired/.test(w))).toBe(true);
	});

	it('manage mode: legacy identity gets an unrecorded-selection warning', async () => {
		writeIdentity(root, { name: 'X', features: {} });
		const { stdout } = await capture(() =>
			run(CONFIG, { root, argv: ['--list', '--json'] })
		);
		const payload = JSON.parse(stdout.trim());
		expect(payload.warnings.some((w) => /was not recorded/.test(w))).toBe(
			true
		);
		expect(byKey(payload.capabilities)['post-types'].intent).toBeNull();
	});

	it('a throwing detect probe degrades to on:null + warning, exit 0', async () => {
		const throwConfig = {
			...CONFIG,
			features: [
				...CONFIG.features,
				{
					key: 'exploding',
					label: 'Exploding',
					detect: () => {
						throw new Error('boom');
					},
				},
			],
		};
		const { stdout, stderr } = await capture(() =>
			run(throwConfig, { root, argv: ['--list', '--json'] })
		);
		expect(process.exitCode || 0).toBe(0);
		expect(stderr).toBe('');
		const payload = JSON.parse(stdout.trim());
		expect(byKey(payload.features).exploding.on).toBeNull();
		expect(
			payload.warnings.some((w) =>
				/exploding: feature detect failed: boom/.test(w)
			)
		).toBe(true);
	});
});

describe('run --list (usage + failure contract)', () => {
	it('--json without --list is a usage error on stderr, exit 1', async () => {
		const { stdout, stderr } = await capture(() =>
			run(CONFIG, { root, argv: ['--json'] })
		);
		expect(stdout).toBe('');
		expect(JSON.parse(stderr.trim()).code).toBe('EUSAGE');
		expect(process.exitCode).toBe(1);
	});

	it('rejects --list combined with a mutating flag, exit 1', async () => {
		const { stderr } = await capture(() =>
			run(CONFIG, { root, argv: ['--list', '--json', '--features=x'] })
		);
		expect(JSON.parse(stderr.trim()).message).toMatch(/--features=x/);
		expect(process.exitCode).toBe(1);
	});

	it('rejects --list --manage rather than silently choosing setup', async () => {
		const { stderr } = await capture(() =>
			run(CONFIG, { root, argv: ['--list', '--manage', '--json'] })
		);
		expect(JSON.parse(stderr.trim()).message).toMatch(/--manage/);
		expect(process.exitCode).toBe(1);
	});

	it('rejects --list --clean', async () => {
		const { stderr } = await capture(() =>
			run(CONFIG, { root, argv: ['--list', '--json', '--clean'] })
		);
		expect(JSON.parse(stderr.trim()).code).toBe('EUSAGE');
		expect(process.exitCode).toBe(1);
	});

	it('accepts (and ignores) --yes alongside --list', async () => {
		const { stdout, stderr } = await capture(() =>
			run(CONFIG, { root, argv: ['--list', '--json', '--yes'] })
		);
		expect(stderr).toBe('');
		expect(JSON.parse(stdout.trim()).mode).toBe('setup');
		expect(process.exitCode || 0).toBe(0);
	});

	it('--list --reinit on an initialized project reports setup mode', async () => {
		writeIdentity(root, { name: 'X', features: {} });
		const { stdout } = await capture(() =>
			run(CONFIG, { root, argv: ['--list', '--json', '--reinit'] })
		);
		expect(JSON.parse(stdout.trim()).mode).toBe('setup');
	});

	it('a broken feature manifest answers ECONFIG in JSON', async () => {
		const broken = {
			...CONFIG,
			features: [
				{ key: 'dup', label: 'A', detect: () => true },
				{ key: 'dup', label: 'B', detect: () => true },
			],
		};
		const { stdout, stderr } = await capture(() =>
			run(broken, { root, argv: ['--list', '--json'] })
		);
		expect(stdout).toBe('');
		const err = JSON.parse(stderr.trim());
		expect(err.code).toBe('ECONFIG');
		expect(err.message).toMatch(/Duplicate feature key/);
		expect(process.exitCode).toBe(1);
	});

	it('corrupt identity answers EIDENTITYCORRUPT in JSON', async () => {
		fs.writeFileSync(path.join(root, IDENTITY_FILE), '{broken');
		const { stdout, stderr } = await capture(() =>
			run(CONFIG, { root, argv: ['--list', '--json'] })
		);
		expect(stdout).toBe('');
		const err = JSON.parse(stderr.trim());
		expect(err.code).toBe('EIDENTITYCORRUPT');
		expect(err.path).toBe(path.join(root, IDENTITY_FILE));
		expect(process.exitCode).toBe(1);
	});

	it('corrupt identity + human --list errors without JSON noise', async () => {
		fs.writeFileSync(path.join(root, IDENTITY_FILE), '{broken');
		const { stdout, stderr } = await capture(() =>
			run(CONFIG, { root, argv: ['--list'] })
		);
		expect(stderr).toBe('');
		expect(stdout).toMatch(/not valid JSON/);
		expect(process.exitCode).toBe(1);
	});

	it('corrupt identity + --reinit lists setup mode with a warning', async () => {
		fs.writeFileSync(path.join(root, IDENTITY_FILE), '{broken');
		const { stdout, stderr } = await capture(() =>
			run(CONFIG, { root, argv: ['--list', '--json', '--reinit'] })
		);
		expect(stderr).toBe('');
		const payload = JSON.parse(stdout.trim());
		expect(payload.mode).toBe('setup');
		expect(
			payload.warnings.some((w) => /--reinit will overwrite/.test(w))
		).toBe(true);
		expect(process.exitCode || 0).toBe(0);
	});

	it('a filesystem read error (not corruption) + --list --reinit is not discarded', async () => {
		writeIdentity(root, { name: 'X', features: {} });
		const identityPath = path.join(root, IDENTITY_FILE);
		const original = fs.readFileSync.bind(fs);
		const spy = jest
			.spyOn(fs, 'readFileSync')
			.mockImplementation((filePath, ...rest) => {
				if (filePath === identityPath) {
					const err = new Error('EACCES: permission denied');
					err.code = 'EACCES';
					throw err;
				}
				return original(filePath, ...rest);
			});
		let stdout, stderr;
		try {
			({ stdout, stderr } = await capture(() =>
				run(CONFIG, { root, argv: ['--list', '--json', '--reinit'] })
			));
		} finally {
			spy.mockRestore();
		}
		expect(stdout).toBe('');
		const err = JSON.parse(stderr.trim());
		expect(err.code).toBe('EACCES');
		expect(process.exitCode).toBe(1);
	});
});

describe('run --list (human output)', () => {
	it('renders heading + both tables on stdout, stderr stays empty', async () => {
		const { stdout, stderr } = await capture(() =>
			run(CONFIG, { root, argv: ['--list'] })
		);
		expect(stderr).toBe('');
		expect(stdout).toMatch(/available capabilities/);
		expect(stdout).toMatch(/Capabilities/);
		expect(stdout).toMatch(/Feature status/);
		expect(stdout).toMatch(/Post Types/);
		expect(process.exitCode || 0).toBe(0);
	});
});

describe('run (non-list) corrupt identity', () => {
	it('refuses to fall through to setup mode', async () => {
		fs.writeFileSync(path.join(root, IDENTITY_FILE), '{broken');
		const { stdout } = await capture(() => run(CONFIG, { root, argv: [] }));
		expect(stdout).toMatch(/not valid JSON/);
		expect(process.exitCode).toBe(1);
		// Nothing rewrote the file: setup never ran.
		expect(fs.readFileSync(path.join(root, IDENTITY_FILE), 'utf8')).toBe(
			'{broken'
		);
	});

	it('a filesystem read error (not corruption) + --reinit is not discarded', async () => {
		writeIdentity(root, { name: 'X', features: {} });
		const identityPath = path.join(root, IDENTITY_FILE);
		const original = fs.readFileSync.bind(fs);
		const spy = jest
			.spyOn(fs, 'readFileSync')
			.mockImplementation((filePath, ...rest) => {
				if (filePath === identityPath) {
					const err = new Error('EACCES: permission denied');
					err.code = 'EACCES';
					throw err;
				}
				return original(filePath, ...rest);
			});
		let stdout;
		try {
			({ stdout } = await capture(() =>
				run(CONFIG, { root, argv: ['--reinit'] })
			));
		} finally {
			spy.mockRestore();
		}
		expect(stdout).toMatch(/EACCES/);
		expect(process.exitCode).toBe(1);
		// --reinit did not treat this as discardable corruption: the identity
		// file is untouched, setup never ran.
		expect(JSON.parse(fs.readFileSync(identityPath, 'utf8'))).toEqual({
			name: 'X',
			features: {},
		});
	});
});

describe('setup records the capability selection', () => {
	const FULL_CONFIG = {
		...CONFIG,
		source: { name: 'Project Name' },
	};

	it('persists examples.removed, which --list then reconciles', async () => {
		await capture(() =>
			run(FULL_CONFIG, {
				root,
				argv: [
					'--yes',
					'--name=Acme Blog',
					'--remove-examples=cron,globonly',
				],
			})
		);
		expect(process.exitCode || 0).toBe(0);

		const identity = JSON.parse(
			fs.readFileSync(path.join(root, IDENTITY_FILE), 'utf8')
		);
		expect(identity.examples).toEqual({ removed: ['cron', 'globonly'] });

		const { stdout } = await capture(() =>
			run(FULL_CONFIG, { root, argv: ['--list', '--json'] })
		);
		const payload = JSON.parse(stdout.trim());
		expect(payload.mode).toBe('manage');
		const caps = byKey(payload.capabilities);
		expect(caps.globonly).toMatchObject({ present: false, intent: false });
		expect(caps['post-types']).toMatchObject({
			present: true,
			intent: true,
			drift: false,
		});
	});
});
