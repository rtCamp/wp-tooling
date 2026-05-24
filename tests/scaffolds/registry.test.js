/**
 * Tests for src/scaffolds/registry.js: scan, get, filter, collectDependencies, execute.
 *
 * Uses the fixture at tests/fixtures/scaffolds-basic/ (wp/cli scaffold) plus
 * inline tmp directories for two-directory merge and write/skip cases.
 */

'use strict';

const fs = require('fs/promises');
const fssync = require('fs');
const os = require('os');
const path = require('path');

const {
	ScaffoldRegistry,
	ScaffoldError,
} = require('../../src/scaffolds/registry');

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'scaffolds-basic');

function makeTmpDir() {
	return fssync.mkdtempSync(path.join(os.tmpdir(), 'wp-tooling-scaffold-'));
}

describe('ScaffoldRegistry construction', () => {
	it('rejects empty args', () => {
		expect(() => new ScaffoldRegistry({})).toThrow(ScaffoldError);
	});

	it('accepts a single string (back-compat for project-only)', async () => {
		const r = new ScaffoldRegistry(FIXTURE);
		await r.scan();
		expect(r.all().length).toBe(1);
	});

	it('accepts object form', async () => {
		const r = new ScaffoldRegistry({ defaultsDir: FIXTURE });
		await r.scan();
		expect(r.all().length).toBe(1);
	});
});

describe('scan()', () => {
	it('discovers scaffolds and tags source', async () => {
		const r = new ScaffoldRegistry({ defaultsDir: FIXTURE });
		await r.scan();
		const entries = r.all();
		expect(entries).toHaveLength(1);
		expect(entries[0].slug).toBe('cli');
		expect(entries[0].category).toBe('wp');
		expect(entries[0].source).toBe('template'); // manifest field, preserved
		expect(entries[0].origin).toBe('default'); // runtime tag, set by scan()
		expect(entries[0]._dir).toMatch(/wp\/cli$/);
	});

	it('returns empty when no scaffolds found', async () => {
		const tmp = makeTmpDir();
		const r = new ScaffoldRegistry({ projectDir: tmp });
		await r.scan();
		expect(r.all()).toEqual([]);
	});

	it('throws EBADSCAFFOLD on malformed JSON', async () => {
		const tmp = makeTmpDir();
		await fs.writeFile(
			path.join(tmp, 'scaffold.json'),
			'{ not json',
			'utf8'
		);
		const r = new ScaffoldRegistry({ projectDir: tmp });
		await expect(r.scan()).rejects.toThrow(/Invalid JSON/);
	});

	it('throws EBADSCAFFOLD on schema-invalid scaffold', async () => {
		const tmp = makeTmpDir();
		await fs.writeFile(
			path.join(tmp, 'scaffold.json'),
			JSON.stringify({ slug: 'bad' }),
			'utf8'
		);
		const r = new ScaffoldRegistry({ projectDir: tmp });
		await expect(r.scan()).rejects.toThrow(/Invalid scaffold/);
	});
});

describe('two-directory merge', () => {
	it('project entries override default entries on category/slug collision', async () => {
		const tmp = makeTmpDir();
		const projectDir = path.join(
			tmp,
			'project',
			'bin',
			'scaffolds',
			'wp',
			'cli'
		);
		await fs.mkdir(projectDir, { recursive: true });
		await fs.writeFile(
			path.join(projectDir, 'scaffold.json'),
			JSON.stringify({
				slug: 'cli',
				category: 'wp',
				name: 'Project CLI override',
				description: 'Project override',
				source: 'template',
				files: [],
			}),
			'utf8'
		);

		const r = new ScaffoldRegistry({
			defaultsDir: FIXTURE,
			projectDir: path.join(tmp, 'project', 'bin', 'scaffolds'),
		});
		await r.scan();
		const all = r.all();
		expect(all).toHaveLength(1);
		expect(all[0].name).toBe('Project CLI override');
		expect(all[0].origin).toBe('project');
	});

	it('non-colliding default and project entries both appear', async () => {
		const tmp = makeTmpDir();
		const projectDir = path.join(
			tmp,
			'project',
			'bin',
			'scaffolds',
			'wp',
			'rest'
		);
		await fs.mkdir(projectDir, { recursive: true });
		await fs.writeFile(
			path.join(projectDir, 'scaffold.json'),
			JSON.stringify({
				slug: 'rest',
				category: 'wp',
				name: 'REST',
				description: 'REST',
				source: 'template',
				files: [],
			}),
			'utf8'
		);
		const r = new ScaffoldRegistry({
			defaultsDir: FIXTURE,
			projectDir: path.join(tmp, 'project', 'bin', 'scaffolds'),
		});
		await r.scan();
		expect(
			r
				.all()
				.map((e) => `${e.category}/${e.slug}`)
				.sort()
		).toEqual(['wp/cli', 'wp/rest']);
	});
});

describe('get() and filter()', () => {
	let registry;
	beforeAll(async () => {
		registry = new ScaffoldRegistry({ defaultsDir: FIXTURE });
		await registry.scan();
	});

	it('finds scaffold by category/slug id', () => {
		expect(registry.get('wp/cli')).not.toBeNull();
	});

	it('finds scaffold by slug alone (no category)', () => {
		expect(registry.get('cli')).not.toBeNull();
	});

	it('returns null for unknown id', () => {
		expect(registry.get('unknown')).toBeNull();
	});

	it('filter by predicate', () => {
		expect(registry.filter({ origin: 'default' })).toHaveLength(1);
		expect(registry.filter({ origin: 'project' })).toHaveLength(0);
	});
});

describe('collectDependencies()', () => {
	it('merges composer/npm deps across selected scaffolds', async () => {
		const tmp = makeTmpDir();
		const aDir = path.join(tmp, 'a');
		await fs.mkdir(aDir, { recursive: true });
		await fs.writeFile(
			path.join(aDir, 'scaffold.json'),
			JSON.stringify({
				slug: 'a',
				name: 'A',
				description: 'A',
				source: 'package',
				files: [],
				composer_dependencies: { 'foo/a': '^1.0' },
			}),
			'utf8'
		);
		const bDir = path.join(tmp, 'b');
		await fs.mkdir(bDir, { recursive: true });
		await fs.writeFile(
			path.join(bDir, 'scaffold.json'),
			JSON.stringify({
				slug: 'b',
				name: 'B',
				description: 'B',
				source: 'package',
				files: [],
				composer_dependencies: { 'foo/b': '^2.0' },
				npm_dependencies: { 'pkg/x': '~1' },
			}),
			'utf8'
		);
		const r = new ScaffoldRegistry({ projectDir: tmp });
		await r.scan();
		const deps = r.collectDependencies(['a', 'b']);
		expect(deps.composer).toEqual({ 'foo/a': '^1.0', 'foo/b': '^2.0' });
		expect(deps.npm).toEqual({ 'pkg/x': '~1' });
	});
});

describe('execute() result shape', () => {
	let registry;
	beforeAll(async () => {
		registry = new ScaffoldRegistry({ defaultsDir: FIXTURE });
		await registry.scan();
	});

	it('returns the four-block shape', async () => {
		const tmp = makeTmpDir();
		const result = await registry.execute(
			'wp/cli',
			{ name: 'qm-export' },
			{ dryRun: true, cwd: tmp }
		);
		expect(Object.keys(result).sort()).toEqual([
			'ai',
			'developer',
			'engine',
			'scaffold',
			'warnings',
		]);
		expect(result.scaffold).toEqual({
			id: 'wp/cli',
			slug: 'cli',
			kind: 'template',
			dryRun: true,
		});
		expect(result.engine.wrote).toEqual(['includes/Cli/QmExport.php']);
		expect(result.engine.skipped).toEqual([]);
		expect(result.developer.install).toEqual({
			composer: {},
			composerDev: {},
			composerSuggest: {},
			npm: {},
			npmDev: {},
		});
		expect(result.developer.secrets).toEqual([]);
		expect(result.ai.wiring).toHaveLength(1);
		expect(result.ai.wiring[0].targetFile).toBe('includes/Plugin.php');
		expect(result.ai.wiring[0].snippet).toContain('QmExport::class');
		expect(result.ai.tests).toEqual([]);
		expect(result.warnings).toEqual([]);
	});

	it('dry-run writes no files', async () => {
		const tmp = makeTmpDir();
		await registry.execute(
			'wp/cli',
			{ name: 'qm-export' },
			{ dryRun: true, cwd: tmp }
		);
		const wantedPath = path.join(tmp, 'includes/Cli/QmExport.php');
		await expect(fs.access(wantedPath)).rejects.toThrow();
	});

	it('full run writes files', async () => {
		const tmp = makeTmpDir();
		await registry.execute(
			'wp/cli',
			{ name: 'qm-export' },
			{ dryRun: false, cwd: tmp }
		);
		const wrote = await fs.readFile(
			path.join(tmp, 'includes/Cli/QmExport.php'),
			'utf8'
		);
		expect(wrote).toContain('class QmExport');
		expect(wrote).toContain('namespace Inc\\Cli');
	});

	it('skips existing files (no overwrite)', async () => {
		const tmp = makeTmpDir();
		await fs.mkdir(path.join(tmp, 'includes/Cli'), { recursive: true });
		await fs.writeFile(
			path.join(tmp, 'includes/Cli/QmExport.php'),
			'original',
			'utf8'
		);
		const result = await registry.execute(
			'wp/cli',
			{ name: 'qm-export' },
			{ dryRun: false, cwd: tmp }
		);
		expect(result.engine.skipped).toEqual(['includes/Cli/QmExport.php']);
		expect(result.warnings.length).toBeGreaterThan(0);
		expect(
			await fs.readFile(
				path.join(tmp, 'includes/Cli/QmExport.php'),
				'utf8'
			)
		).toBe('original');
	});

	it('warns on supplied inputs the scaffold does not declare', async () => {
		const tmp = makeTmpDir();
		const result = await registry.execute(
			'wp/cli',
			{ name: 'qm-export', namspace: 'Inc' }, // typo: declared key is `namespace`
			{ dryRun: true, cwd: tmp }
		);
		const unknown = result.warnings.filter((w) =>
			w.startsWith('unknown input "namspace"')
		);
		expect(unknown).toHaveLength(1);
		expect(unknown[0]).toContain('Declared inputs:');
		expect(unknown[0]).toContain('namespace');
	});

	it('does not warn when every supplied input is declared', async () => {
		const tmp = makeTmpDir();
		const result = await registry.execute(
			'wp/cli',
			{ name: 'qm-export', namespace: 'Inc\\Cli' },
			{ dryRun: true, cwd: tmp }
		);
		expect(
			result.warnings.filter((w) => w.startsWith('unknown input'))
		).toEqual([]);
	});
});

describe('execute() error paths', () => {
	let registry;
	beforeAll(async () => {
		registry = new ScaffoldRegistry({ defaultsDir: FIXTURE });
		await registry.scan();
	});

	it('throws ENOSCAFFOLD with available list', async () => {
		try {
			await registry.execute('does/not-exist', {}, {});
			throw new Error('should have thrown');
		} catch (err) {
			expect(err.code).toBe('ENOSCAFFOLD');
			expect(err.available).toContain('wp/cli');
		}
	});

	it('throws EMISSINGINPUT with missingDetails when required input is absent', async () => {
		try {
			await registry.execute('wp/cli', {}, { dryRun: true });
			throw new Error('should have thrown');
		} catch (err) {
			expect(err.code).toBe('EMISSINGINPUT');
			expect(err.missing).toEqual(['name']);
			expect(err.missingDetails[0]).toEqual({
				key: 'name',
				description: 'Slug for the command.',
				discover_from: null,
			});
		}
	});
});

describe('execute() passes scripts through to developer block', () => {
	it('passes npm and composer scripts verbatim', async () => {
		const tmp = makeTmpDir();
		const sDir = path.join(tmp, 'lint');
		await fs.mkdir(sDir, { recursive: true });
		await fs.writeFile(
			path.join(sDir, 'scaffold.json'),
			JSON.stringify({
				slug: 'eslint',
				category: 'lint',
				name: 'ESLint',
				description: 'ESLint',
				source: 'template',
				files: [],
				scripts: {
					npm: {
						'lint:js': 'eslint .',
						'lint:js:fix': 'eslint . --fix',
					},
					composer: {
						'lint:php': 'phpcs',
					},
				},
			}),
			'utf8'
		);
		const r = new ScaffoldRegistry({ projectDir: tmp });
		await r.scan();
		const result = await r.execute(
			'lint/eslint',
			{},
			{ dryRun: true, cwd: makeTmpDir() }
		);
		expect(result.developer.scripts).toEqual({
			npm: { 'lint:js': 'eslint .', 'lint:js:fix': 'eslint . --fix' },
			composer: { 'lint:php': 'phpcs' },
		});
	});

	it('emits empty script maps when scaffold declares none', async () => {
		const registry = new ScaffoldRegistry({ defaultsDir: FIXTURE });
		await registry.scan();
		const result = await registry.execute(
			'wp/cli',
			{ name: 'qm' },
			{ dryRun: true, cwd: makeTmpDir() }
		);
		expect(result.developer.scripts).toEqual({ npm: {}, composer: {} });
	});

	it('keeps npm runtime vs dev vs composer-suggest in distinct fields (no merging)', async () => {
		const tmp = makeTmpDir();
		const sDir = path.join(tmp, 'lint');
		await fs.mkdir(sDir, { recursive: true });
		await fs.writeFile(
			path.join(sDir, 'scaffold.json'),
			JSON.stringify({
				slug: 'eslint',
				name: 'ESLint',
				description: 'ESLint',
				source: 'template',
				files: [],
				npm_dependencies: { 'react-runtime': '^18' },
				npm_dev_dependencies: { eslint: '8.57.1' },
				composer_dev_dependencies: {
					'squizlabs/php_codesniffer': '^3',
				},
				composer_suggest: { 'rtcamp/wp-php-toolkit': '^1' },
			}),
			'utf8'
		);
		const r = new ScaffoldRegistry({ projectDir: tmp });
		await r.scan();
		const result = await r.execute(
			'eslint',
			{},
			{ dryRun: true, cwd: makeTmpDir() }
		);
		// Each map is surfaced in its own field so a consumer can pick the
		// right install command (composer require vs composer require --dev
		// vs the optional "suggest" hint). Merging would lose that signal.
		expect(result.developer.install.npm).toEqual({
			'react-runtime': '^18',
		});
		expect(result.developer.install.npmDev).toEqual({ eslint: '8.57.1' });
		expect(result.developer.install.composerDev).toEqual({
			'squizlabs/php_codesniffer': '^3',
		});
		expect(result.developer.install.composerSuggest).toEqual({
			'rtcamp/wp-php-toolkit': '^1',
		});
	});
});

describe('execute() never embeds secret values', () => {
	it('passes through declared secrets without any value field', async () => {
		const tmp = makeTmpDir();
		const scaffoldDir = path.join(tmp, 'workflow');
		await fs.mkdir(scaffoldDir, { recursive: true });
		await fs.writeFile(
			path.join(scaffoldDir, 'scaffold.json'),
			JSON.stringify({
				slug: 'cd',
				category: 'ci',
				name: 'CD',
				description: 'CD',
				source: 'template',
				files: [],
				secrets: [
					{
						key: 'WPORG_USERNAME',
						scope: 'github-actions',
						description: 'User',
					},
					{
						key: 'WPORG_PASSWORD',
						scope: 'github-actions',
						description: 'Pass',
					},
				],
			}),
			'utf8'
		);
		const r = new ScaffoldRegistry({ projectDir: tmp });
		await r.scan();
		const target = makeTmpDir();
		const result = await r.execute(
			'ci/cd',
			{},
			{ dryRun: true, cwd: target }
		);
		expect(result.developer.secrets).toHaveLength(2);
		for (const s of result.developer.secrets) {
			expect(s).not.toHaveProperty('value');
		}
	});
});
