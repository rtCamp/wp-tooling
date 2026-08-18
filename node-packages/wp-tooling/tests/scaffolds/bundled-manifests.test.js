/**
 * Integration tests against the BUNDLED scaffold catalogue (scaffolds/),
 * pinning behaviours that span engine + manifest:
 *   - setup/psr4 wiring snippet is valid JSON for multi-segment namespaces
 *     (json-escape derived input)
 *   - wp/cli namespace + tests_namespace discovery grafts the project's
 *     PSR-4 root onto the kind sub-namespace
 *   - wiring targetFile paths are normalised (no `..` segments)
 *   - wp-api/speculation renders into the registrable layout, reuses the
 *     registrable wiring anchor, and follows a non-`includes/` PSR-4 root
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

describe('wp-api/speculation', () => {
	it('renders into the Services layout and reuses the registrable anchor', async () => {
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
			'wp-api/speculation',
			{ name: 'speculative-loading' },
			{ dryRun: true, cwd: target }
		);
		expect(result.engine.inputs.namespace).toBe('Acme\\Blog\\Services');
		expect(result.engine.inputs.mode).toBe('prerender');
		expect(result.engine.inputs.eagerness).toBe('moderate');
		expect(result.engine.wrote).toEqual([
			'includes/Services/SpeculativeLoading.php',
		]);
		expect(result.ai.tests[0].path).toBe(
			'tests/Services/SpeculativeLoadingTest.php'
		);
		// The generated class IS a Registrable, so it wires into the same
		// module (and the same anchor) as wp/registrable.
		const wiring = result.ai.wiring[0];
		expect(wiring.targetFile).toBe('includes/Modules/Services.php');
		expect(wiring.targetFile).not.toContain('..');
		expect(wiring.anchor).toBe('// scaffold:wp/registrable:classes');
		expect(wiring.snippet).toBe(
			'\\Acme\\Blog\\Services\\SpeculativeLoading::class,'
		);
	});

	it('follows the project PSR-4 root when it is not includes/', async () => {
		// Both consuming repos map their root to `inc/`, so the namespace and
		// the directory have to be grafted from the same map entry — otherwise
		// the class is namespaced `<Root>\Services` but written to
		// `includes/Services`, outside the autoload root.
		const target = makeTmpDir();
		fs.writeFileSync(
			path.join(target, 'composer.json'),
			JSON.stringify({
				autoload: { 'psr-4': { 'Acme\\Blog\\': 'inc/' } },
			}),
			'utf8'
		);
		const result = await registry.execute(
			'wp-api/speculation',
			{ name: 'speculative-loading' },
			{ dryRun: true, cwd: target }
		);
		expect(result.engine.inputs.namespace).toBe('Acme\\Blog\\Services');
		expect(result.engine.wrote).toEqual([
			'inc/Services/SpeculativeLoading.php',
		]);
		const wiringTarget = result.ai.wiring[0].targetFile;
		expect(wiringTarget).toBe('inc/Modules/Services.php');
		expect(wiringTarget).not.toContain('..');
	});
});
