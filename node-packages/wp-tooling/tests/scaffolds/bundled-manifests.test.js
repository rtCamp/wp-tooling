/**
 * Integration tests against the BUNDLED scaffold catalogue (scaffolds/),
 * pinning behaviours that span engine + manifest:
 *   - setup/psr4 wiring snippet is valid JSON for multi-segment namespaces
 *     (json-escape derived input)
 *   - wp/cli namespace + tests_namespace discovery grafts the project's
 *     PSR-4 root onto the kind sub-namespace
 *   - wiring targetFile paths are normalised (no `..` segments)
 *   - utility/* are source: package — zero files, a Composer dep and one
 *     accessor snippet, with context_slug discovered from composer.json:name
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

// [id, framework class basename]
const UTILITY = [
	['utility/cache', 'Cache'],
	['utility/transients', 'Transients'],
	['utility/logger', 'Logger'],
	['utility/timer', 'Timer'],
	['utility/feature-selector', 'FeatureSelector'],
];

// Target dir carrying the demo skeleton's package name, so context_slug
// discovery has something to resolve.
function targetWithComposerName(name = 'rtcamp/project-name-features') {
	const target = makeTmpDir();
	fs.writeFileSync(
		path.join(target, 'composer.json'),
		JSON.stringify({ name }),
		'utf8'
	);
	return target;
}

describe('utility/* package scaffolds', () => {
	it.each(UTILITY)(
		'%s writes nothing and reports the dep plus one accessor snippet',
		async (id, className) => {
			const result = await registry.execute(
				id,
				{},
				{ dryRun: true, cwd: targetWithComposerName() }
			);

			expect(result.scaffold.kind).toBe('package');
			expect(result.engine.wrote).toEqual([]);
			expect(result.engine.skipped).toEqual([]);
			expect(result.ai.tests).toEqual([]);
			expect(result.developer.secrets).toEqual([]);
			expect(result.developer.install.composer).toEqual({
				'rtcamp/wp-framework': '^1.0',
			});

			expect(result.ai.wiring).toHaveLength(1);
			const w = result.ai.wiring[0];
			expect(w.anchor).toBe(`// scaffold:${id}`);
			expect(w.targetFile).toBe('includes/Helpers/Util.php');
			expect(w.targetFile).not.toContain('..');
			expect(w.snippet).toContain(
				`\\rtCamp\\WPFramework\\Utils\\${className}`
			);
			// The engine passes `description` through verbatim, so it must not
			// carry a placeholder that would reach the caller unresolved.
			expect(w.description).not.toContain('{{');
		}
	);

	it('discovers context_slug from composer.json:name, snake-cased', async () => {
		const result = await registry.execute(
			'utility/cache',
			{},
			{ dryRun: true, cwd: targetWithComposerName() }
		);
		expect(result.engine.inputs.context_slug).toBe(
			'rtcamp_project_name_features'
		);
		expect(result.ai.wiring[0].snippet).toContain(
			"new \\rtCamp\\WPFramework\\Utils\\Cache( 'rtcamp_project_name_features' )"
		);
	});

	it('prefers a supplied context_slug over the discovered one', async () => {
		const result = await registry.execute(
			'utility/transients',
			{ context_slug: 'acme_blog' },
			{ dryRun: true, cwd: targetWithComposerName() }
		);
		expect(result.engine.inputs.context_slug).toBe('acme_blog');
		expect(result.ai.wiring[0].snippet).toContain("( 'acme_blog' )");
	});

	it('falls back to the default slug when there is no composer.json', async () => {
		const result = await registry.execute(
			'utility/logger',
			{},
			{ dryRun: true, cwd: makeTmpDir() }
		);
		expect(result.engine.inputs.context_slug).toBe('my_plugin');
	});

	it('honours a base_path override in the wiring target', async () => {
		const result = await registry.execute(
			'utility/cache',
			{ base_path: 'inc' },
			{ dryRun: true, cwd: targetWithComposerName() }
		);
		expect(result.ai.wiring[0].targetFile).toBe('inc/Helpers/Util.php');
	});

	it('constructs Timer with no argument — it takes no context', async () => {
		const result = await registry.execute(
			'utility/timer',
			{},
			{ dryRun: true, cwd: targetWithComposerName() }
		);
		const snippet = result.ai.wiring[0].snippet;
		expect(snippet).toContain('new \\rtCamp\\WPFramework\\Utils\\Timer()');
		expect(snippet).not.toContain('rtcamp_project_name_features');
	});
});
