'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
	SOURCES_FILENAME,
	parseId,
	readSources,
	validateSources,
	validateIndex,
	indexEntryToRecord,
} = require('../../src/scaffolds/sources');

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'scaffolds-sources');

function makeTmpDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'wpt-sources-'));
}

const validSource = () => ({
	github: 'rtCamp/wp-shared-workflows',
	ref: 'v1',
	path: 'scaffolds',
});

const validIndexEntry = () => ({
	id: 'ci/test-remote',
	path: 'ci/test-remote',
	name: 'CI: remote',
	description: 'a remote scaffold',
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

describe('readSources', () => {
	test('returns null when the file is absent', async () => {
		const dir = makeTmpDir();
		expect(await readSources(dir)).toBeNull();
	});

	test('reads + parses the fixture sources', async () => {
		const src = await readSources(FIXTURE_DIR);
		expect(src).not.toBeNull();
		expect(src.file).toBe(path.join(FIXTURE_DIR, SOURCES_FILENAME));
		expect(Array.isArray(src.parsed.sources)).toBe(true);
		expect(src.parsed.sources[0].github).toBe('rtCamp/wp-shared-workflows');
	});

	test('throws EBADSCAFFOLD on invalid JSON', async () => {
		const dir = makeTmpDir();
		fs.writeFileSync(
			path.join(dir, SOURCES_FILENAME),
			'{ not json',
			'utf8'
		);
		await expect(readSources(dir)).rejects.toMatchObject({
			code: 'EBADSCAFFOLD',
		});
	});
});

describe('validateSources', () => {
	test('accepts a valid sources file', () => {
		expect(validateSources({ sources: [validSource()] })).toEqual([]);
	});

	test('accepts the fixture', () => {
		const parsed = JSON.parse(
			fs.readFileSync(path.join(FIXTURE_DIR, SOURCES_FILENAME), 'utf8')
		);
		expect(validateSources(parsed)).toEqual([]);
	});

	test('rejects a non-object', () => {
		expect(validateSources(null)[0]).toMatch(/must be a JSON object/);
		expect(validateSources([])[0]).toMatch(/must be a JSON object/);
	});

	test('rejects a missing sources array', () => {
		expect(validateSources({})[0]).toMatch(/'sources' must be an array/);
	});

	test('rejects an unknown top-level field', () => {
		const errors = validateSources({ sources: [], extra: 1 });
		expect(errors).toContain("sources: unknown top-level field 'extra'");
	});

	test('rejects a source missing required fields', () => {
		const errors = validateSources({ sources: [{ github: 'a/b' }] });
		expect(errors).toEqual(
			expect.arrayContaining([
				'sources[0].ref: required',
				'sources[0].path: required',
			])
		);
	});

	test('rejects a bad github slug', () => {
		const s = validSource();
		s.github = 'no-slash';
		const errors = validateSources({ sources: [s] });
		expect(errors).toContain("sources[0].github: must match 'owner/repo'");
	});

	test('rejects an unknown source field', () => {
		const s = validSource();
		s.branch = 'main';
		const errors = validateSources({ sources: [s] });
		expect(errors).toContain("sources[0]: unknown field 'branch'");
	});

	test('flags a duplicate github + path source', () => {
		const errors = validateSources({
			sources: [validSource(), validSource()],
		});
		expect(errors.some((x) => /duplicate source/.test(x))).toBe(true);
	});
});

describe('validateIndex', () => {
	test('accepts a valid index', () => {
		expect(validateIndex({ scaffolds: [validIndexEntry()] })).toEqual([]);
	});

	test('accepts an optional checksum', () => {
		expect(
			validateIndex({
				scaffolds: [{ ...validIndexEntry(), checksum: 'sha256:abc' }],
			})
		).toEqual([]);
	});

	test('rejects a non-object', () => {
		expect(validateIndex(null)[0]).toMatch(/must be a JSON object/);
	});

	test('rejects a missing scaffolds array', () => {
		expect(validateIndex({})[0]).toMatch(/'scaffolds' must be an array/);
	});

	test('rejects an entry missing required fields', () => {
		const errors = validateIndex({ scaffolds: [{ id: 'ci/x' }] });
		expect(errors).toEqual(
			expect.arrayContaining([
				'scaffolds[0].path: must be a non-empty string',
				'scaffolds[0].name: must be a non-empty string',
				'scaffolds[0].description: must be a non-empty string',
			])
		);
	});

	test('rejects a bad slug in id', () => {
		const e = validIndexEntry();
		e.id = 'ci/NotKebab';
		const errors = validateIndex({ scaffolds: [e] });
		expect(errors.some((x) => /slug must match/.test(x))).toBe(true);
	});

	test('rejects an unknown entry field', () => {
		const e = { ...validIndexEntry(), repository: {} };
		const errors = validateIndex({ scaffolds: [e] });
		expect(errors).toContain("scaffolds[0]: unknown field 'repository'");
	});

	test('rejects duplicate ids', () => {
		const errors = validateIndex({
			scaffolds: [validIndexEntry(), validIndexEntry()],
		});
		expect(errors).toContain(
			"scaffolds[1].id: duplicate id 'ci/test-remote'"
		);
	});
});

describe('indexEntryToRecord', () => {
	test('builds a thin remote record with the resolved scaffold path', () => {
		const record = indexEntryToRecord(validSource(), {
			...validIndexEntry(),
			checksum: 'sha256:abc',
		});
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
			_checksum: 'sha256:abc',
		});
	});

	test('normalises slashes when joining source.path + entry.path', () => {
		const record = indexEntryToRecord(
			{ github: 'a/b', ref: 'v1', path: '/scaffolds/' },
			{ ...validIndexEntry(), path: '/ci/test-remote/' }
		);
		expect(record._repository.path).toBe('scaffolds/ci/test-remote');
	});
});
