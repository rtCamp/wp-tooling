/**
 * Tests for src/scaffolds/validate.js.
 *
 * Covers required-field detection, enum validation, regex patterns,
 * and all four manifest extensions (inputs, wiring, tests, secrets).
 */

'use strict';

const { validate } = require('../../src/scaffolds/validate');

const baseValid = () => ({
	slug: 'cli',
	name: 'CLI',
	description: 'Adds a CLI command.',
	source: 'template',
	files: [{ src: 'a.mustache', dest: 'a.php' }],
});

describe('validate base scaffold', () => {
	it('accepts a minimal valid scaffold', () => {
		expect(validate(baseValid())).toEqual([]);
	});

	it('rejects non-objects', () => {
		expect(validate(null)[0]).toMatch(/must be a JSON object/);
		expect(validate([])[0]).toMatch(/must be a JSON object/);
		expect(validate('x')[0]).toMatch(/must be a JSON object/);
	});

	it('reports missing required fields', () => {
		const errors = validate({});
		expect(errors).toEqual(
			expect.arrayContaining([
				"missing required field 'slug'",
				"missing required field 'name'",
				"missing required field 'description'",
				"missing required field 'source'",
				"missing required field 'files'",
			])
		);
	});

	it('rejects unknown top-level fields', () => {
		const errors = validate({ ...baseValid(), bogus: 1 });
		expect(errors).toEqual(
			expect.arrayContaining(["unknown top-level field 'bogus'"])
		);
	});

	it('rejects malformed slug', () => {
		const errors = validate({ ...baseValid(), slug: 'NotKebab' });
		expect(errors[0]).toMatch(/slug: must match pattern/);
	});

	it('accepts optional category in kebab-case', () => {
		expect(validate({ ...baseValid(), category: 'wp' })).toEqual([]);
	});

	it('accepts nested category with slashes (e.g. lint/phpcs)', () => {
		expect(validate({ ...baseValid(), category: 'lint/phpcs' })).toEqual(
			[]
		);
	});

	it('rejects unknown source value', () => {
		const errors = validate({ ...baseValid(), source: 'magic' });
		expect(errors[0]).toMatch(/source: must be one of/);
	});

	it('rejects unknown wizard_step value', () => {
		const errors = validate({ ...baseValid(), wizard_step: 'bogus' });
		expect(errors[0]).toMatch(/wizard_step: must be one of/);
	});
});

describe('validate files block', () => {
	it('rejects non-array files', () => {
		const errors = validate({ ...baseValid(), files: 'nope' });
		expect(errors).toContain('files: must be an array');
	});

	it('rejects entry missing src', () => {
		const errors = validate({ ...baseValid(), files: [{ dest: 'a.php' }] });
		expect(errors[0]).toMatch(
			/files\[0\]\.src: must be a non-empty string/
		);
	});

	it('accepts empty files array (source: package case)', () => {
		expect(
			validate({
				...baseValid(),
				source: 'package',
				files: [],
				module_class: 'Foo\\Bar',
			})
		).toEqual([]);
	});
});

describe('validate inputs block', () => {
	it('accepts a full inputs entry', () => {
		expect(
			validate({
				...baseValid(),
				inputs: [
					{ key: 'name', description: 'Slug', required: true },
					{
						key: 'class',
						description: 'Class',
						discover_from: 'input:name',
						transform: 'pascal-case',
					},
				],
			})
		).toEqual([]);
	});

	it('rejects uppercase input key', () => {
		const errors = validate({
			...baseValid(),
			inputs: [{ key: 'Name', description: 'X' }],
		});
		expect(errors[0]).toMatch(/inputs\[0\]\.key: must match pattern/);
	});

	it('rejects duplicate input keys', () => {
		const errors = validate({
			...baseValid(),
			inputs: [
				{ key: 'name', description: 'A' },
				{ key: 'name', description: 'B' },
			],
		});
		expect(errors).toContain("inputs[1].key: duplicate key 'name'");
	});

	it('rejects invalid transform value', () => {
		const errors = validate({
			...baseValid(),
			inputs: [
				{ key: 'name', description: 'X', transform: 'PascalCase' },
			],
		});
		expect(errors[0]).toMatch(/inputs\[0\]\.transform: must be one of/);
	});
});

describe('validate wiring block', () => {
	it('accepts a wiring entry', () => {
		expect(
			validate({
				...baseValid(),
				wiring: [
					{
						target_file: 'includes/Plugin.php',
						anchor: '// scaffold:cli',
						snippet_template: '$x;',
						description: 'desc',
					},
				],
			})
		).toEqual([]);
	});

	it('accepts a wiring entry with no anchor (anchor is advisory per the AI contract)', () => {
		const errors = validate({
			...baseValid(),
			wiring: [{ target_file: 'x.php', snippet_template: 'y;' }],
		});
		expect(errors.filter((e) => e.includes('wiring'))).toEqual([]);
	});

	it('rejects a wiring entry whose anchor is an empty string', () => {
		const errors = validate({
			...baseValid(),
			wiring: [
				{ target_file: 'x.php', snippet_template: 'y;', anchor: '' },
			],
		});
		expect(errors[0]).toMatch(
			/wiring\[0\]\.anchor: must be a non-empty string when present/
		);
	});

	it('rejects a wiring entry missing snippet_template', () => {
		const errors = validate({
			...baseValid(),
			wiring: [{ target_file: 'x.php' }],
		});
		expect(errors[0]).toMatch(
			/wiring\[0\]\.snippet_template: must be a non-empty string/
		);
	});
});

describe('validate tests block', () => {
	it('accepts a tests entry', () => {
		expect(
			validate({
				...baseValid(),
				tests: [
					{ src: 'a.mustache', dest: 'a.php', framework: 'phpunit' },
				],
			})
		).toEqual([]);
	});

	it('rejects unknown framework', () => {
		const errors = validate({
			...baseValid(),
			tests: [{ src: 'a', dest: 'b', framework: 'mocha' }],
		});
		expect(errors[0]).toMatch(/tests\[0\]\.framework: must be one of/);
	});

	it('accepts actionlint for YAML', () => {
		expect(
			validate({
				...baseValid(),
				tests: [
					{ src: 'a.yml', dest: 'b.yml', framework: 'actionlint' },
				],
			})
		).toEqual([]);
	});
});

describe('validate secrets block', () => {
	it('accepts a secrets entry', () => {
		expect(
			validate({
				...baseValid(),
				secrets: [
					{
						key: 'WPORG_USERNAME',
						scope: 'github-actions',
						description: 'X',
					},
				],
			})
		).toEqual([]);
	});

	it('rejects lowercase secret key', () => {
		const errors = validate({
			...baseValid(),
			secrets: [
				{ key: 'wporg', scope: 'github-actions', description: 'X' },
			],
		});
		expect(errors[0]).toMatch(/secrets\[0\]\.key: must match pattern/);
	});

	it('rejects unknown scope', () => {
		const errors = validate({
			...baseValid(),
			secrets: [{ key: 'X', scope: 'kubernetes', description: 'Y' }],
		});
		expect(errors[0]).toMatch(/secrets\[0\]\.scope: must be one of/);
	});

	it('rejects extra fields (no value smuggling)', () => {
		const errors = validate({
			...baseValid(),
			secrets: [
				{ key: 'X', scope: 'env', description: 'D', value: 'leaked' },
			],
		});
		expect(errors[0]).toMatch(/secrets\[0\]: unknown field 'value'/);
	});
});

describe('validate scripts block', () => {
	it('accepts npm-only scripts', () => {
		expect(
			validate({
				...baseValid(),
				scripts: { npm: { 'lint:js': 'eslint .' } },
			})
		).toEqual([]);
	});

	it('accepts composer-only scripts', () => {
		expect(
			validate({
				...baseValid(),
				scripts: { composer: { 'lint:php': 'phpcs' } },
			})
		).toEqual([]);
	});

	it('accepts both targets', () => {
		expect(
			validate({
				...baseValid(),
				scripts: {
					npm: { 'lint:js': 'eslint .' },
					composer: { 'lint:php': 'phpcs' },
				},
			})
		).toEqual([]);
	});

	it('rejects unknown script target', () => {
		const errors = validate({
			...baseValid(),
			scripts: { yarn: { 'lint:js': 'eslint .' } },
		});
		expect(errors[0]).toMatch(/scripts: unknown target 'yarn'/);
	});

	it('rejects non-string command', () => {
		const errors = validate({
			...baseValid(),
			scripts: { npm: { 'lint:js': 42 } },
		});
		expect(errors[0]).toMatch(
			/scripts\.npm\['lint:js'\]: must be a non-empty string/
		);
	});

	it('rejects non-object map per target', () => {
		const errors = validate({
			...baseValid(),
			scripts: { npm: 'eslint .' },
		});
		expect(errors[0]).toMatch(/scripts\.npm: must be an object/);
	});
});

describe('validate dependency maps', () => {
	it('accepts a composer dependency map', () => {
		expect(
			validate({
				...baseValid(),
				composer_dependencies: { 'rtcamp/wp-php-toolkit': '^1.0' },
			})
		).toEqual([]);
	});

	it('rejects non-string version', () => {
		const errors = validate({
			...baseValid(),
			composer_dependencies: { 'foo/bar': 1 },
		});
		expect(errors[0]).toMatch(
			/composer_dependencies\['foo\/bar'\]: version must be a string/
		);
	});
});

// ---------------------------------------------------------------------------
// CLI surface (runCli) — `wp-tooling validate [scaffold-id...] [flags]`
// ---------------------------------------------------------------------------

const fssync = require('fs');
const os = require('os');
const path = require('path');

const { runCli, validateOne } = require('../../src/scaffolds/validate');

describe('validate rejects the removed repository field', () => {
	it("treats 'repository' as an unknown top-level field", () => {
		const errors = validate({
			...baseValid(),
			repository: {
				repository: 'rtCamp/wp-shared-workflows',
				ref: 'v1',
				path: 'scaffolds/ci/test-php',
			},
		});
		expect(errors).toContain("unknown top-level field 'repository'");
	});

	it("rejects source: 'repository' (no longer an allowed source)", () => {
		const errors = validate({ ...baseValid(), source: 'repository' });
		expect(errors[0]).toMatch(/source: must be one of/);
	});
});

function makeOnDiskScaffold(scaffoldJson) {
	const dir = fssync.mkdtempSync(
		path.join(os.tmpdir(), 'wp-tooling-validate-disk-')
	);
	const file = path.join(dir, 'scaffold.json');
	fssync.writeFileSync(file, JSON.stringify(scaffoldJson), 'utf8');
	return { dir, file };
}

describe('validateOne on-disk checks', () => {
	test('source: template still reports missing files', () => {
		const { dir, file } = makeOnDiskScaffold({
			slug: 'local',
			category: 'wp',
			name: 'Local',
			description: 'fixture',
			source: 'template',
			files: [{ src: 'not-on-disk.mustache', dest: 'a.php' }],
		});
		try {
			const result = validateOne(file);
			expect(result.valid).toBe(false);
			expect(
				result.errors.some((e) => /template not found on disk/.test(e))
			).toBe(true);
		} finally {
			fssync.rmSync(dir, { recursive: true, force: true });
		}
	});
});

function makeTmpDir() {
	return fssync.mkdtempSync(path.join(os.tmpdir(), 'wp-tooling-validate-'));
}

async function withStdoutCapture(fn) {
	let captured = '';
	// eslint-disable-next-line @wordpress/no-unused-vars-before-return -- needed for finally{} restore.
	const original = process.stdout.write.bind(process.stdout);
	process.stdout.write = (chunk) => {
		captured += chunk;
		return true;
	};
	try {
		const code = await fn();
		return { code, stdout: captured };
	} finally {
		process.stdout.write = original;
	}
}

async function withStderrCapture(fn) {
	let captured = '';
	// eslint-disable-next-line @wordpress/no-unused-vars-before-return -- needed for finally{} restore.
	const original = process.stderr.write.bind(process.stderr);
	process.stderr.write = (chunk) => {
		captured += chunk;
		return true;
	};
	try {
		const code = await fn();
		return { code, stderr: captured };
	} finally {
		process.stderr.write = original;
	}
}

describe('validate runCli', () => {
	it('exits 0 on --help and prints usage', async () => {
		const { code, stdout } = await withStdoutCapture(() =>
			runCli(['--help'])
		);
		expect(code).toBe(0);
		expect(stdout).toContain('Usage: wp-tooling validate');
	});

	it('validates the whole bundled catalogue with exit 0', async () => {
		const { code, stdout } = await withStdoutCapture(() => runCli([]));
		expect(code).toBe(0);
		expect(stdout).toMatch(/Total: \d+  valid: \d+  invalid: 0/);
	});

	it('filters by single scaffold id', async () => {
		const { code, stdout } = await withStdoutCapture(() =>
			runCli(['wp/cli'])
		);
		expect(code).toBe(0);
		expect(stdout).toMatch(/ok\s+wp\/cli/);
		expect(stdout).toMatch(/Total: 1/);
	});

	it('exits 1 on unknown scaffold id with available list', async () => {
		const { code, stderr } = await withStderrCapture(() =>
			runCli(['no/such'])
		);
		expect(code).toBe(1);
		expect(stderr).toMatch(/No scaffolds matched: no\/such/);
		expect(stderr).toMatch(/Available ids:/);
	});

	it('--json emits machine-readable results', async () => {
		const { code, stdout } = await withStdoutCapture(() =>
			runCli(['wp/cli', '--json'])
		);
		expect(code).toBe(0);
		const parsed = JSON.parse(stdout.trim());
		expect(parsed.results).toHaveLength(1);
		expect(parsed.results[0].id).toBe('wp/cli');
		expect(parsed.results[0].valid).toBe(true);
	});

	it('--json emits structured error for unknown id on stderr', async () => {
		const { code, stderr } = await withStderrCapture(() =>
			runCli(['no/such', '--json'])
		);
		expect(code).toBe(1);
		const parsed = JSON.parse(stderr.trim());
		expect(parsed.code).toBe('ENOSCAFFOLD');
		expect(Array.isArray(parsed.available)).toBe(true);
	});

	it('includes project-local scaffolds when --cwd is set', async () => {
		const cwd = makeTmpDir();
		const localDir = path.join(cwd, 'bin', 'scaffolds', 'custom', 'thing');
		fssync.mkdirSync(localDir, { recursive: true });
		fssync.writeFileSync(
			path.join(localDir, 'scaffold.json'),
			JSON.stringify({
				slug: 'thing',
				category: 'custom',
				name: 'Thing',
				description: 'A custom thing.',
				source: 'package',
				files: [],
			}),
			'utf8'
		);
		const { code, stdout } = await withStdoutCapture(() =>
			runCli(['custom/thing', '--cwd', cwd])
		);
		expect(code).toBe(0);
		expect(stdout).toMatch(/ok\s+custom\/thing/);
	});

	it('rejects unknown flags', async () => {
		const { code, stderr } = await withStderrCapture(() =>
			runCli(['--bogus'])
		);
		expect(code).toBe(1);
		expect(stderr).toMatch(/Unexpected flag: --bogus/);
	});

	function writeProjectSources(cwd, sources) {
		const dir = path.join(cwd, 'bin', 'scaffolds');
		fssync.mkdirSync(dir, { recursive: true });
		fssync.writeFileSync(
			path.join(dir, 'sources.json'),
			JSON.stringify({ sources }),
			'utf8'
		);
	}

	const remoteSource = (overrides = {}) => ({
		repository: 'rtCamp/wp-shared-workflows',
		ref: 'v1',
		path: 'scaffolds',
		...overrides,
	});

	it('validates a valid project sources file (offline, no fetch)', async () => {
		const cwd = makeTmpDir();
		writeProjectSources(cwd, [remoteSource()]);
		const { code, stdout } = await withStdoutCapture(() =>
			runCli(['--cwd', cwd])
		);
		expect(code).toBe(0);
		expect(stdout).toMatch(/ok\s+sources/);
	});

	it('fails when a source has a bad repository slug', async () => {
		const cwd = makeTmpDir();
		writeProjectSources(cwd, [remoteSource({ repository: 'no-slash' })]);
		const { code, stdout } = await withStdoutCapture(() =>
			runCli(['--cwd', cwd])
		);
		expect(code).toBe(1);
		expect(stdout).toMatch(/must match 'owner\/repo'/);
	});
});

// ---------------------------------------------------------------------------
// validate --remote — fetch the repo index + schema-validate each manifest at
// its pin. Default validate is offline (sources shape + any cached index);
// only --remote touches the network. node:https is mocked as in registry.test.js.
// ---------------------------------------------------------------------------

describe('validate --remote (sources + index)', () => {
	const { EventEmitter } = require('events');
	const https = require('https');

	let httpsSpy;

	// Route value may be a string (200) or `{ body, statusCode }`.
	function setHttpsRoutes(routes) {
		httpsSpy = jest
			.spyOn(https, 'get')
			.mockImplementation((url, options, cb) => {
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
				res.statusCode =
					spec && typeof spec === 'object' && spec.statusCode
						? spec.statusCode
						: 200;
				res.headers = {};
				process.nextTick(() => {
					cb(res);
					res.emit('data', body);
					res.emit('end');
				});
				return req;
			});
	}

	function writeProjectSources(cwd, sources) {
		const dir = path.join(cwd, 'bin', 'scaffolds');
		fssync.mkdirSync(dir, { recursive: true });
		fssync.writeFileSync(
			path.join(dir, 'sources.json'),
			JSON.stringify({ sources }),
			'utf8'
		);
	}

	const remoteSource = (overrides = {}) => ({
		repository: 'rtCamp/wp-shared-workflows',
		ref: 'v1',
		path: 'scaffolds',
		...overrides,
	});

	const indexBody = (entries) =>
		JSON.stringify({
			scaffolds: entries || [
				{
					id: 'ci/remote-thing',
					path: 'ci/remote-thing',
					name: 'Remote Thing',
					description: 'a remote scaffold',
				},
			],
		});

	const manifest = (overrides = {}) =>
		JSON.stringify({
			slug: 'remote-thing',
			category: 'ci',
			name: 'Remote Thing',
			description: 'a remote scaffold',
			source: 'template',
			files: [{ src: 'a.mustache', dest: '.github/workflows/a.yml' }],
			...overrides,
		});

	let cwd;
	let cacheDir;

	beforeEach(() => {
		cwd = makeTmpDir();
		cacheDir = makeTmpDir();
		jest.restoreAllMocks();
	});

	afterEach(() => {
		for (const d of [cwd, cacheDir]) {
			fssync.rmSync(d, { recursive: true, force: true });
		}
	});

	it('default validate (no --remote, no cache) makes no network call', async () => {
		setHttpsRoutes({
			'index.json': indexBody(),
			'scaffold.json': manifest(),
		});
		writeProjectSources(cwd, [remoteSource()]);
		const { code } = await withStdoutCapture(() =>
			runCli(['--cwd', cwd, '--cache-dir', cacheDir])
		);
		expect(code).toBe(0);
		expect(httpsSpy).not.toHaveBeenCalled();
	});

	it('recognises a remote id offline from a cached index', async () => {
		setHttpsRoutes({
			'index.json': indexBody(),
			'scaffold.json': manifest(),
		});
		writeProjectSources(cwd, [remoteSource()]);
		// Warm the index cache with a --remote pass.
		await withStdoutCapture(() =>
			runCli(['--remote', '--cwd', cwd, '--cache-dir', cacheDir])
		);
		const warmed = httpsSpy.mock.calls.length;
		const { code, stdout } = await withStdoutCapture(() =>
			runCli([
				'ci/remote-thing',
				'--cwd',
				cwd,
				'--cache-dir',
				cacheDir,
				'--json',
			])
		);
		expect(code).toBe(0);
		const row = JSON.parse(stdout.trim()).results.find(
			(r) => r.id === 'ci/remote-thing'
		);
		expect(row).toBeDefined();
		expect(row.remote).toBe(true);
		expect(row.valid).toBe(true);
		expect(httpsSpy.mock.calls.length).toBe(warmed); // offline: no new calls
	});

	it('--remote fetches the index + schema-validates a sound manifest (ok)', async () => {
		setHttpsRoutes({
			'index.json': indexBody(),
			'scaffold.json': manifest(),
		});
		writeProjectSources(cwd, [remoteSource()]);
		const { code, stdout } = await withStdoutCapture(() =>
			runCli([
				'ci/remote-thing',
				'--remote',
				'--cwd',
				cwd,
				'--cache-dir',
				cacheDir,
			])
		);
		expect(code).toBe(0);
		expect(httpsSpy).toHaveBeenCalledTimes(2); // index + manifest
		expect(stdout).toMatch(/ok\s+ci\/remote-thing \(remote\)/);
	});

	it('--remote fails a manifest whose checksum mismatches the index', async () => {
		setHttpsRoutes({
			'index.json': indexBody([
				{
					id: 'ci/remote-thing',
					path: 'ci/remote-thing',
					name: 'Remote Thing',
					description: 'a remote scaffold',
					checksum: 'sha256:' + 'a'.repeat(64),
				},
			]),
			'scaffold.json': manifest(),
		});
		writeProjectSources(cwd, [remoteSource()]);
		const { code, stdout } = await withStdoutCapture(() =>
			runCli([
				'ci/remote-thing',
				'--remote',
				'--json',
				'--cwd',
				cwd,
				'--cache-dir',
				cacheDir,
			])
		);
		expect(code).toBe(1);
		const row = JSON.parse(stdout.trim()).results.find(
			(r) => r.id === 'ci/remote-thing' && r.remote
		);
		expect(row.valid).toBe(false);
		expect(row.errors.join('\n')).toMatch(/checksum mismatch/i);
	});

	it('--remote surfaces EFETCHFAIL when the manifest 404s', async () => {
		setHttpsRoutes({
			'index.json': indexBody(),
			'scaffold.json': { body: 'not found', statusCode: 404 },
		});
		writeProjectSources(cwd, [remoteSource()]);
		const { code, stdout } = await withStdoutCapture(() =>
			runCli([
				'ci/remote-thing',
				'--remote',
				'--cwd',
				cwd,
				'--cache-dir',
				cacheDir,
			])
		);
		expect(code).toBe(1);
		expect(stdout).toMatch(/FAIL\s+ci\/remote-thing \(remote\)/);
		expect(stdout).toMatch(/EFETCHFAIL/);
	});

	it('--remote reports schema errors from a fetched-but-invalid manifest', async () => {
		setHttpsRoutes({
			'index.json': indexBody(),
			'scaffold.json': JSON.stringify({ slug: 'remote-thing' }),
		});
		writeProjectSources(cwd, [remoteSource()]);
		const { code, stdout } = await withStdoutCapture(() =>
			runCli([
				'ci/remote-thing',
				'--remote',
				'--json',
				'--cwd',
				cwd,
				'--cache-dir',
				cacheDir,
			])
		);
		expect(code).toBe(1);
		const row = JSON.parse(stdout.trim()).results.find(
			(r) => r.id === 'ci/remote-thing'
		);
		expect(row.valid).toBe(false);
		expect(row.errors.join('\n')).toMatch(
			/remote manifest .*missing required field/
		);
	});

	it('--remote flags a remote id colliding with a local scaffold', async () => {
		const localDir = path.join(
			cwd,
			'bin',
			'scaffolds',
			'ci',
			'remote-thing'
		);
		fssync.mkdirSync(localDir, { recursive: true });
		fssync.writeFileSync(
			path.join(localDir, 'scaffold.json'),
			JSON.stringify({
				slug: 'remote-thing',
				category: 'ci',
				name: 'Local',
				description: 'local',
				source: 'package',
				files: [],
			}),
			'utf8'
		);
		setHttpsRoutes({ 'index.json': indexBody() });
		writeProjectSources(cwd, [remoteSource()]);
		const { code, stdout } = await withStdoutCapture(() =>
			runCli([
				'ci/remote-thing',
				'--remote',
				'--json',
				'--cwd',
				cwd,
				'--cache-dir',
				cacheDir,
			])
		);
		expect(code).toBe(1);
		const row = JSON.parse(stdout.trim()).results.find(
			(r) => r.id === 'ci/remote-thing' && r.remote
		);
		expect(row.valid).toBe(false);
		expect(row.errors.join('\n')).toMatch(/collides with a local scaffold/);
	});
});
