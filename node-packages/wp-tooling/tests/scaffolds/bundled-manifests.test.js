/**
 * Integration tests against the BUNDLED scaffold catalogue (scaffolds/),
 * pinning behaviours that span engine + manifest:
 *   - setup/psr4 wiring snippet is valid JSON for multi-segment namespaces
 *     (json-escape derived input)
 *   - wp/cli namespace + tests_namespace discovery grafts the project's
 *     PSR-4 root onto the kind sub-namespace
 *   - wiring targetFile paths are normalised (no `..` segments), and a
 *     target that still escapes the project is dropped with a warning
 *   - lint/i18n binds a supplied or discovered text domain, never a guessed one
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
 *   - utility/* are source: package — zero files, a Composer dep and one
 *     accessor snippet, with context_slug discovered from composer.json:name
 *   - lint/phpcs/full and lint/phpcs/core extend rtCampWP and rtCampWP-Basic,
 *     fill testVersion, minimum_wp_version, text domain and prefixes from the
 *     project, and wire the Composer repository rtcamp/wp-phpcs installs from;
 *     lint/phpcs/vip wires only the Composer plugin permission
 *   - setup/phpunit names the bootstrap's @package after the test namespace
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { ScaffoldRegistry } = require('../../src/scaffolds/registry');

const DEFAULTS_DIR = path.join(__dirname, '..', '..', 'scaffolds');

const tempDirs = [];

function makeTmpDir() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-tooling-bundled-'));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

// The bundled catalogue is immutable; executions write only to temporary
// directories, so one catalogue scan can be shared across the file.
let registry;
beforeAll(async () => {
	registry = new ScaffoldRegistry({ defaultsDir: DEFAULTS_DIR });
	await registry.scan();
});

describe('quoted display text', () => {
	it.each([
		['wp/admin-page', 'page_title', { slug: 'quote', menu_title: 'Quote' }],
		[
			'wp/settings-page',
			'menu_title',
			{ slug: 'quote', page_title: 'Quote', option_name: 'quote' },
		],
		['wp/cpt', 'singular', { slug: 'quote', plural: 'Quotes' }],
		[
			'wp/taxonomy',
			'plural',
			{ slug: 'quote', singular: 'Quote', object_type: 'post' },
		],
		['wp/user-role', 'display_name', { slug: 'quote' }],
		['wp-api/block-bindings', 'label', { name: 'quote' }],
		['wp/cli', 'description', { name: 'quote' }],
	])('escapes PHP display text in %s', async (id, key, inputs) => {
		const cwd = makeTmpDir();
		const result = await registry.execute(
			id,
			{ ...inputs, [key]: "Editor's \\guide" },
			{ cwd }
		);
		const file = result.engine.wrote.find((name) => name.endsWith('.php'));
		const php = fs.readFileSync(path.join(cwd, file), 'utf8');
		expect(php).toContain("'Editor\\'s \\\\guide'");
		expect(result.engine.inputs[key]).toBe("Editor's \\guide");
	});

	it.each(['wp/block-dynamic', 'wp/block-interactive'])(
		'preserves quotes and backslashes in block metadata for %s',
		async (id) => {
			const cwd = makeTmpDir();
			const title = 'Editor\'s "guide" \\ notes';
			const result = await registry.execute(
				id,
				{ slug: 'quote', title },
				{ cwd }
			);
			const json = result.engine.wrote.find((name) =>
				name.endsWith('block.json')
			);
			expect(
				JSON.parse(fs.readFileSync(path.join(cwd, json), 'utf8')).title
			).toBe(title);
			const edit = result.engine.wrote.find((name) =>
				name.endsWith('edit.js')
			);
			expect(fs.readFileSync(path.join(cwd, edit), 'utf8')).toContain(
				"Editor\\'s"
			);
		}
	);
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

	it('drops a wiring target that normalises to exactly `..`', async () => {
		// `a/../..` normalises to `..`, with no trailing slash, so a
		// `startsWith('../')` check alone would let it through.
		const projectDir = makeTmpDir();
		const sDir = path.join(projectDir, 'wp', 'probe');
		fs.mkdirSync(sDir, { recursive: true });
		fs.writeFileSync(
			path.join(sDir, 'scaffold.json'),
			JSON.stringify({
				slug: 'probe',
				category: 'wp',
				name: 'Probe',
				description: 'Wires into a parent-directory target.',
				source: 'template',
				inputs: [
					{ key: 'dir', description: 'Directory', default: 'a' },
				],
				files: [{ src: 'x.mustache', dest: 'out.php' }],
				wiring: [
					{ target_file: '{{dir}}/../..', snippet_template: 'x' },
				],
			}),
			'utf8'
		);
		const r = new ScaffoldRegistry({ projectDir });
		await r.scan();
		const result = await r.execute(
			'wp/probe',
			{},
			{ dryRun: true, cwd: makeTmpDir() }
		);
		expect(result.ai.wiring).toEqual([]);
		expect(result.warnings).toEqual([
			'wiring target resolves outside the project, skipped: ..',
		]);
	});
});

describe('wp-api/speculation', () => {
	it('renders into the Services layout under the project PSR-4 root and reuses the registrable anchor', async () => {
		// Both consuming repos map their root to `inc/`, so the namespace and
		// the directory have to be grafted from the same map entry — otherwise
		// the class is namespaced `<Root>\Services` but written to
		// `includes/Services`, outside the autoload root. (An `includes/` root
		// would match the manifest default and hide a missing graft.)
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
		expect(result.engine.inputs.mode).toBe('prerender');
		expect(result.engine.inputs.eagerness).toBe('moderate');
		expect(result.engine.wrote).toEqual([
			'inc/Services/SpeculativeLoading.php',
		]);
		expect(result.ai.tests[0].path).toBe(
			'tests/Services/SpeculativeLoadingTest.php'
		);
		// The generated class IS a Registrable, so it wires into the same
		// module (and the same anchor) as wp/registrable.
		const wiring = result.ai.wiring[0];
		expect(wiring.targetFile).toBe('inc/Modules/Services.php');
		expect(wiring.targetFile).not.toContain('..');
		expect(wiring.anchor).toBe('// scaffold:wp/registrable:classes');
		expect(wiring.snippet).toBe(
			'\\Acme\\Blog\\Services\\SpeculativeLoading::class,'
		);
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
	it('renders the block directory plus a registrar under the project PSR-4 root, reusing the block anchor', async () => {
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
		expect(result.engine.inputs.namespace).toBe('Acme\\Blog\\Blocks');
		expect(result.engine.inputs.class).toBe('FaqAccordion');
		// Only the PHP class follows the PSR-4 root; the block sources are
		// build inputs, not autoloaded code, so they stay under blocks_dir.
		// render.php must land at `<blocks_dir>/<slug>/render.php`: the rtCamp
		// PHPCS ruleset exempts exactly that path from the file-header and
		// text-domain sniffs a block render file cannot satisfy.
		expect(result.engine.wrote).toEqual([
			'inc/Blocks/FaqAccordion.php',
			'src/blocks/faq-accordion/block.json',
			'src/blocks/faq-accordion/index.js',
			'src/blocks/faq-accordion/edit.js',
			'src/blocks/faq-accordion/render.php',
			'src/blocks/faq-accordion/view.js',
		]);
		// An interactive block is still a block: it shares the Blocks module,
		// and its anchor, with wp/block-dynamic instead of minting a new one.
		const wiring = result.ai.wiring[0];
		expect(wiring.targetFile).toBe('inc/Modules/Blocks.php');
		expect(wiring.anchor).toBe('// scaffold:wp/block-dynamic:classes');
		expect(wiring.snippet).toBe(
			'\\Acme\\Blog\\Blocks\\FaqAccordion::class,'
		);
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
			'--no-install',
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
			'--no-install',
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
			'--no-install',
			'wp-env',
			'run',
			'cli',
			'--env-cwd=.',
			'--',
			'wp',
		]);
	});

	it('renders the profile:server npm script from the resolved server_env_cwd, not a hardcoded plugin-path guess', async () => {
		const r = registry;

		const pluginResult = await r.execute(
			'setup/perf',
			{
				base_url: 'http://localhost:8888',
				server_env_cwd: 'wp-content/plugins/dummy-plugin',
			},
			{ dryRun: true, cwd: makeTmpDir() }
		);
		expect(pluginResult.developer.scripts.npm['profile:server']).toBe(
			'wp-env run cli --env-cwd=wp-content/plugins/dummy-plugin -- wp eval-file server-profile.php'
		);

		const rootResult = await r.execute(
			'setup/perf',
			{ base_url: 'http://localhost:8888', server_env_cwd: '.' },
			{ dryRun: true, cwd: makeTmpDir() }
		);
		expect(rootResult.developer.scripts.npm['profile:server']).toBe(
			'wp-env run cli --env-cwd=. -- wp eval-file server-profile.php'
		);
	});

	it('JSON-escapes every URL input while preserving its value', async () => {
		const target = makeTmpDir();
		const inputs = {
			base_url: 'http://localhost:8888/"quoted"',
			sample_page: '/path\\segment',
			search_page: '/?s="hello"&page=2',
			extra_page: '/line\nbreak',
			server_env_cwd: '.',
		};
		await registry.execute('setup/perf', inputs, { cwd: target });
		const config = JSON.parse(
			fs.readFileSync(path.join(target, '.perfrc.json'), 'utf8')
		);
		expect(config.urls).toEqual([
			`${inputs.base_url}/`,
			inputs.base_url + inputs.sample_page,
			inputs.base_url + inputs.search_page,
			inputs.base_url + inputs.extra_page,
		]);
	});

	it('escapes server_env_cwd separately for the JSON config and the shell script', async () => {
		const target = makeTmpDir();
		const envCwd = 'wp-content/plugins/my "odd" plugin';
		const result = await registry.execute(
			'setup/perf',
			{ base_url: 'http://localhost:8888', server_env_cwd: envCwd },
			{ cwd: target }
		);
		const config = JSON.parse(
			fs.readFileSync(path.join(target, '.perfrc.json'), 'utf8')
		);
		expect(config.server.command).toContain(`--env-cwd=${envCwd}`);
		expect(result.developer.scripts.npm['profile:server']).toBe(
			`wp-env run cli --env-cwd='${envCwd}' -- wp eval-file server-profile.php`
		);
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

describe('setup/pa11y rendered config', () => {
	it('JSON-escapes every URL input while preserving its value', async () => {
		const target = makeTmpDir();
		const inputs = {
			base_url: 'http://localhost:8888/"quoted"',
			sample_page: '/path\\segment',
			search_page: '/?s="hello"&page=2',
			extra_page: '/line\nbreak',
		};
		await registry.execute('setup/pa11y', inputs, { cwd: target });
		const config = JSON.parse(
			fs.readFileSync(path.join(target, '.pa11yci.json'), 'utf8')
		);
		expect(config.urls).toEqual([
			`${inputs.base_url}/`,
			inputs.base_url + inputs.sample_page,
			inputs.base_url + inputs.search_page,
			inputs.base_url + inputs.extra_page,
		]);
	});

	it('renders valid JSON with default page paths (extra_page omitted)', async () => {
		const r = registry;
		const target = makeTmpDir();
		await r.execute(
			'setup/pa11y',
			{ base_url: 'http://localhost:8888' },
			{ cwd: target }
		);
		const config = JSON.parse(
			fs.readFileSync(path.join(target, '.pa11yci.json'), 'utf8')
		);
		expect(config.defaults.standard).toBe('WCAG2AA');
		expect(config.defaults.runners).toEqual(['axe', 'htmlcs']);
		expect(config.urls).toEqual([
			'http://localhost:8888/',
			'http://localhost:8888/?p=1',
			'http://localhost:8888/?s=hello',
		]);
	});

	it('renders custom page paths and appends extra_page when given', async () => {
		const r = registry;
		const target = makeTmpDir();
		await r.execute(
			'setup/pa11y',
			{
				base_url: 'http://localhost:8765',
				sample_page: '/hello-world/',
				search_page: '/?s=wordpress',
				extra_page: '/about/',
			},
			{ cwd: target }
		);
		const config = JSON.parse(
			fs.readFileSync(path.join(target, '.pa11yci.json'), 'utf8')
		);
		expect(config.urls).toEqual([
			'http://localhost:8765/',
			'http://localhost:8765/hello-world/',
			'http://localhost:8765/?s=wordpress',
			'http://localhost:8765/about/',
		]);
	});
});

describe('lint/i18n ruleset', () => {
	it('binds the supplied text domain and reports the script + dev deps', async () => {
		const target = makeTmpDir();
		const result = await registry.execute(
			'lint/i18n',
			{ text_domain: 'acme-blog' },
			{ cwd: target }
		);
		const ruleset = fs.readFileSync(
			path.join(target, 'phpcs.i18n.xml.dist'),
			'utf8'
		);
		expect(ruleset).toContain('<rule ref="WordPress.WP.I18n">');
		expect(ruleset).toContain('<element value="acme-blog"/>');
		expect(ruleset).toContain('<arg name="extensions" value="php,inc"/>');
		expect(result.developer.scripts.composer).toEqual({
			'lint:i18n': 'phpcs --standard=phpcs.i18n.xml.dist',
		});
		expect(Object.keys(result.developer.install.composerDev)).toEqual([
			'dealerdirect/phpcodesniffer-composer-installer',
			'squizlabs/php_codesniffer',
			'wp-coding-standards/wpcs',
		]);
	});

	it('discovers the text domain from .wp-tooling.json', async () => {
		const target = makeTmpDir();
		fs.writeFileSync(
			path.join(target, '.wp-tooling.json'),
			JSON.stringify({ textDomain: 'acme-shop' }),
			'utf8'
		);
		const result = await registry.execute(
			'lint/i18n',
			{},
			{ dryRun: true, cwd: target }
		);
		expect(result.engine.inputs.text_domain).toBe('acme-shop');
	});

	it('requires a text domain rather than guessing one', async () => {
		await expect(
			registry.execute(
				'lint/i18n',
				{},
				{ dryRun: true, cwd: makeTmpDir() }
			)
		).rejects.toMatchObject({
			code: 'EMISSINGINPUT',
			missing: ['text_domain'],
		});
	});
});

describe('setup/claude-skills accessibility distribution', () => {
	it.each([
		['default directory', {}, '.claude/skills'],
		['custom directory', { skills_dir: 'custom/skills' }, 'custom/skills'],
	])(
		'copies the complete skill unchanged into the %s',
		async (label, inputs, skillsDir) => {
			const target = makeTmpDir();
			await registry.execute('setup/claude-skills', inputs, {
				cwd: target,
			});
			const files = [
				'SKILL.md',
				'evals/evals.json',
				'evals/files/template-parts/hero.php',
				'evals/files/theme.json',
			];
			for (const file of files) {
				const copied = fs.readFileSync(
					path.join(target, skillsDir, 'accessibility', file),
					'utf8'
				);
				const original = fs.readFileSync(
					path.join(__dirname, '../../skills/accessibility', file),
					'utf8'
				);
				expect(copied).toBe(original);
			}
		}
	);
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
				'rtcamp/wp-primitives': '^2.0',
			});

			expect(result.ai.wiring).toHaveLength(1);
			const w = result.ai.wiring[0];
			expect(w.anchor).toBe(`// scaffold:${id}`);
			expect(w.targetFile).toBe('includes/Helpers/Util.php');
			expect(w.snippet).toContain(
				`\\rtCamp\\WPPrimitives\\Utils\\${className}`
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
			"new \\rtCamp\\WPPrimitives\\Utils\\Cache( 'rtcamp_project_name_features' )"
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
		expect(snippet).toContain('new \\rtCamp\\WPPrimitives\\Utils\\Timer()');
		expect(snippet).not.toContain('rtcamp_project_name_features');
	});
});

/**
 * A project whose PSR-4 root is inc/ and whose plugin header declares a text
 * domain, the layout both first-party consumers use.
 *
 * @return {string} Path to the project.
 */
function makeIncProject() {
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
			{ dryRun: true, cwd: makeIncProject() }
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
			{ dryRun: true, cwd: makeIncProject() }
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
	it('renders into the Cron layout, reuses the wp/cron anchor and asks for wp-primitives', async () => {
		const result = await registry.execute(
			'integration/vip-cron',
			{ name: 'sync-feed' },
			{ dryRun: true, cwd: makeIncProject() }
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
			'rtcamp/wp-primitives': '^2.0',
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
			{ dryRun: true, cwd: makeIncProject() }
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
		expect(await target(makeIncProject())).toBe('inc/Modules/Rest.php');
		// features-plugin-skeleton's module is REST.php, a different file on Linux.
		expect(
			await target(makeIncProject(), {
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
		const target = makeIncProject();
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

	it('wires only the plugin permission Composer needs to install it', async () => {
		const result = await registry.execute(
			id,
			{},
			{ dryRun: true, cwd: makeTmpDir() }
		);

		// rtcamp/wp-phpcs resolves from Packagist, so no repositories entry.
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
		const target = makeIncProject();
		await registry.execute('setup/phpunit', {}, { cwd: target });

		expect(
			fs.readFileSync(path.join(target, 'tests/bootstrap.php'), 'utf8')
		).toContain(' * @package Acme\\Blog\\Tests\n');
	});
});
