/**
 * Tests for the `discover_from` sources added alongside the psr-4 resolvers:
 *   - plugin-header:<header-name>      -> a value from the plugin/theme entry header
 *   - composer.json:autoload-dev.psr-4 -> the dev autoload map, for test paths
 *
 * Plus the authoring-time guard that keeps the set of sources a manifest may
 * declare in step with the set registry.js can actually resolve — the failure
 * these replaced was a manifest declaring discovery that silently never ran.
 *
 * Behaviour goes through execute() (dry run), since resolveInputs is internal.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { ScaffoldRegistry } = require('../../src/scaffolds/registry');
const { validate } = require('../../src/scaffolds/validate');

function makeTmpDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'wp-tooling-sources-'));
}

const SCAFFOLD = {
	slug: 'probe',
	category: 'wp',
	name: 'Probe',
	description: 'Surfaces resolved inputs for assertions.',
	source: 'template',
	inputs: [
		{
			key: 'text_domain',
			description: 'i18n text domain',
			discover_from: 'plugin-header:text-domain',
			default: 'fallback-domain',
		},
		{
			key: 'tests_path',
			description: 'Directory for the test file',
			discover_from: 'composer.json:autoload-dev.psr-4',
			default: 'tests/Cli',
		},
		{ key: 'name', description: 'Name', required: true },
	],
	files: [{ src: 'x.mustache', dest: '{{tests_path}}/{{name}}.php' }],
	wiring: [{ target_file: 'wire.php', snippet_template: '{{text_domain}}' }],
};

async function run(targetDir) {
	const projectDir = makeTmpDir();
	const sDir = path.join(projectDir, 'wp', 'probe');
	fs.mkdirSync(sDir, { recursive: true });
	fs.writeFileSync(
		path.join(sDir, 'scaffold.json'),
		JSON.stringify(SCAFFOLD),
		'utf8'
	);
	const r = new ScaffoldRegistry({ projectDir });
	await r.scan();
	const result = await r.execute(
		'wp/probe',
		{ name: 'demo' },
		{ dryRun: true, cwd: targetDir }
	);
	fs.rmSync(projectDir, { recursive: true, force: true });
	return {
		textDomain: result.ai.wiring[0].snippet,
		testsPath: result.engine.wrote[0].replace(/\/demo\.php$/, ''),
	};
}

describe('discover_from: plugin-header:<header-name>', () => {
	it('reads Text Domain from a plugin entry file', async () => {
		const target = makeTmpDir();
		fs.writeFileSync(
			path.join(target, 'acme-blog.php'),
			[
				'<?php',
				'/**',
				' * Plugin Name:       Acme Blog',
				' * Text Domain:       acme-blog',
				' */',
				'',
				"add_action( 'init', 'acme_blog_boot' );",
				'',
			].join('\n')
		);
		expect((await run(target)).textDomain).toBe('acme-blog');
	});

	it('reads Text Domain from a theme style.css', async () => {
		const target = makeTmpDir();
		fs.writeFileSync(
			path.join(target, 'style.css'),
			[
				'/*',
				'Theme Name:  Elementary',
				'Text Domain: elementary-theme',
				'*/',
				'',
				'body { margin: 0; }',
				'',
			].join('\n')
		);
		expect((await run(target)).textDomain).toBe('elementary-theme');
	});

	it('prefers a plugin entry over a style.css in the same directory', async () => {
		const target = makeTmpDir();
		fs.writeFileSync(
			path.join(target, 'acme-blog.php'),
			'<?php\n/**\n * Plugin Name: Acme Blog\n * Text Domain: from-plugin\n */\n'
		);
		fs.writeFileSync(
			path.join(target, 'style.css'),
			'/*\nTheme Name: Acme\nText Domain: from-theme\n*/\n'
		);
		expect((await run(target)).textDomain).toBe('from-plugin');
	});

	it('stops at the end of the header comment', async () => {
		// A `Text Domain:` further down the file is code, not a header, and must
		// not win over the real one.
		const target = makeTmpDir();
		fs.writeFileSync(
			path.join(target, 'acme-blog.php'),
			[
				'<?php',
				'/**',
				' * Plugin Name: Acme Blog',
				' * Text Domain: real-domain',
				' */',
				'',
				'// Text Domain: not-a-header',
				'',
			].join('\n')
		);
		expect((await run(target)).textDomain).toBe('real-domain');
	});

	it('falls back to the default when the directory has no entry file', async () => {
		expect((await run(makeTmpDir())).textDomain).toBe('fallback-domain');
	});

	it('falls back to the default when the header is absent', async () => {
		const target = makeTmpDir();
		fs.writeFileSync(
			path.join(target, 'acme-blog.php'),
			'<?php\n/**\n * Plugin Name: Acme Blog\n */\n'
		);
		expect((await run(target)).textDomain).toBe('fallback-domain');
	});
});

describe('discover_from: composer.json:autoload-dev.psr-4', () => {
	it('grafts the dev autoload directory onto the default', async () => {
		// The bug this closes: tests were written to the manifest default
		// (`tests/Cli`) while PHPUnit only ran `tests/php/`, so a generated test
		// was never discovered.
		const target = makeTmpDir();
		fs.writeFileSync(
			path.join(target, 'composer.json'),
			JSON.stringify({
				autoload: { 'psr-4': { 'Acme\\Blog\\': 'inc/' } },
				'autoload-dev': {
					'psr-4': { 'Acme\\Blog\\Tests\\': 'tests/php/' },
				},
			})
		);
		expect((await run(target)).testsPath).toBe('tests/php/Cli');
	});

	it('falls back to the default when there is no autoload-dev map', async () => {
		const target = makeTmpDir();
		fs.writeFileSync(
			path.join(target, 'composer.json'),
			JSON.stringify({
				autoload: { 'psr-4': { 'Acme\\Blog\\': 'inc/' } },
			})
		);
		expect((await run(target)).testsPath).toBe('tests/Cli');
	});

	it('does not read the production map for a dev selector', async () => {
		// `autoload.psr-4` maps to `inc/`; resolving the dev selector against it
		// would put tests inside the source tree.
		const target = makeTmpDir();
		fs.writeFileSync(
			path.join(target, 'composer.json'),
			JSON.stringify({
				autoload: { 'psr-4': { 'Acme\\Blog\\': 'inc/' } },
			})
		);
		expect((await run(target)).testsPath).not.toContain('inc/');
	});
});

describe('validate rejects a source the engine cannot resolve', () => {
	const manifest = (discoverFrom) => ({
		slug: 'x',
		name: 'X',
		description: 'd',
		source: 'template',
		files: [{ src: 't', dest: 'd' }],
		inputs: [{ key: 'a', description: 'd', discover_from: discoverFrom }],
	});
	const errorsFor = (spec) =>
		validate(manifest(spec)).filter((e) => e.includes('discover_from'));

	it.each([
		'composer.json:autoload.psr-4',
		'composer.json:autoload-dev.psr-4',
		'package.json:name',
		'plugin-header:text-domain',
		'config:cssDir',
		'input:name',
	])('accepts %s', (spec) => {
		expect(errorsFor(spec)).toEqual([]);
	});

	it.each([
		['an unknown prefix', 'plugin-headers:text-domain'],
		['a source with no selector', 'plugin-header'],
		['an empty selector', 'composer.json:'],
		['a bare word', 'autoload.psr-4'],
	])('rejects %s', (_label, spec) => {
		expect(errorsFor(spec)).toHaveLength(1);
		expect(errorsFor(spec)[0]).toMatch(/unknown source/);
	});

	it('names the supported sources so the error is actionable', () => {
		expect(errorsFor('nope:thing')[0]).toContain('plugin-header');
	});
});

describe('the bundled catalogue only declares resolvable sources', () => {
	it('has no manifest that validate would reject', () => {
		// The regression that motivated the guard: every wp/* manifest declared
		// `plugin-header:text-domain` while nothing implemented it, so all seven
		// silently shipped `my-plugin` as the text domain.
		const root = path.join(__dirname, '..', '..', 'scaffolds');
		const manifests = [];
		(function walk(dir) {
			for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, e.name);
				if (e.isDirectory()) {
					walk(full);
				} else if (e.name === 'scaffold.json') {
					manifests.push(full);
				}
			}
		})(root);

		expect(manifests.length).toBeGreaterThan(0);

		const bad = [];
		for (const file of manifests) {
			const errs = validate(
				JSON.parse(fs.readFileSync(file, 'utf8'))
			).filter((e) => e.includes('discover_from'));
			if (errs.length) {
				bad.push(`${path.relative(root, file)}: ${errs.join('; ')}`);
			}
		}
		expect(bad).toEqual([]);
	});
});
