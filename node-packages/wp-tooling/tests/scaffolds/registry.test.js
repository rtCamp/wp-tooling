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

	it('treats a test entry sharing a file dest as declarative, on both clean run and idempotent re-run (D2)', async () => {
		const lintFixture = path.join(
			__dirname,
			'..',
			'fixtures',
			'scaffolds-declarative-lint'
		);
		const lintRegistry = new ScaffoldRegistry({ defaultsDir: lintFixture });
		await lintRegistry.scan();

		const dest = '.github/workflows/ci-check.yml';
		const declarativeTest = {
			path: dest,
			framework: 'actionlint',
			command: null,
		};
		const stubWarnings = (result) =>
			result.warnings.filter((w) => w.includes('test stub already'));

		const tmp = makeTmpDir();

		// Clean run: file is created, the test entry shares its dest so it is a
		// lint declaration — no stub is written, no warning, but it is still
		// surfaced to the AI under ai.tests.
		const first = await lintRegistry.execute(
			'ci/lint-only',
			{ slug: 'ci-check' },
			{ dryRun: false, cwd: tmp }
		);
		expect(first.engine.wrote).toEqual([dest]);
		expect(stubWarnings(first)).toEqual([]);
		expect(first.ai.tests).toContainEqual(declarativeTest);

		// Idempotent re-run: file already exists → skipped (not created), so the
		// declarative dest is absent from the created set. It must still be
		// recognised as declarative — no false "test stub already exists" — and
		// still surfaced under ai.tests.
		const second = await lintRegistry.execute(
			'ci/lint-only',
			{ slug: 'ci-check' },
			{ dryRun: false, cwd: tmp }
		);
		expect(second.engine.skipped).toEqual([dest]);
		expect(stubWarnings(second)).toEqual([]);
		expect(second.ai.tests).toContainEqual(declarativeTest);
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
		const err = await registry.execute('does/not-exist', {}, {}).then(
			() => {
				throw new Error('should have thrown');
			},
			(caught) => caught
		);
		expect(err.code).toBe('ENOSCAFFOLD');
		expect(err.available).toContain('wp/cli');
	});

	it('throws EMISSINGINPUT with missingDetails when required input is absent', async () => {
		const err = await registry.execute('wp/cli', {}, { dryRun: true }).then(
			() => {
				throw new Error('should have thrown');
			},
			(caught) => caught
		);
		expect(err.code).toBe('EMISSINGINPUT');
		expect(err.missing).toEqual(['name']);
		expect(err.missingDetails[0]).toEqual({
			key: 'name',
			description: 'Slug for the command.',
			discover_from: null,
		});
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

// ---------------------------------------------------------------------------
// Remote scaffolds via per-repo sources + an upstream index
// ---------------------------------------------------------------------------

describe('remote scaffolds (sources + index)', () => {
	const { EventEmitter } = require('events');
	const https = require('https');

	let httpsSpy;

	// Route https.get to a canned body by matching a route key as a URL suffix
	// (e.g. 'index.json', 'scaffold.json', 'a.mustache'). Models a CDN with
	// ETags: a request carrying a matching If-None-Match gets 304 + no body, so
	// caching is exercised. A route value may be a string (200) or
	// `{ body, statusCode }` to force an error status.
	function setHttpsRoutes(routes, { delayMs = 0 } = {}) {
		const starts = [];
		let inFlight = 0;
		let maxInFlight = 0;
		httpsSpy = jest
			.spyOn(https, 'get')
			.mockImplementation((url, options, cb) => {
				starts.push({ url, t: Date.now() });
				inFlight++;
				maxInFlight = Math.max(maxInFlight, inFlight);
				const req = new EventEmitter();
				req.destroy = () => {};
				const res = new EventEmitter();
				res.setEncoding = () => {};

				let spec = null;
				for (const [key, val] of Object.entries(routes)) {
					if (url.endsWith(key)) {
						spec = val;
						break;
					}
				}
				const body =
					typeof spec === 'string' ? spec : (spec && spec.body) || '';
				const forced =
					spec && typeof spec === 'object'
						? spec.statusCode
						: undefined;
				const etag = `"etag:${url}"`;
				const ifNoneMatch =
					options &&
					options.headers &&
					options.headers['If-None-Match'];

				let status;
				let sendBody;
				if (forced && forced >= 400) {
					status = forced;
					sendBody = body;
				} else if (ifNoneMatch === etag) {
					status = 304;
					sendBody = '';
				} else {
					status = forced || 200;
					sendBody = body;
				}
				res.statusCode = status;
				res.headers = { etag };

				const finish = () => {
					cb(res);
					res.emit('data', sendBody);
					res.emit('end');
					inFlight--;
				};
				if (delayMs > 0) {
					setTimeout(finish, delayMs);
				} else {
					process.nextTick(finish);
				}
				return req;
			});
		return {
			starts,
			templateStarts: () =>
				starts.filter((s) => /\.mustache$/.test(s.url)),
			maxInFlight: () => maxInFlight,
		};
	}

	// The registry scans the dir it is given (projectDir) directly, so
	// sources.json lives at its root — mirroring how the CLI passes
	// `<cwd>/bin/scaffolds` as projectDir.
	function writeSources(dir, sources) {
		fssync.mkdirSync(dir, { recursive: true });
		fssync.writeFileSync(
			path.join(dir, 'sources.json'),
			JSON.stringify({ sources }),
			'utf8'
		);
	}

	function writeLocalScaffold(dir, scaffoldJson) {
		const id = scaffoldJson.category
			? `${scaffoldJson.category}/${scaffoldJson.slug}`
			: scaffoldJson.slug;
		const sdir = path.join(dir, ...id.split('/'));
		fssync.mkdirSync(sdir, { recursive: true });
		fssync.writeFileSync(
			path.join(sdir, 'scaffold.json'),
			JSON.stringify(scaffoldJson),
			'utf8'
		);
	}

	const source = (overrides = {}) => ({
		github: 'rtCamp/wp-shared-workflows',
		ref: 'v1',
		path: 'scaffolds',
		...overrides,
	});

	const indexEntry = (overrides = {}) => ({
		id: 'ci/test-remote',
		path: 'ci/test-remote',
		name: 'CI Remote',
		description: 'a remote scaffold',
		...overrides,
	});

	const indexBody = (entries = [indexEntry()]) =>
		JSON.stringify({ scaffolds: entries });

	const manifest = (overrides = {}) =>
		JSON.stringify({
			slug: 'test-remote',
			category: 'ci',
			name: 'CI Remote',
			description: 'a remote scaffold',
			source: 'template',
			files: [{ src: 'a.mustache', dest: '.github/workflows/a.yml' }],
			...overrides,
		});

	let projectDir;
	let cacheDir;
	let targetDir;

	beforeEach(() => {
		projectDir = makeTmpDir();
		cacheDir = makeTmpDir();
		targetDir = makeTmpDir();
		jest.restoreAllMocks();
	});

	afterEach(() => {
		for (const d of [projectDir, cacheDir, targetDir]) {
			fssync.rmSync(d, { recursive: true, force: true });
		}
	});

	const scanOpts = () => ({ fetchOpts: { cacheDir } });

	test('scan fetches the index and surfaces a thin remote record', async () => {
		writeSources(projectDir, [source()]);
		setHttpsRoutes({ 'index.json': indexBody() });
		const r = new ScaffoldRegistry({ projectDir });
		await r.scan(scanOpts());
		const rec = r.get('ci/test-remote');
		expect(rec).toBeTruthy();
		expect(rec.origin).toBe('remote');
		expect(rec.name).toBe('CI Remote');
		expect(rec.files).toBeUndefined(); // not hydrated yet
		expect(rec._repository.github).toBe('rtCamp/wp-shared-workflows');
		expect(rec._repository.path).toBe('scaffolds/ci/test-remote');
	});

	test('remote id colliding with a local scaffold throws EBADSCAFFOLD', async () => {
		writeLocalScaffold(projectDir, {
			slug: 'test-remote',
			category: 'ci',
			name: 'Local',
			description: 'local',
			source: 'template',
			files: [{ src: 'x.mustache', dest: 'x.yml' }],
		});
		writeSources(projectDir, [source()]);
		setHttpsRoutes({ 'index.json': indexBody() });
		const r = new ScaffoldRegistry({ projectDir });
		await expect(r.scan(scanOpts())).rejects.toMatchObject({
			code: 'EBADSCAFFOLD',
		});
	});

	test('same id offered by two sources throws EBADSCAFFOLD', async () => {
		writeSources(projectDir, [
			source(),
			source({ github: 'rtCamp/other-repo' }),
		]);
		setHttpsRoutes({ 'index.json': indexBody() }); // both indexes list ci/test-remote
		const r = new ScaffoldRegistry({ projectDir });
		await expect(r.scan(scanOpts())).rejects.toMatchObject({
			code: 'EBADSCAFFOLD',
		});
	});

	test('unreachable index is skipped with a warning, not a hard failure', async () => {
		writeSources(projectDir, [source()]);
		setHttpsRoutes({ 'index.json': { body: 'nope', statusCode: 404 } });
		const warnings = [];
		const r = new ScaffoldRegistry({ projectDir });
		await r.scan({ fetchOpts: { cacheDir, warnings } });
		expect(r.get('ci/test-remote')).toBeNull();
		expect(
			warnings.some((w) => /could not load scaffold index/.test(w))
		).toBe(true);
	});

	test('malformed index throws EBADSCAFFOLD', async () => {
		writeSources(projectDir, [source()]);
		setHttpsRoutes({ 'index.json': '{ not json' });
		const r = new ScaffoldRegistry({ projectDir });
		await expect(r.scan(scanOpts())).rejects.toMatchObject({
			code: 'EBADSCAFFOLD',
		});
	});

	test('schema-invalid index throws EBADSCAFFOLD', async () => {
		writeSources(projectDir, [source()]);
		setHttpsRoutes({ 'index.json': JSON.stringify({ scaffolds: [{}] }) });
		const r = new ScaffoldRegistry({ projectDir });
		await expect(r.scan(scanOpts())).rejects.toMatchObject({
			code: 'EBADSCAFFOLD',
		});
	});

	test('execute hydrates the manifest then fetches + writes the template', async () => {
		writeSources(projectDir, [source()]);
		setHttpsRoutes({
			'index.json': indexBody(),
			'scaffold.json': manifest(),
			'a.mustache': 'content: rendered',
		});
		const r = new ScaffoldRegistry({ projectDir });
		await r.scan(scanOpts());
		const result = await r.execute(
			'ci/test-remote',
			{},
			{ cwd: targetDir, fetchOpts: { cacheDir } }
		);
		expect(result.engine.wrote).toEqual(['.github/workflows/a.yml']);
		// index (scan) + manifest + 1 template
		expect(httpsSpy).toHaveBeenCalledTimes(3);
		const written = fssync.readFileSync(
			path.join(targetDir, '.github/workflows/a.yml'),
			'utf8'
		);
		expect(written).toBe('content: rendered');
	});

	test('renders the fetched manifest inputs into the template', async () => {
		writeSources(projectDir, [source()]);
		setHttpsRoutes({
			'index.json': indexBody(),
			'scaffold.json': manifest({
				inputs: [
					{ key: 'greeting', description: 'g', default: 'hello' },
				],
			}),
			'a.mustache': 'value: {{greeting}}',
		});
		const r = new ScaffoldRegistry({ projectDir });
		await r.scan(scanOpts());
		await r.execute(
			'ci/test-remote',
			{},
			{ cwd: targetDir, fetchOpts: { cacheDir } }
		);
		const written = fssync.readFileSync(
			path.join(targetDir, '.github/workflows/a.yml'),
			'utf8'
		);
		expect(written).toBe('value: hello');
	});

	test('ETag cache serves the body on 304 across fresh registries', async () => {
		writeSources(projectDir, [source()]);
		setHttpsRoutes({
			'index.json': indexBody(),
			'scaffold.json': manifest(),
			'a.mustache': 'body',
		});
		const r1 = new ScaffoldRegistry({ projectDir });
		await r1.scan(scanOpts());
		await r1.execute(
			'ci/test-remote',
			{},
			{ cwd: targetDir, fetchOpts: { cacheDir } }
		);
		// Fresh registry + fresh target: every URL is now cached, so the server
		// answers conditional requests with 304 + an empty body. The correct
		// file can only be written if the cached bodies are used.
		const targetTwo = makeTmpDir();
		const r2 = new ScaffoldRegistry({ projectDir });
		await r2.scan(scanOpts());
		try {
			await r2.execute(
				'ci/test-remote',
				{},
				{ cwd: targetTwo, fetchOpts: { cacheDir } }
			);
			const written = fssync.readFileSync(
				path.join(targetTwo, '.github/workflows/a.yml'),
				'utf8'
			);
			expect(written).toBe('body'); // served from cache on 304
		} finally {
			fssync.rmSync(targetTwo, { recursive: true, force: true });
		}
	});

	test('malformed remote manifest throws EBADSCAFFOLD', async () => {
		writeSources(projectDir, [source()]);
		setHttpsRoutes({
			'index.json': indexBody(),
			'scaffold.json': '{ not json',
		});
		const r = new ScaffoldRegistry({ projectDir });
		await r.scan(scanOpts());
		await expect(
			r.execute(
				'ci/test-remote',
				{},
				{ cwd: targetDir, fetchOpts: { cacheDir } }
			)
		).rejects.toMatchObject({ code: 'EBADSCAFFOLD' });
	});

	test('schema-invalid remote manifest throws EBADSCAFFOLD', async () => {
		writeSources(projectDir, [source()]);
		setHttpsRoutes({
			'index.json': indexBody(),
			'scaffold.json': JSON.stringify({ slug: 'x' }),
		});
		const r = new ScaffoldRegistry({ projectDir });
		await r.scan(scanOpts());
		await expect(
			r.execute(
				'ci/test-remote',
				{},
				{ cwd: targetDir, fetchOpts: { cacheDir } }
			)
		).rejects.toMatchObject({ code: 'EBADSCAFFOLD' });
	});

	test('manifest 404 throws EFETCHFAIL', async () => {
		writeSources(projectDir, [source()]);
		setHttpsRoutes({
			'index.json': indexBody(),
			'scaffold.json': { body: 'not found', statusCode: 404 },
		});
		const r = new ScaffoldRegistry({ projectDir });
		await r.scan(scanOpts());
		await expect(
			r.execute(
				'ci/test-remote',
				{},
				{ cwd: targetDir, fetchOpts: { cacheDir } }
			)
		).rejects.toMatchObject({ code: 'EFETCHFAIL', statusCode: 404 });
	});

	test('index checksum is verified against the fetched manifest', async () => {
		const crypto = require('crypto');
		const body = manifest();
		const goodSum = crypto.createHash('sha256').update(body).digest('hex');
		writeSources(projectDir, [source()]);
		setHttpsRoutes({
			'index.json': indexBody([
				indexEntry({ checksum: `sha256:${goodSum}` }),
			]),
			'scaffold.json': body,
			'a.mustache': 'content: rendered',
		});
		const r = new ScaffoldRegistry({ projectDir });
		await r.scan(scanOpts());
		const result = await r.execute(
			'ci/test-remote',
			{},
			{ cwd: targetDir, fetchOpts: { cacheDir } }
		);
		expect(result.engine.wrote).toEqual(['.github/workflows/a.yml']);
	});

	test('checksum mismatch throws EBADSCAFFOLD before any write', async () => {
		writeSources(projectDir, [source()]);
		setHttpsRoutes({
			'index.json': indexBody([
				indexEntry({ checksum: 'sha256:' + 'a'.repeat(64) }),
			]),
			'scaffold.json': manifest(),
			'a.mustache': 'content: rendered',
		});
		const r = new ScaffoldRegistry({ projectDir });
		await r.scan(scanOpts());
		await expect(
			r.execute(
				'ci/test-remote',
				{},
				{ cwd: targetDir, fetchOpts: { cacheDir } }
			)
		).rejects.toMatchObject({ code: 'EBADSCAFFOLD' });
		expect(
			fssync.existsSync(path.join(targetDir, '.github/workflows/a.yml'))
		).toBe(false);
	});

	test('remote manifest dest escaping --cwd throws EWRITEFAIL', async () => {
		writeSources(projectDir, [source()]);
		setHttpsRoutes({
			'index.json': indexBody(),
			'scaffold.json': manifest({
				files: [{ src: 'a.mustache', dest: '../evil.yml' }],
			}),
			'a.mustache': 'pwned',
		});
		const r = new ScaffoldRegistry({ projectDir });
		await r.scan(scanOpts());
		await expect(
			r.execute(
				'ci/test-remote',
				{},
				{ cwd: targetDir, fetchOpts: { cacheDir } }
			)
		).rejects.toMatchObject({ code: 'EWRITEFAIL', errno: 'EOUTSIDE' });
		expect(
			fssync.existsSync(path.join(path.dirname(targetDir), 'evil.yml'))
		).toBe(false);
	});

	test('dry-run fetches the manifest but not the template, writes nothing', async () => {
		writeSources(projectDir, [source()]);
		const routes = setHttpsRoutes({
			'index.json': indexBody(),
			'scaffold.json': manifest(),
			'a.mustache': 'body',
		});
		const r = new ScaffoldRegistry({ projectDir });
		await r.scan(scanOpts());
		const result = await r.execute(
			'ci/test-remote',
			{},
			{ cwd: targetDir, dryRun: true, fetchOpts: { cacheDir } }
		);
		expect(routes.templateStarts()).toHaveLength(0); // no template fetch
		expect(httpsSpy).toHaveBeenCalledTimes(2); // index + manifest only
		expect(result.engine.wrote).toEqual(['.github/workflows/a.yml']);
		expect(
			fssync.existsSync(path.join(targetDir, '.github/workflows/a.yml'))
		).toBe(false);
	});

	test('parallel template prefetch: 3 templates fetched concurrently', async () => {
		writeSources(projectDir, [source()]);
		const routes = setHttpsRoutes(
			{
				'index.json': indexBody(),
				'scaffold.json': manifest({
					files: [
						{ src: 'a.mustache', dest: '.github/workflows/a.yml' },
						{ src: 'b.mustache', dest: '.github/workflows/b.yml' },
						{ src: 'c.mustache', dest: '.github/workflows/c.yml' },
					],
				}),
				'a.mustache': 'A',
				'b.mustache': 'B',
				'c.mustache': 'C',
			},
			{ delayMs: 30 }
		);
		const r = new ScaffoldRegistry({ projectDir });
		await r.scan(scanOpts());
		await r.execute(
			'ci/test-remote',
			{},
			{ cwd: targetDir, fetchOpts: { cacheDir } }
		);
		expect(routes.templateStarts()).toHaveLength(3);
		expect(routes.maxInFlight()).toBeGreaterThanOrEqual(3);
	});

	test('re-run on an existing dest performs no further fetch (offline-safe)', async () => {
		writeSources(projectDir, [source()]);
		setHttpsRoutes({
			'index.json': indexBody(),
			'scaffold.json': manifest(),
			'a.mustache': 'body',
		});
		const r = new ScaffoldRegistry({ projectDir });
		await r.scan(scanOpts());
		await r.execute(
			'ci/test-remote',
			{},
			{ cwd: targetDir, fetchOpts: { cacheDir } }
		);
		expect(httpsSpy).toHaveBeenCalledTimes(3); // index + manifest + template
		// Same registry + same target: manifest memoised, dest exists.
		const result = await r.execute(
			'ci/test-remote',
			{},
			{ cwd: targetDir, fetchOpts: { cacheDir } }
		);
		expect(httpsSpy).toHaveBeenCalledTimes(3); // unchanged
		expect(result.engine.wrote).toEqual([]);
		expect(result.engine.skipped).toEqual(['.github/workflows/a.yml']);
	});
});
