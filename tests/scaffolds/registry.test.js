'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { ScaffoldRegistry } = require('../../src/scaffolds/registry');

const FIXTURES = path.join(__dirname, 'fixtures');
const FIXTURES_MALFORMED = path.join(__dirname, 'fixtures-malformed');

/**
 * Create a temp directory and clean it up after each test.
 *
 * @param {Function} register `afterEach` style cleanup register.
 * @return {string} Absolute path to the temp directory.
 */
function tmpDir(register) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffolds-test-'));
	register(() => fs.rmSync(dir, { recursive: true, force: true }));
	return dir;
}

describe('ScaffoldRegistry.scan()', () => {
	let cleanups;
	let stderrSpy;
	let stderrChunks;

	beforeEach(() => {
		cleanups = [];
		stderrChunks = [];
		stderrSpy = jest
			.spyOn(process.stderr, 'write')
			.mockImplementation((chunk) => {
				stderrChunks.push(chunk.toString());
				return true;
			});
	});

	afterEach(() => {
		for (const fn of cleanups) {
			fn();
		}
		stderrSpy.mockRestore();
	});

	test('discovers scaffolds at any depth and populates by slug', async () => {
		const r = new ScaffoldRegistry(FIXTURES);
		const all = await r.scan();
		expect(all).toHaveLength(3);
		const slugs = all.map((s) => s.slug).sort();
		expect(slugs).toEqual(['algolia', 'block-dynamic', 'cache']);
	});

	test('returns an empty array for a missing directory', async () => {
		const r = new ScaffoldRegistry('/does/not/exist');
		const all = await r.scan();
		expect(all).toEqual([]);
		expect(r.all()).toEqual([]);
	});

	test('returns an empty array for a directory with no scaffold.json', async () => {
		const dir = tmpDir((fn) => cleanups.push(fn));
		fs.writeFileSync(path.join(dir, 'README.md'), '# placeholder');
		const r = new ScaffoldRegistry(dir);
		const all = await r.scan();
		expect(all).toEqual([]);
	});

	test('throws with file path on validation failure', async () => {
		const r = new ScaffoldRegistry(FIXTURES_MALFORMED);
		await expect(r.scan()).rejects.toThrow(
			path.join(FIXTURES_MALFORMED, 'scaffold.json')
		);
	});

	test('throws with file path on JSON parse failure', async () => {
		const dir = tmpDir((fn) => cleanups.push(fn));
		fs.writeFileSync(path.join(dir, 'scaffold.json'), '{ not valid json');
		const r = new ScaffoldRegistry(dir);
		await expect(r.scan()).rejects.toThrow(/Failed to parse/);
		await expect(r.scan()).rejects.toThrow(path.join(dir, 'scaffold.json'));
	});

	test('duplicate slug warns to stderr and last write wins', async () => {
		const dir = tmpDir((fn) => cleanups.push(fn));
		const base = {
			slug: 'twin',
			name: 'Twin',
			description: 'A',
			source: 'template',
			files: [{ src: 'a', dest: 'b' }],
		};
		fs.mkdirSync(path.join(dir, 'first'));
		fs.mkdirSync(path.join(dir, 'second'));
		fs.writeFileSync(
			path.join(dir, 'first', 'scaffold.json'),
			JSON.stringify({ ...base, description: 'first' })
		);
		fs.writeFileSync(
			path.join(dir, 'second', 'scaffold.json'),
			JSON.stringify({ ...base, description: 'second' })
		);

		const r = new ScaffoldRegistry(dir);
		const all = await r.scan();
		expect(all).toHaveLength(1);
		expect(r.scaffolds.twin.description).toBe('second');
		expect(stderrChunks.join('')).toMatch(/duplicate slug "twin"/);
	});

	test('re-scan replaces state -- removed files are no longer present', async () => {
		const dir = tmpDir((fn) => cleanups.push(fn));
		const make = (slug, description) => ({
			slug,
			name: slug,
			description,
			source: 'template',
			files: [{ src: 'a', dest: 'b' }],
		});

		fs.mkdirSync(path.join(dir, 'a'));
		fs.mkdirSync(path.join(dir, 'b'));
		fs.writeFileSync(
			path.join(dir, 'a', 'scaffold.json'),
			JSON.stringify(make('a', 'first'))
		);
		fs.writeFileSync(
			path.join(dir, 'b', 'scaffold.json'),
			JSON.stringify(make('b', 'first'))
		);

		const r = new ScaffoldRegistry(dir);
		await r.scan();
		expect(
			r
				.all()
				.map((s) => s.slug)
				.sort()
		).toEqual(['a', 'b']);

		fs.rmSync(path.join(dir, 'b'), { recursive: true, force: true });

		const second = await r.scan();
		expect(second.map((s) => s.slug)).toEqual(['a']);
		expect(r.all().map((s) => s.slug)).toEqual(['a']);
	});

	test('re-scan against now-missing dir clears prior state', async () => {
		const dir = tmpDir((fn) => cleanups.push(fn));
		fs.writeFileSync(
			path.join(dir, 'scaffold.json'),
			JSON.stringify({
				slug: 'only',
				name: 'Only',
				description: 'one',
				source: 'template',
				files: [{ src: 'a', dest: 'b' }],
			})
		);

		const r = new ScaffoldRegistry(dir);
		await r.scan();
		expect(r.all()).toHaveLength(1);

		fs.rmSync(dir, { recursive: true, force: true });

		const second = await r.scan();
		expect(second).toEqual([]);
		expect(r.all()).toEqual([]);
	});

	test('re-scan that throws leaves prior state intact (atomic)', async () => {
		const dir = tmpDir((fn) => cleanups.push(fn));
		fs.writeFileSync(
			path.join(dir, 'scaffold.json'),
			JSON.stringify({
				slug: 'good',
				name: 'Good',
				description: 'first scan',
				source: 'template',
				files: [{ src: 'a', dest: 'b' }],
			})
		);

		const r = new ScaffoldRegistry(dir);
		await r.scan();
		expect(r.all()).toEqual([
			expect.objectContaining({
				slug: 'good',
				description: 'first scan',
			}),
		]);

		fs.writeFileSync(path.join(dir, 'scaffold.json'), '{ not valid json');

		await expect(r.scan()).rejects.toThrow(/Failed to parse/);
		expect(r.all()).toEqual([
			expect.objectContaining({
				slug: 'good',
				description: 'first scan',
			}),
		]);
	});
});

describe('ScaffoldRegistry.filter()', () => {
	let r;

	beforeAll(async () => {
		r = new ScaffoldRegistry(FIXTURES);
		await r.scan();
	});

	test('object shorthand matches by strict equality', () => {
		const result = r.filter({ wizard_step: 'modules' });
		expect(result.map((s) => s.slug)).toEqual(['cache']);
	});

	test('object shorthand with multiple keys must all match', () => {
		const result = r.filter({
			wizard_step: 'integrations',
			source: 'template',
		});
		expect(result.map((s) => s.slug)).toEqual(['algolia']);
	});

	test('function predicate works', () => {
		const result = r.filter((s) => s.source === 'template');
		expect(result.map((s) => s.slug).sort()).toEqual([
			'algolia',
			'block-dynamic',
		]);
	});

	test('throws TypeError on invalid predicate', () => {
		expect(() => r.filter(null)).toThrow(TypeError);
		expect(() => r.filter('nope')).toThrow(TypeError);
		expect(() => r.filter([])).toThrow(TypeError);
	});
});

describe('ScaffoldRegistry.collectDependencies()', () => {
	let r;
	let stderrSpy;
	let stderrChunks;

	beforeAll(async () => {
		r = new ScaffoldRegistry(FIXTURES);
		await r.scan();
	});

	beforeEach(() => {
		stderrChunks = [];
		stderrSpy = jest
			.spyOn(process.stderr, 'write')
			.mockImplementation((chunk) => {
				stderrChunks.push(chunk.toString());
				return true;
			});
	});

	afterEach(() => {
		stderrSpy.mockRestore();
	});

	test('merges the five dependency maps across the selected scaffolds', () => {
		const deps = r.collectDependencies(['cache', 'algolia']);
		expect(deps).toEqual({
			npm: { algoliasearch: '^5.0' },
			npmDev: {},
			composer: {
				'rtcamp/wp-php-toolkit': '^1.0',
				'algolia/algoliasearch-client-php': '^4.0',
			},
			composerDev: {},
			composerSuggest: {},
		});
	});

	test('ignores unknown slugs silently', () => {
		const deps = r.collectDependencies(['cache', 'does-not-exist']);
		expect(deps.composer['rtcamp/wp-php-toolkit']).toBe('^1.0');
	});

	test('returns the empty shape for no slugs', () => {
		const deps = r.collectDependencies([]);
		expect(deps).toEqual({
			npm: {},
			npmDev: {},
			composer: {},
			composerDev: {},
			composerSuggest: {},
		});
	});

	test('version conflict warns to stderr; last write wins', () => {
		const fakeRegistry = new ScaffoldRegistry('/unused');
		fakeRegistry.scaffolds = {
			first: {
				slug: 'first',
				npm_dependencies: { lodash: '^4.0' },
			},
			second: {
				slug: 'second',
				npm_dependencies: { lodash: '^5.0' },
			},
		};
		const deps = fakeRegistry.collectDependencies(['first', 'second']);
		expect(deps.npm.lodash).toBe('^5.0');
		expect(stderrChunks.join('')).toMatch(/version conflict.*lodash/);
	});
});
