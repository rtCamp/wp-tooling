/**
 * Tests for src/init/manage.js -- the unknown-argument branch that must tell
 * a purely scaffold-only flag set apart from a genuinely invalid one.
 */

'use strict';

const { manageFlow } = require('../../src/init/manage');
const fs = require('fs');
const path = require('path');
const { makeRoot, touch } = require('./_helpers');
const { identityFromName } = require('../../src/init/identity');

afterEach(() => {
	// manageFlow sets process.exitCode as a side effect on these paths.
	process.exitCode = 0;
});

const makeUi = () => {
	const calls = { error: [], info: [] };
	return {
		ui: {
			error: (msg) => calls.error.push(msg),
			info: (msg) => calls.info.push(msg),
		},
		calls,
	};
};

describe('manageFlow unknown-argument handling', () => {
	it('explains setup-mode when every unknown arg is scaffold-only', async () => {
		const { ui, calls } = makeUi();
		await manageFlow({}, '/root', ['--name=X'], {}, ui, async () => {});
		expect(calls.error).toHaveLength(0);
		expect(calls.info).toHaveLength(1);
		expect(calls.info[0]).toMatch(/apply only during first-time setup/);
	});

	it('reports the generic error when a scaffold-only flag is mixed with a genuinely unknown one', async () => {
		const { ui, calls } = makeUi();
		await manageFlow(
			{},
			'/root',
			['--name=X', '--bogus'],
			{},
			ui,
			async () => {}
		);
		expect(calls.info).toHaveLength(0);
		expect(calls.error).toEqual(['Unknown argument(s): --name=X --bogus']);
	});
});

describe('interactive manage session', () => {
	let root;
	let identity;
	let ui;
	const config = { kind: 'theme' };
	beforeEach(() => {
		root = makeRoot();
		identity = {
			...identityFromName('Acme Blog', config),
			version: '1.0.0',
			features: { demo: false },
		};
		touch(root, '.wp-scaffold.json', JSON.stringify(identity));
		ui = {
			radio: jest.fn(),
			text: jest.fn(),
			confirm: jest.fn(async () => true),
			table: jest.fn(),
			info: jest.fn(),
			warn: jest.fn(),
			success: jest.fn(),
			error: jest.fn(),
			heading: jest.fn(),
			spinner: () => ({ start() {}, succeed() {}, fail() {} }),
		};
	});
	afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

	test('editing details refreshes the identity used by subsequent feature hooks', async () => {
		const feature = {
			key: 'demo',
			label: 'Demo',
			detect: (api) => api.exists(`${api.identity.slug}.flag`),
			onEnable: (api) =>
				api.write(`${api.identity.slug}.flag`, api.identity.name),
			onDisable: (api) => api.remove(`${api.identity.slug}.flag`),
		};
		for (const choice of [
			'Edit project details',
			'Name',
			'Confirm',
			'Toggle features',
			'[ ] Demo',
			'Apply changes',
			'Show status',
			'Exit',
		]) {
			ui.radio.mockResolvedValueOnce(choice);
		}
		ui.text.mockResolvedValueOnce('Cedar Blog');
		await manageFlow(
			{ ...config, features: [feature] },
			root,
			[],
			identity,
			ui,
			jest.fn()
		);
		expect(
			fs.readFileSync(path.join(root, 'cedar-blog.flag'), 'utf8')
		).toBe('Cedar Blog');
		expect(
			JSON.parse(fs.readFileSync(path.join(root, '.wp-scaffold.json')))
		).toMatchObject({ name: 'Cedar Blog', features: { demo: true } });
		expect(ui.table).toHaveBeenLastCalledWith([['Demo', 'enabled']], {
			title: 'Feature status',
		});
		expect(ui.radio).toHaveBeenCalledTimes(8);
	});

	test('a failed interactive toggle exits the session without requesting another action', async () => {
		for (const choice of ['Toggle features', '[ ] Demo', 'Apply changes']) {
			ui.radio.mockResolvedValueOnce(choice);
		}
		const feature = {
			key: 'demo',
			label: 'Demo',
			detect: () => false,
			onEnable() {
				throw new Error('failed hook');
			},
			onDisable() {},
		};
		await manageFlow(
			{ ...config, features: [feature] },
			root,
			[],
			identity,
			ui,
			jest.fn()
		);
		expect(ui.radio).toHaveBeenCalledTimes(3);
		expect(process.exitCode).toBe(1);
		expect(
			JSON.parse(fs.readFileSync(path.join(root, '.wp-scaffold.json')))
				.features.demo
		).toBe(false);
	});

	test('re-run full setup invokes the callback once and leaves the menu', async () => {
		const reinit = jest.fn();
		ui.radio.mockResolvedValueOnce('Re-run full setup');
		await manageFlow(config, root, [], identity, ui, reinit);
		expect(reinit).toHaveBeenCalledTimes(1);
		expect(ui.radio).toHaveBeenCalledTimes(1);
	});
});
