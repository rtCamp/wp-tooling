/**
 * Integration tests against the BUNDLED scaffold catalogue (scaffolds/),
 * pinning behaviours that span engine + manifest:
 *   - setup/psr4 wiring snippet is valid JSON for multi-segment namespaces
 *     (json-escape derived input)
 *   - wp/cli namespace + tests_namespace discovery grafts the project's
 *     PSR-4 root onto the kind sub-namespace
 *   - wiring targetFile paths are normalised (no `..` segments)
 *   - wp-api/speculation renders into the registrable layout, reuses the
 *     registrable wiring anchor, follows a non-`includes/` PSR-4 root, and
 *     rejects an out-of-enum mode/eagerness
 *   - the modern WP API scaffolds (wp/block-interactive, wp-api/block-bindings,
 *     wp-api/script-module) render every file of their layout, in order, and
 *     reuse an existing wiring anchor rather than minting a new one
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

	it('throws EINVALIDINPUT for a mode core would not accept', async () => {
		const err = await registry
			.execute(
				'wp-api/speculation',
				{ name: 'speculative-loading', mode: 'prender' },
				{ dryRun: true, cwd: makeTmpDir() }
			)
			.then(
				() => {
					throw new Error('should have thrown');
				},
				(caught) => caught
			);
		expect(err.code).toBe('EINVALIDINPUT');
		expect(err.invalid).toEqual([
			{
				key: 'mode',
				value: 'prender',
				allowed: ['auto', 'prefetch', 'prerender'],
			},
		]);
	});
});

describe('wp/block-interactive', () => {
	it('renders the block directory plus a registrar, reusing the block anchor', async () => {
		const target = makeTmpDir();
		fs.writeFileSync(
			path.join(target, 'composer.json'),
			JSON.stringify({
				autoload: { 'psr-4': { 'Acme\\Blog\\': 'includes/' } },
			}),
			'utf8'
		);
		const result = await registry.execute(
			'wp/block-interactive',
			{ slug: 'faq-accordion', title: 'FAQ Accordion' },
			{ dryRun: true, cwd: target }
		);
		expect(result.engine.inputs.namespace).toBe('Acme\\Blog\\Blocks');
		expect(result.engine.inputs.class).toBe('FaqAccordion');
		// render.php must land at `<blocks_dir>/<slug>/render.php`: the rtCamp
		// PHPCS ruleset exempts exactly that path from the file-header and
		// text-domain sniffs a block render file cannot satisfy.
		expect(result.engine.wrote).toEqual([
			'includes/Blocks/FaqAccordion.php',
			'src/blocks/faq-accordion/block.json',
			'src/blocks/faq-accordion/index.js',
			'src/blocks/faq-accordion/edit.js',
			'src/blocks/faq-accordion/render.php',
			'src/blocks/faq-accordion/view.js',
		]);
		// An interactive block is still a block: it shares the Blocks module,
		// and its anchor, with wp/block-dynamic instead of minting a new one.
		const wiring = result.ai.wiring[0];
		expect(wiring.targetFile).toBe('includes/Modules/Blocks.php');
		expect(wiring.targetFile).not.toContain('..');
		expect(wiring.anchor).toBe('// scaffold:wp/block-dynamic:classes');
		expect(wiring.snippet).toBe(
			'\\Acme\\Blog\\Blocks\\FaqAccordion::class,'
		);
	});

	it('follows the project PSR-4 root when it is not includes/', async () => {
		const target = makeTmpDir();
		fs.writeFileSync(
			path.join(target, 'composer.json'),
			JSON.stringify({
				autoload: { 'psr-4': { 'Acme\\Blog\\': 'inc/' } },
			}),
			'utf8'
		);
		const result = await registry.execute(
			'wp/block-interactive',
			{ slug: 'faq-accordion', title: 'FAQ Accordion' },
			{ dryRun: true, cwd: target }
		);
		// Only the PHP class follows the PSR-4 root; the block sources are
		// build inputs, not autoloaded code, so they stay under blocks_dir.
		expect(result.engine.wrote[0]).toBe('inc/Blocks/FaqAccordion.php');
		expect(result.engine.wrote[1]).toBe(
			'src/blocks/faq-accordion/block.json'
		);
		expect(result.ai.wiring[0].targetFile).toBe('inc/Modules/Blocks.php');
	});
});

describe('wp-api/block-bindings', () => {
	it('renders a Services class and derives the source name from name', async () => {
		const target = makeTmpDir();
		fs.writeFileSync(
			path.join(target, 'composer.json'),
			JSON.stringify({
				autoload: { 'psr-4': { 'Acme\\Blog\\': 'inc/' } },
			}),
			'utf8'
		);
		const result = await registry.execute(
			'wp-api/block-bindings',
			{ name: 'Product Price', label: 'Product price' },
			{ dryRun: true, cwd: target }
		);
		expect(result.engine.inputs.class).toBe('ProductPrice');
		expect(result.engine.inputs.source_slug).toBe('product-price');
		expect(result.engine.wrote).toEqual(['inc/Services/ProductPrice.php']);
		expect(result.ai.tests[0].path).toBe(
			'tests/Services/ProductPriceTest.php'
		);
		const wiring = result.ai.wiring[0];
		expect(wiring.targetFile).toBe('inc/Modules/Services.php');
		expect(wiring.anchor).toBe('// scaffold:wp/registrable:classes');
	});
});

describe('wp-api/script-module', () => {
	it('renders the module source next to its registration class', async () => {
		const target = makeTmpDir();
		fs.writeFileSync(
			path.join(target, 'composer.json'),
			JSON.stringify({
				autoload: { 'psr-4': { 'Acme\\Blog\\': 'inc/' } },
			}),
			'utf8'
		);
		const result = await registry.execute(
			'wp-api/script-module',
			{ name: 'lightbox' },
			{ dryRun: true, cwd: target }
		);
		expect(result.engine.inputs.module_slug).toBe('lightbox');
		expect(result.engine.inputs.enqueue_hook).toBe('wp_enqueue_scripts');
		expect(result.engine.wrote).toEqual([
			'inc/Services/Lightbox.php',
			'src/js/modules/lightbox.js',
		]);
		expect(result.ai.wiring[0].anchor).toBe(
			'// scaffold:wp/registrable:classes'
		);
	});

	it('rejects an enqueue hook outside the declared enum', async () => {
		const err = await registry
			.execute(
				'wp-api/script-module',
				{ name: 'lightbox', enqueue_hook: 'admin_enqueue_scripts' },
				{ dryRun: true, cwd: makeTmpDir() }
			)
			.then(
				() => {
					throw new Error('should have thrown');
				},
				(caught) => caught
			);
		expect(err.code).toBe('EINVALIDINPUT');
		expect(err.invalid).toEqual([
			{
				key: 'enqueue_hook',
				value: 'admin_enqueue_scripts',
				allowed: ['wp_enqueue_scripts', 'enqueue_block_assets'],
			},
		]);
	});
});
