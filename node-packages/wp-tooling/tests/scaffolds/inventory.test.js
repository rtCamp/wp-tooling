'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
	INVENTORY_FILENAME,
	parseId,
	readInventory,
	validateInventory,
	entryToRecord,
} = require('../../src/scaffolds/inventory');

const FIXTURE_DIR = path.join(
	__dirname,
	'..',
	'fixtures',
	'scaffolds-inventory'
);

function makeTmpDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'wpt-inventory-'));
}

const validEntry = () => ({
	id: 'ci/test-remote',
	name: 'CI: remote',
	description: 'a remote scaffold',
	repository: {
		github: 'rtCamp/wp-shared-workflows',
		ref: 'v1',
		path: 'scaffolds/ci/test-remote',
	},
});

describe('parseId', () => {
	test('splits category/slug', () => {
		expect(parseId('ci/test-php')).toEqual({
			category: 'ci',
			slug: 'test-php',
		});
	});
	test('handles nested category', () => {
		expect(parseId('lint/phpcs/vip')).toEqual({
			category: 'lint/phpcs',
			slug: 'vip',
		});
	});
	test('handles slug with no category', () => {
		expect(parseId('cache')).toEqual({ category: null, slug: 'cache' });
	});
});

describe('readInventory', () => {
	test('returns null when the file is absent', async () => {
		const dir = makeTmpDir();
		expect(await readInventory(dir)).toBeNull();
	});

	test('reads + parses the fixture inventory', async () => {
		const inv = await readInventory(FIXTURE_DIR);
		expect(inv).not.toBeNull();
		expect(inv.file).toBe(path.join(FIXTURE_DIR, INVENTORY_FILENAME));
		expect(Array.isArray(inv.parsed.scaffolds)).toBe(true);
		expect(inv.parsed.scaffolds[0].id).toBe('ci/test-remote');
	});

	test('throws EBADSCAFFOLD on invalid JSON', async () => {
		const dir = makeTmpDir();
		fs.writeFileSync(
			path.join(dir, INVENTORY_FILENAME),
			'{ not json',
			'utf8'
		);
		await expect(readInventory(dir)).rejects.toMatchObject({
			code: 'EBADSCAFFOLD',
		});
	});
});

describe('validateInventory', () => {
	test('accepts a valid inventory', () => {
		expect(validateInventory({ scaffolds: [validEntry()] })).toEqual([]);
	});

	test('accepts the fixture', () => {
		const parsed = JSON.parse(
			fs.readFileSync(path.join(FIXTURE_DIR, INVENTORY_FILENAME), 'utf8')
		);
		expect(validateInventory(parsed)).toEqual([]);
	});

	test('rejects a non-object', () => {
		expect(validateInventory(null)[0]).toMatch(/must be a JSON object/);
		expect(validateInventory([])[0]).toMatch(/must be a JSON object/);
	});

	test('rejects a missing scaffolds array', () => {
		expect(validateInventory({})[0]).toMatch(
			/'scaffolds' must be an array/
		);
	});

	test('rejects an unknown top-level field', () => {
		const errors = validateInventory({ scaffolds: [], extra: 1 });
		expect(errors).toContain("inventory: unknown top-level field 'extra'");
	});

	test('rejects an entry missing required fields', () => {
		const errors = validateInventory({ scaffolds: [{ id: 'ci/x' }] });
		expect(errors).toEqual(
			expect.arrayContaining([
				'scaffolds[0].name: must be a non-empty string',
				'scaffolds[0].description: must be a non-empty string',
				'scaffolds[0].repository: must be an object',
			])
		);
	});

	test('rejects a bad github slug', () => {
		const e = validEntry();
		e.repository.github = 'no-slash';
		const errors = validateInventory({ scaffolds: [e] });
		expect(errors).toContain(
			"scaffolds[0].repository.github: must match 'owner/repo'"
		);
	});

	test('rejects a missing repository.ref', () => {
		const e = validEntry();
		delete e.repository.ref;
		const errors = validateInventory({ scaffolds: [e] });
		expect(errors).toContain('scaffolds[0].repository.ref: required');
	});

	test('rejects an unknown repository field', () => {
		const e = validEntry();
		e.repository.branch = 'main';
		const errors = validateInventory({ scaffolds: [e] });
		expect(errors).toContain(
			"scaffolds[0].repository: unknown field 'branch'"
		);
	});

	test('rejects a bad slug in id', () => {
		const e = validEntry();
		e.id = 'ci/NotKebab';
		const errors = validateInventory({ scaffolds: [e] });
		expect(errors.some((x) => /slug must match/.test(x))).toBe(true);
	});

	test('rejects duplicate ids', () => {
		const errors = validateInventory({
			scaffolds: [validEntry(), validEntry()],
		});
		expect(errors).toContain(
			"scaffolds[1].id: duplicate id 'ci/test-remote'"
		);
	});
});

describe('entryToRecord', () => {
	test('builds a thin remote record', () => {
		const record = entryToRecord(validEntry());
		expect(record).toEqual({
			slug: 'test-remote',
			category: 'ci',
			name: 'CI: remote',
			description: 'a remote scaffold',
			origin: 'remote',
			_repository: {
				github: 'rtCamp/wp-shared-workflows',
				ref: 'v1',
				path: 'scaffolds/ci/test-remote',
			},
		});
	});
});
