/**
 * Manage mode driven by flags, the way CI and AI callers run it
 * (`npm run init -- --enable=tailwind --yes`), plus the read-only status view.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const {
	manageFlow,
	parseManageFlags,
	showStatus,
} = require('../../src/init/manage');
const { identityFromName } = require('../../src/init/identity');
const { makeRoot, touch } = require('./_helpers');

const makeUi = () => ({
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
});

/**
 * A feature whose state is a marker file, so tests can see it flip.
 *
 * @param {string} key - Feature key.
 * @return {Object} Feature declaration.
 */
const markerFeature = (key) => ({
	key,
	label: key.toUpperCase(),
	description: `The ${key} feature.`,
	detect: (api) => api.exists(`${key}.flag`),
	onEnable: (api) => api.write(`${key}.flag`, 'on'),
	onDisable: (api) => api.remove(`${key}.flag`),
});

const CONFIG = {
	kind: 'theme',
	features: [markerFeature('alpha'), markerFeature('beta')],
};

let root;
let identity;
let ui;

beforeEach(() => {
	root = makeRoot('manage-flags-');
	identity = {
		...identityFromName('Acme Blog', CONFIG),
		version: '1.0.0',
		features: { alpha: false, beta: false },
	};
	touch(root, '.wp-scaffold.json', JSON.stringify(identity));
	ui = makeUi();
});

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
	process.exitCode = 0;
});

const persisted = () =>
	JSON.parse(fs.readFileSync(path.join(root, '.wp-scaffold.json'), 'utf8'))
		.features;

describe('parseManageFlags', () => {
	test('reads --yes/-y, list flags and the --manage marker', () => {
		expect(
			parseManageFlags([
				'-y',
				'--manage',
				'--features=alpha, beta',
				'--enable=alpha',
				'--disable=beta',
			])
		).toEqual({
			flags: {
				yes: true,
				features: ['alpha', 'beta'],
				enable: ['alpha'],
				disable: ['beta'],
			},
			unknown: [],
		});
	});

	test('collects anything else as unknown', () => {
		expect(parseManageFlags(['--yes', '--wat']).unknown).toEqual(['--wat']);
	});
});

describe('manageFlow with flags', () => {
	test('--enable turns a feature on and records it', async () => {
		await manageFlow(
			CONFIG,
			root,
			['--enable=alpha', '--yes'],
			identity,
			ui,
			jest.fn()
		);

		expect(fs.existsSync(path.join(root, 'alpha.flag'))).toBe(true);
		expect(fs.existsSync(path.join(root, 'beta.flag'))).toBe(false);
		expect(persisted()).toMatchObject({ alpha: true, beta: false });
		expect(ui.radio).not.toHaveBeenCalled();
	});

	test('--features sets the exact set, turning off what it leaves out', async () => {
		touch(root, 'alpha.flag', 'on');
		await manageFlow(
			CONFIG,
			root,
			['--features=beta', '--yes'],
			{ ...identity, features: { alpha: true, beta: false } },
			ui,
			jest.fn()
		);

		expect(fs.existsSync(path.join(root, 'alpha.flag'))).toBe(false);
		expect(fs.existsSync(path.join(root, 'beta.flag'))).toBe(true);
		expect(persisted()).toMatchObject({ alpha: false, beta: true });
	});

	test('--disable turns an enabled feature off', async () => {
		touch(root, 'beta.flag', 'on');
		await manageFlow(
			CONFIG,
			root,
			['--disable=beta', '--yes'],
			{ ...identity, features: { alpha: false, beta: true } },
			ui,
			jest.fn()
		);

		expect(fs.existsSync(path.join(root, 'beta.flag'))).toBe(false);
		expect(persisted()).toMatchObject({ beta: false });
	});

	test('--yes alone is refused with exit code 1, changing nothing', async () => {
		await manageFlow(CONFIG, root, ['--yes'], identity, ui, jest.fn());

		expect(ui.error).toHaveBeenCalledWith(
			'--yes in manage mode requires --features / --enable / --disable.'
		);
		expect(process.exitCode).toBe(1);
		expect(fs.existsSync(path.join(root, 'alpha.flag'))).toBe(false);
	});

	test('an undeclared feature key is rejected before anything runs', async () => {
		await expect(
			manageFlow(
				CONFIG,
				root,
				['--enable=gamma', '--yes'],
				identity,
				ui,
				jest.fn()
			)
		).rejects.toThrow(/gamma/);
		expect(fs.existsSync(path.join(root, 'alpha.flag'))).toBe(false);
	});
});

describe('showStatus', () => {
	test('says so when no optional features are declared', () => {
		showStatus([], [], ui);
		expect(ui.info).toHaveBeenCalledWith(
			'No optional features are declared for this project.'
		);
		expect(ui.table).not.toHaveBeenCalled();
	});

	test('labels each state, flags drift, prints descriptions and retired keys', () => {
		showStatus(
			[
				{
					key: 'a',
					label: 'A',
					on: true,
					drift: false,
					description: 'First.',
				},
				{ key: 'b', label: 'B', on: false, drift: true },
				{ key: 'c', label: 'C', on: null, drift: false },
			],
			['legacy'],
			ui
		);

		expect(ui.table).toHaveBeenCalledWith(
			[
				['A', 'enabled'],
				['B', 'disabled  (drift)'],
				['C', 'unknown'],
			],
			{ title: 'Feature status' }
		);
		expect(ui.info).toHaveBeenCalledWith('A: First.');
		expect(ui.warn).toHaveBeenCalledWith(
			'legacy: recorded in .wp-scaffold.json but no longer declared.'
		);
	});
});
