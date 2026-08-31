/**
 * Integration tests against the BUNDLED scaffold catalogue (scaffolds/),
 * pinning behaviours that span engine + manifest:
 *   - setup/psr4 wiring snippet is valid JSON for multi-segment namespaces
 *     (json-escape derived input)
 *   - wp/cli namespace + tests_namespace discovery grafts the project's
 *     PSR-4 root onto the kind sub-namespace
 *   - wiring targetFile paths are normalised (no `..` segments)
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { ScaffoldRegistry } = require('../../src/scaffolds/registry');

const DEFAULTS_DIR = path.join(__dirname, '..', '..', 'scaffolds');

function makeTmpDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'wp-tooling-bundled-'));
}

// The bundled catalogue is immutable and these tests only dry-run execute(),
// so a single scan is shared across the whole file rather than re-walking the
// tree per test.
let registry;
beforeAll(async () => {
	registry = new ScaffoldRegistry({ defaultsDir: DEFAULTS_DIR });
	await registry.scan();
});

describe('setup/psr4 wiring snippet', () => {
	it('renders a JSON-valid PSR-4 key for a multi-segment namespace', async () => {
		const r = registry;
		const result = await r.execute(
			'setup/psr4',
			{ namespace: 'Acme\\Thing', base_path: 'src' },
			{ dryRun: true, cwd: makeTmpDir() }
		);
		const snippet = result.ai.wiring[0].snippet;
		// The snippet is a composer.json fragment; wrapped in braces it must
		// parse, and the key must be the JSON-encoded namespace + trailing \\.
		const parsed = JSON.parse(`{${snippet}}`);
		expect(parsed.autoload['psr-4']).toEqual({ 'Acme\\Thing\\': 'src/' });
		expect(snippet).toContain('"Acme\\\\Thing\\\\"');
	});
});

describe('wp/cli PSR-4 discovery (grafted sub-namespaces)', () => {
	it('fills namespace and tests_namespace from composer.json, keeping kind sub-namespaces', async () => {
		const r = registry;
		const target = makeTmpDir();
		fs.writeFileSync(
			path.join(target, 'composer.json'),
			JSON.stringify({
				autoload: { 'psr-4': { 'Acme\\Blog\\': 'includes/' } },
			}),
			'utf8'
		);
		const result = await r.execute(
			'wp/cli',
			{ name: 'export-things' },
			{ dryRun: true, cwd: target }
		);
		expect(result.engine.inputs.namespace).toBe('Acme\\Blog\\Cli');
		expect(result.engine.inputs.tests_namespace).toBe(
			'Acme\\Blog\\Tests\\Cli'
		);
		// And the wiring snippet uses the grafted namespace.
		expect(result.ai.wiring[0].snippet).toContain(
			'\\Acme\\Blog\\Cli\\ExportThings::class'
		);
	});
});

describe('wiring targetFile normalisation', () => {
	it('emits a `..`-free targetFile for wp/cli', async () => {
		const r = registry;
		const result = await r.execute(
			'wp/cli',
			{ name: 'export-things' },
			{ dryRun: true, cwd: makeTmpDir() }
		);
		const target = result.ai.wiring[0].targetFile;
		expect(target).toBe('includes/Modules/Cli.php');
		expect(target).not.toContain('..');
	});
});

describe('ci/test-measure rendering', () => {
	it('omits run-a11y by default and includes it when run_a11y is true', async () => {
		const r = registry;
		const off = makeTmpDir();
		await r.execute('ci/test-measure', {}, { dryRun: false, cwd: off });
		const offYaml = fs.readFileSync(
			path.join(off, '.github/workflows/test-measure.yml'),
			'utf8'
		);
		expect(offYaml).not.toContain('run-a11y:');

		const on = makeTmpDir();
		await r.execute(
			'ci/test-measure',
			{ run_a11y: 'true' },
			{ dryRun: false, cwd: on }
		);
		const onYaml = fs.readFileSync(
			path.join(on, '.github/workflows/test-measure.yml'),
			'utf8'
		);
		expect(onYaml).toContain('run-a11y: true');
	});
});

describe('setup/perf rendered config', () => {
	it('renders valid JSON with default page paths and the server layer disabled', async () => {
		const r = registry;
		const target = makeTmpDir();
		await r.execute(
			'setup/perf',
			{ base_url: 'http://localhost:8888', server_env_cwd: '.' },
			{ cwd: target }
		);
		const config = JSON.parse(
			fs.readFileSync(path.join(target, '.perfrc.json'), 'utf8')
		);
		expect(config.urls).toEqual([
			'http://localhost:8888/',
			'http://localhost:8888/?p=1',
			'http://localhost:8888/?s=hello',
		]);
		// webVitals/lighthouse/thresholds/server.shim/server.top are
		// deliberately absent from the rendered file -- config.js's
		// mergeConfig fills them from DEFAULTS at read time, so the scaffold
		// never re-hardcodes a value that could drift from those defaults.
		expect(config.lighthouse).toBeUndefined();
		expect(config.webVitals).toBeUndefined();
		expect(config.server.enabled).toBe(false);
		expect(config.server.command).toEqual([
			'npx',
			'wp-env',
			'run',
			'cli',
			'--env-cwd=.',
			'--',
			'wp',
		]);
	});

	it('renders custom page paths, appends extra_page, and enables the server layer when server_enabled is given', async () => {
		const r = registry;
		const target = makeTmpDir();
		await r.execute(
			'setup/perf',
			{
				base_url: 'http://localhost:8765',
				sample_page: '/hello-world/',
				search_page: '/?s=wordpress',
				extra_page: '/about/',
				server_enabled: 'true',
				server_env_cwd: 'wp-content/plugins/dummy-plugin',
			},
			{ cwd: target }
		);
		const config = JSON.parse(
			fs.readFileSync(path.join(target, '.perfrc.json'), 'utf8')
		);
		expect(config.urls).toEqual([
			'http://localhost:8765/',
			'http://localhost:8765/hello-world/',
			'http://localhost:8765/?s=wordpress',
			'http://localhost:8765/about/',
		]);
		expect(config.server.enabled).toBe(true);
		expect(config.server.command).toEqual([
			'npx',
			'wp-env',
			'run',
			'cli',
			'--env-cwd=wp-content/plugins/dummy-plugin',
			'--',
			'wp',
		]);
	});

	it('enables the server layer at the WordPress root when server_env_cwd is explicitly "."', async () => {
		const r = registry;
		const target = makeTmpDir();
		await r.execute(
			'setup/perf',
			{
				base_url: 'http://localhost:8888',
				server_enabled: 'true',
				server_env_cwd: '.',
			},
			{ cwd: target }
		);
		const config = JSON.parse(
			fs.readFileSync(path.join(target, '.perfrc.json'), 'utf8')
		);
		expect(config.server.enabled).toBe(true);
		expect(config.server.command).toEqual([
			'npx',
			'wp-env',
			'run',
			'cli',
			'--env-cwd=.',
			'--',
			'wp',
		]);
	});

	it('has no safe default for server_env_cwd, since a wrong guess would silently point the server layer at the wrong shim location', async () => {
		const r = registry;
		const target = makeTmpDir();
		await expect(
			r.execute(
				'setup/perf',
				{ base_url: 'http://localhost:8888' },
				{ cwd: target }
			)
		).rejects.toThrow(/server_env_cwd/);
	});

	it('copies the server-profile.php shim verbatim (raw: true, no mustache rendering)', async () => {
		const r = registry;
		const target = makeTmpDir();
		await r.execute(
			'setup/perf',
			{ base_url: 'http://localhost:8888', server_env_cwd: '.' },
			{ cwd: target }
		);
		const shim = fs.readFileSync(
			path.join(target, 'server-profile.php'),
			'utf8'
		);
		const source = fs.readFileSync(
			path.join(
				DEFAULTS_DIR,
				'setup',
				'perf',
				'templates',
				'server-profile.php'
			),
			'utf8'
		);
		expect(shim).toBe(source);
		expect(shim).toContain('\\rtCamp\\WPDevTools\\Support\\XHProfProfiler');
	});
});
