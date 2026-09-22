/**
 * Tests for the identity engine -- name validation, case-variant derivation, and
 * the search-replace pair builder that drives the project rename.
 */
'use strict';

const {
	generateIdentity,
	identityFromName,
	validateName,
	buildIdentityReplacements,
} = require('../../src/init/identity');
const fs = require('fs');
const path = require('path');
const { makeRoot, touch } = require('./_helpers');
const {
	applyIdentityEdit,
	editIdentityFields,
	editDetailsFlow,
} = require('../../src/init/identity');

const CONFIG = {
	vendor: 'rtcamp',
	namespace: (id) => `${id.pascalSnake}\\Features`,
	package: (id) => `rtcamp/${id.kebab}-features`,
};

describe('validateName', () => {
	it('accepts a normal multi-word name', () => {
		expect(validateName('My Test Plugin')).toBeUndefined();
		expect(validateName('my-plugin')).toBeUndefined();
	});

	it('rejects an empty name', () => {
		expect(validateName('  ')).toMatch(/required/i);
	});

	it('rejects a name starting with a digit', () => {
		expect(validateName('1plugin')).toMatch(/start with a letter/i);
	});

	it('rejects a PHP reserved keyword', () => {
		expect(validateName('class')).toMatch(/reserved/i);
	});
});

describe('generateIdentity', () => {
	it('derives every case variant and WP convention from a name', () => {
		const id = generateIdentity('My Test Plugin');
		expect(id.kebab).toBe('my-test-plugin');
		expect(id.snake).toBe('my_test_plugin');
		expect(id.pascalSnake).toBe('My_Test_Plugin');
		expect(id.macro).toBe('MY_TEST_PLUGIN');
		expect(id.functionPrefix).toBe('my_test_plugin_');
		expect(id.constantPrefix).toBe('MY_TEST_PLUGIN');
		expect(id.cssPrefix).toBe('my-test-plugin-');
		expect(id.package).toBe('rtcamp/my-test-plugin');
	});

	it('splits acronym boundaries', () => {
		expect(generateIdentity('WPGraphQL').kebab).toBe('wp-graph-ql');
	});
});

describe('buildIdentityReplacements', () => {
	const oldId = identityFromName('Project Name', CONFIG);
	const newId = identityFromName('My Plugin', CONFIG);
	const pairs = buildIdentityReplacements(oldId, newId);
	const has = (from, to) => pairs.some(([f, t]) => f === from && t === to);

	it('covers the key case variants and prefixes', () => {
		expect(has('Project_Name', 'My_Plugin')).toBe(true);
		expect(has('project-name', 'my-plugin')).toBe(true);
		expect(has('PROJECT_NAME', 'MY_PLUGIN')).toBe(true);
	});

	it('covers the namespace in single- and double-backslash forms', () => {
		expect(has('Project_Name\\Features', 'My_Plugin\\Features')).toBe(true);
		expect(has('Project_Name\\\\Features', 'My_Plugin\\\\Features')).toBe(
			true
		);
	});

	it('is de-duplicated by source token', () => {
		const froms = pairs.map(([from]) => from);
		expect(new Set(froms).size).toBe(froms.length);
	});

	it('is sorted longest-source-first so specific tokens win', () => {
		for (let i = 1; i < pairs.length; i++) {
			expect(pairs[i - 1][0].length).toBeGreaterThanOrEqual(
				pairs[i][0].length
			);
		}
	});
});

describe('applyIdentityEdit', () => {
	let root;
	const ui = { info: jest.fn(), success: jest.fn() };
	beforeEach(() => {
		root = makeRoot();
	});
	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
		jest.restoreAllMocks();
	});

	test.each(['replace', 'rename', 'version', 'persist'])(
		'%s failure restores identity contents, filenames and permissions',
		(stage) => {
			const config = {
				versionFiles: [{ path: 'package.json', kind: 'json' }],
			};
			const oldId = {
				...identityFromName('Acme Blog', config),
				version: '1.0.0',
				custom: 'Acme Blog',
			};
			const newId = {
				...identityFromName('Cedar Blog', config),
				version: '2.0.0',
			};
			touch(root, '.wp-scaffold.json', JSON.stringify(oldId));
			touch(root, 'a-acme-blog.txt', 'Acme Blog first');
			touch(root, 'b-acme-blog.txt', 'Acme Blog second');
			touch(
				root,
				'package.json',
				'{"name":"acme-blog","version":"1.0.0"}'
			);
			fs.chmodSync(path.join(root, 'a-acme-blog.txt'), 0o755);
			const snapshot = () =>
				Object.fromEntries(
					fs
						.readdirSync(root)
						.sort()
						.map((file) => [
							file,
							{
								body: fs.readFileSync(path.join(root, file)),
								mode: fs.statSync(path.join(root, file)).mode,
							},
						])
				);
			const before = snapshot();
			const write = fs.writeFileSync;
			const rename = fs.renameSync;
			let failed = false;
			jest.spyOn(fs, 'writeFileSync').mockImplementation(
				(file, body, ...args) => {
					const basename = path.basename(file);
					const shouldFail =
						(stage === 'replace' &&
							basename === 'b-acme-blog.txt') ||
						(stage === 'version' &&
							basename === 'package.json' &&
							String(body).includes('2.0.0')) ||
						(stage === 'persist' &&
							basename === '.wp-scaffold.json');
					if (!failed && shouldFail) {
						failed = true;
						write(file, 'partial write');
						throw new Error(`${stage} failed`);
					}
					return write(file, body, ...args);
				}
			);
			jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
				if (
					!failed &&
					stage === 'rename' &&
					path.basename(from) === 'b-acme-blog.txt'
				) {
					failed = true;
					throw new Error('rename failed');
				}
				return rename(from, to);
			});
			expect(() =>
				applyIdentityEdit(config, root, oldId, newId, ui)
			).toThrow(`${stage} failed`);
			expect(failed).toBe(true);
			expect(snapshot()).toEqual(before);
		}
	);

	test('successful identity rename preserves unrelated persisted metadata', () => {
		const oldId = {
			...identityFromName('Acme Blog', {}),
			version: '1.0.0',
			custom: 'Acme Blog',
			features: { 'acme-blog': true },
		};
		const newId = {
			...identityFromName('Cedar Blog', {}),
			version: '1.0.0',
		};
		touch(root, '.wp-scaffold.json', JSON.stringify(oldId));
		touch(root, 'acme-blog.txt', 'Acme Blog');
		expect(applyIdentityEdit({}, root, oldId, newId, ui)).toBe(true);
		expect(fs.readFileSync(path.join(root, 'cedar-blog.txt'), 'utf8')).toBe(
			'Cedar Blog'
		);
		expect(
			JSON.parse(fs.readFileSync(path.join(root, '.wp-scaffold.json')))
		).toMatchObject({
			...newId,
			custom: 'Acme Blog',
			features: { 'acme-blog': true },
		});
	});

	test('version-only edit updates files and persisted identity', () => {
		const config = {
			kind: 'theme',
			versionFiles: [{ path: 'package.json', kind: 'json' }],
		};
		const identity = {
			...identityFromName('Acme Blog', config),
			version: '1.0.0',
			custom: true,
		};
		touch(root, 'package.json', '{"version":"1.0.0"}');
		touch(root, '.wp-scaffold.json', JSON.stringify(identity));
		expect(
			applyIdentityEdit(
				config,
				root,
				identity,
				{ ...identity, version: '2.0.0' },
				ui
			)
		).toBe(true);
		expect(
			JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version
		).toBe('2.0.0');
		expect(
			JSON.parse(fs.readFileSync(path.join(root, '.wp-scaffold.json')))
		).toMatchObject({ version: '2.0.0', custom: true });
	});
});

describe('interactive identity editor', () => {
	const config = { kind: 'theme' };
	const original = {
		...identityFromName('Acme Blog', config),
		version: '1.0.0',
	};
	const makeUi = (choices, values = []) => ({
		radio: jest.fn(async () => choices.shift()),
		text: jest.fn(async () => values.shift()),
		table: jest.fn(),
		confirm: jest.fn(async () => false),
		warn: jest.fn(),
		info: jest.fn(),
		heading: jest.fn(),
	});
	test('name edits rederive defaults while retaining explicit overrides and version', async () => {
		const ui = makeUi(
			['Text Domain', 'Version', 'Name', 'Confirm'],
			['custom-domain', '2.0.0', 'Cedar Blog']
		);
		const result = await editIdentityFields(config, original, ui);
		expect(result.confirmed).toBe(true);
		expect(result.id).toMatchObject({
			name: 'Cedar Blog',
			textDomain: 'custom-domain',
			slug: 'custom-domain',
			functionPrefix: 'cedar_blog_',
			version: '2.0.0',
		});
		expect(original.textDomain).toBe('acme-blog');
	});
	test.each([
		['cancel the editor', ['Name', 'Cancel'], ['Cedar Blog']],
		['confirm without edits', ['Confirm'], []],
		['decline application', ['Version', 'Confirm'], ['2.0.0']],
	])('%s leaves the project untouched', async (_label, choices, values) => {
		const root = makeRoot();
		try {
			const before = JSON.stringify(original);
			touch(root, '.wp-scaffold.json', before);
			touch(root, 'acme-blog.txt', 'Acme Blog');
			await editDetailsFlow(
				config,
				root,
				original,
				makeUi([...choices], [...values])
			);
			expect(
				fs.readFileSync(path.join(root, '.wp-scaffold.json'), 'utf8')
			).toBe(before);
			expect(
				fs.readFileSync(path.join(root, 'acme-blog.txt'), 'utf8')
			).toBe('Acme Blog');
			expect(fs.readdirSync(root).sort()).toEqual([
				'.wp-scaffold.json',
				'acme-blog.txt',
			]);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
