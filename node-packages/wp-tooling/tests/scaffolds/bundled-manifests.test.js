/**
 * Integration tests against the BUNDLED scaffold catalogue (scaffolds/),
 * pinning behaviours that span engine + manifest:
 *   - setup/psr4 wiring snippet is valid JSON for multi-segment namespaces
 *     (json-escape derived input)
 *   - wp/cli namespace + tests_namespace discovery grafts the project's
 *     PSR-4 root onto the kind sub-namespace
 *   - wiring targetFile paths are normalised (no `..` segments), and a
 *     target that still escapes the project is dropped with a warning
 *   - wp-api/speculation renders into the registrable layout, reuses the
 *     registrable wiring anchor, follows a non-`includes/` PSR-4 root, and
 *     rejects an out-of-enum mode/eagerness
 *   - the modern WP API scaffolds (wp/block-interactive, wp-api/block-bindings,
 *     wp-api/script-module) render every file of their layout, in order, and
 *     reuse an existing wiring anchor rather than minting a new one
 *   - the VIP integration scaffolds (integration/vip-*) declare their lens,
 *     derive every prefixed name from the project's text domain, reuse the
 *     wiring anchor of the primitive they build on, and reject a timeout, TTL
 *     or schedule outside the values VIP accepts
 *   - lint/phpcs/full and lint/phpcs/core extend rtCampWP and rtCampWP-Basic,
 *     fill testVersion, minimum_wp_version, text domain and prefixes from the
 *     project, and wire the Composer repository rtcamp/wp-phpcs installs from;
 *     lint/phpcs/vip wires only the Composer plugin permission
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

	it('drops a wiring target that normalises outside the project', async () => {
		const r = registry;
		// `wp/cli` wires into `{{base_path}}/../Modules/Cli.php`. A single
		// path segment leaves nothing for the `..` to consume, so the target
		// would escape the project the AI was pointed at.
		const result = await r.execute(
			'wp/cli',
			{ name: 'export-things', base_path: '.' },
			{ dryRun: true, cwd: makeTmpDir() }
		);
		expect(result.ai.wiring).toEqual([]);
		expect(result.warnings).toEqual([
			'wiring target resolves outside the project, skipped: ../Modules/Cli.php',
		]);
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

/**
 * A project whose PSR-4 root is inc/ and whose plugin header declares a text
 * domain, the layout both first-party consumers use.
 *
 * @return {string} Path to the project.
 */
function makeVipProject() {
	const target = makeTmpDir();
	fs.writeFileSync(
		path.join(target, 'composer.json'),
		JSON.stringify({
			autoload: { 'psr-4': { 'Acme\\Blog\\': 'inc/' } },
			'autoload-dev': {
				'psr-4': { 'Acme\\Blog\\Tests\\': 'tests/php/' },
			},
		}),
		'utf8'
	);
	fs.writeFileSync(
		path.join(target, 'acme-blog.php'),
		'<?php\n/**\n * Plugin Name: Acme Blog\n * Text Domain: acme-blog\n */\n',
		'utf8'
	);
	return target;
}

/**
 * The error a dry run of a bundled scaffold throws.
 *
 * @param {string} id     Scaffold id.
 * @param {Object} inputs Inputs to run it with.
 * @return {Promise<Error>} The error; fails the test if nothing is thrown.
 */
async function rejection(id, inputs) {
	return registry
		.execute(id, inputs, { dryRun: true, cwd: makeTmpDir() })
		.then(
			() => {
				throw new Error('should have thrown');
			},
			(caught) => caught
		);
}

describe('integration/vip-remote-request', () => {
	it('renders a Services class with VIP-safe defaults and no wiring', async () => {
		const result = await registry.execute(
			'integration/vip-remote-request',
			{ name: 'events-feed' },
			{ dryRun: true, cwd: makeVipProject() }
		);
		expect(result.scaffold.lens).toEqual([
			'vip-readiness',
			'performance',
			'security',
		]);
		expect(result.engine.inputs).toMatchObject({
			namespace: 'Acme\\Blog\\Services',
			text_domain: 'acme-blog',
			cache_group: 'events-feed',
			timeout: '3',
			cache_ttl: '900',
		});
		expect(result.engine.wrote).toEqual(['inc/Services/EventsFeed.php']);
		expect(result.ai.tests[0].path).toBe(
			'tests/php/Services/EventsFeedTest.php'
		);
		// A plain service, instantiated by its callers: nothing to wire.
		expect(result.ai.wiring).toEqual([]);
	});

	it('rejects a timeout above the 3 seconds VIP accepts', async () => {
		const err = await rejection('integration/vip-remote-request', {
			name: 'events-feed',
			timeout: '5',
		});
		expect(err.code).toBe('EINVALIDINPUT');
		expect(err.invalid).toEqual([
			{ key: 'timeout', value: '5', allowed: ['1', '2', '3'] },
		]);
	});

	it('rejects a cache TTL below the 300 seconds VIP accepts', async () => {
		const err = await rejection('integration/vip-remote-request', {
			name: 'events-feed',
			cache_ttl: '60',
		});
		expect(err.code).toBe('EINVALIDINPUT');
		expect(err.invalid[0]).toMatchObject({ key: 'cache_ttl', value: '60' });
	});
});

describe('integration/vip-search', () => {
	it('renders a Services class, prefixes its fallback action and reuses the registrable anchor', async () => {
		const result = await registry.execute(
			'integration/vip-search',
			{ name: 'event-search', post_type: 'event' },
			{ dryRun: true, cwd: makeVipProject() }
		);
		expect(result.scaffold.lens).toEqual(['vip-readiness', 'performance']);
		expect(result.engine.inputs).toMatchObject({
			post_type: 'event',
			hook_prefix: 'acme_blog',
			hook_name: 'event_search',
		});
		expect(result.engine.wrote).toEqual(['inc/Services/EventSearch.php']);
		const wiring = result.ai.wiring[0];
		expect(wiring.targetFile).toBe('inc/Modules/Services.php');
		expect(wiring.anchor).toBe('// scaffold:wp/registrable:classes');
	});
});

describe('integration/vip-cron', () => {
	it('renders into the Cron layout, reuses the wp/cron anchor and asks for wp-framework', async () => {
		const result = await registry.execute(
			'integration/vip-cron',
			{ name: 'sync-feed' },
			{ dryRun: true, cwd: makeVipProject() }
		);
		expect(result.scaffold.lens).toEqual(['vip-readiness', 'performance']);
		expect(result.engine.inputs).toMatchObject({
			namespace: 'Acme\\Blog\\Cron',
			hook_prefix: 'acme_blog',
			hook_name: 'sync_feed',
			schedule: 'hourly',
		});
		expect(result.engine.wrote).toEqual(['inc/Cron/SyncFeed.php']);
		expect(result.ai.wiring[0].anchor).toBe('// scaffold:wp/cron:classes');
		expect(result.developer.install.composer).toEqual({
			'rtcamp/wp-framework': '^1.0',
		});
	});

	it('rejects a schedule WP-Cron does not register', async () => {
		const err = await rejection('integration/vip-cron', {
			name: 'sync-feed',
			schedule: 'every_minute',
		});
		expect(err.code).toBe('EINVALIDINPUT');
		expect(err.invalid).toEqual([
			{
				key: 'schedule',
				value: 'every_minute',
				allowed: ['hourly', 'twicedaily', 'daily', 'weekly'],
			},
		]);
	});
});

describe('integration/vip-webhook', () => {
	it('renders a Rest controller with a prefixed hook and secret name', async () => {
		const result = await registry.execute(
			'integration/vip-webhook',
			{ name: 'crm-contacts', rest_namespace: 'acme' },
			{ dryRun: true, cwd: makeVipProject() }
		);
		expect(result.scaffold.lens).toEqual([
			'security',
			'vip-readiness',
			'performance',
		]);
		expect(result.engine.inputs).toMatchObject({
			class: 'CrmContacts',
			route: 'crm-contacts',
			hook_prefix: 'acme_blog',
			hook_name: 'crm_contacts',
			secret_prefix: 'ACME_BLOG',
			secret_name: 'CRM_CONTACTS',
			signature_header: 'x-signature',
		});
		expect(result.engine.wrote).toEqual([
			'inc/Rest/CrmContactsWebhookController.php',
		]);
		expect(result.ai.wiring[0].anchor).toBe('// scaffold:wp/rest:classes');
		// The secret is a developer action, never rendered into a file.
		expect(result.developer.secrets).toEqual([]);
	});

	it('wires into the REST module file the project names', async () => {
		const target = async (cwd, inputs = {}) =>
			(
				await registry.execute(
					'integration/vip-webhook',
					{ name: 'crm-contacts', rest_namespace: 'acme', ...inputs },
					{ dryRun: true, cwd }
				)
			).ai.wiring[0].targetFile;

		// The file `wp/module --name=Rest` creates, under the PSR-4 root.
		expect(await target(makeTmpDir())).toBe('includes/Modules/Rest.php');
		expect(await target(makeVipProject())).toBe('inc/Modules/Rest.php');
		// features-plugin-skeleton's module is REST.php, a different file on Linux.
		expect(
			await target(makeVipProject(), {
				base_path: 'inc/Modules/REST',
				module_path: 'inc/Modules/REST.php',
			})
		).toBe('inc/Modules/REST.php');
	});

	it('requires a REST namespace', async () => {
		const err = await rejection('integration/vip-webhook', {
			name: 'crm-contacts',
		});
		expect(err.message).toMatch(/rest_namespace/);
	});
});

describe.each([
	['lint/phpcs/full', 'rtCampWP'],
	['lint/phpcs/core', 'rtCampWP-Basic'],
])('%s', (id, standard) => {
	it(`extends ${standard} and configures it from the project`, async () => {
		const target = makeVipProject();
		fs.writeFileSync(
			path.join(target, 'acme-blog.php'),
			'<?php\n/**\n * Plugin Name: Acme Blog\n * Requires at least: 6.6\n * Requires PHP: 8.3\n * Text Domain: acme-blog\n */\n',
			'utf8'
		);
		const result = await registry.execute(id, {}, { cwd: target });
		const xml = fs.readFileSync(
			path.join(target, 'phpcs.xml.dist'),
			'utf8'
		);

		expect(xml).toContain(`<rule ref="${standard}"/>`);
		// PHPCompatibility aborts every file when testVersion is unset.
		expect(xml).toContain('<config name="testVersion" value="8.3-"/>');
		expect(xml).toContain(
			'<config name="minimum_wp_version" value="6.6"/>'
		);
		expect(xml).toContain('<element value="acme-blog"/>');
		expect(xml).toContain('<element value="acme_blog"/>');
		expect(xml).toContain('<element value="Acme\\Blog"/>');
		// The package bundles PHPCS and every sniff it references.
		expect(result.developer.install.composerDev).toEqual({
			'rtcamp/wp-phpcs': '^1.0',
		});
	});

	it('wires the repository and plugin permission Composer needs to install it', async () => {
		const result = await registry.execute(
			id,
			{},
			{ dryRun: true, cwd: makeTmpDir() }
		);
		const [repositories, allowPlugins] = result.ai.wiring;

		expect(result.ai.wiring.map((w) => w.targetFile)).toEqual([
			'composer.json',
			'composer.json',
		]);
		// Not on Packagist: without this entry the require cannot resolve.
		expect(JSON.parse(`{${repositories.snippet}}`).repositories).toEqual([
			{
				type: 'vcs',
				url: 'https://github.com/rtCamp/wp-phpcs.git',
				'no-api': true,
			},
		]);
		expect(
			JSON.parse(`{${allowPlugins.snippet}}`).config['allow-plugins']
		).toEqual({ 'dealerdirect/phpcodesniffer-composer-installer': true });
	});

	it('falls back to defaults and leaves out the namespace prefix without PSR-4', async () => {
		const target = makeTmpDir();
		await registry.execute(id, {}, { cwd: target });
		const xml = fs.readFileSync(
			path.join(target, 'phpcs.xml.dist'),
			'utf8'
		);

		expect(xml).toContain('<config name="testVersion" value="8.2-"/>');
		expect(xml).toContain(
			'<config name="minimum_wp_version" value="6.5"/>'
		);
		expect(xml).toContain('<element value="my-plugin"/>');
		expect(xml).toContain(
			'<element value="my_plugin"/>\n\t\t\t</property>'
		);
	});
});

describe('lint/phpcs/vip', () => {
	it('allows the Composer plugin that registers the standards, without a repository', async () => {
		const result = await registry.execute(
			'lint/phpcs/vip',
			{},
			{ dryRun: true, cwd: makeTmpDir() }
		);

		// automattic/vipwpcs resolves from Packagist, so only the plugin needs allowing.
		expect(result.ai.wiring).toHaveLength(1);
		expect(result.ai.wiring[0].targetFile).toBe('composer.json');
		expect(JSON.parse(`{${result.ai.wiring[0].snippet}}`)).toEqual({
			config: {
				'allow-plugins': {
					'dealerdirect/phpcodesniffer-composer-installer': true,
				},
			},
		});
	});
});

describe('setup/phpunit', () => {
	it("names the bootstrap's package after the project's test namespace", async () => {
		const target = makeVipProject();
		await registry.execute('setup/phpunit', {}, { cwd: target });

		expect(
			fs.readFileSync(path.join(target, 'tests/bootstrap.php'), 'utf8')
		).toContain(' * @package Acme\\Blog\\Tests\n');
	});
});
