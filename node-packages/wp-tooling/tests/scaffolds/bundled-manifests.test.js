/**
 * Integration tests against the BUNDLED scaffold catalogue (scaffolds/),
 * pinning behaviours that span engine + manifest:
 *   - setup/psr4 wiring snippet is valid JSON for multi-segment namespaces
 *     (json-escape derived input)
 *   - wp/cli namespace + tests_namespace discovery grafts the project's
 *     PSR-4 root onto the kind sub-namespace
 *   - wiring targetFile paths are normalised (no `..` segments)
 *   - lint/i18n binds a supplied or discovered text domain, never a guessed one
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
