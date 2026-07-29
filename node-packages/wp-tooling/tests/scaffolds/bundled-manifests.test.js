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
