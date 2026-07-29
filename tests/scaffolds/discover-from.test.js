/**
 * Tests for the file-based `discover_from` resolvers added to registry.js:
 *   - composer.json:autoload.psr-4  -> root namespace (non-path inputs only)
 *   - composer.json:<dot.path>      -> string value
 *   - package.json:<dot.path>       -> string value
 *   - config:<key>                  -> value from .wp-tooling.json
 *
 * Behaviour is exercised through execute() (dry run) since resolveInputs is
 * module-internal. Precedence and the backward-compatible default fallback are
 * the focus: a missing source file must behave exactly as before.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { ScaffoldRegistry } = require('../../src/scaffolds/registry');

function makeTmpDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'wp-tooling-discover-'));
}

// A scaffold that surfaces resolved namespace/base_path/text_domain through the
// dest path and a wiring snippet, so we can read them off the execute() result.
const SCAFFOLD = {
	slug: 'probe',
	category: 'wp',
	name: 'Probe',
	description: 'Surfaces resolved inputs for assertions.',
	source: 'template',
	inputs: [
		{
			key: 'namespace',
			description: 'PSR-4 namespace',
			discover_from: 'composer.json:autoload.psr-4',
			default: 'Inc\\Cli',
		},
		{
			key: 'base_path',
			description: 'Directory',
			discover_from: 'composer.json:autoload.psr-4',
			default: 'includes/Cli',
		},
		{
			key: 'text_domain',
			description: 'i18n text domain',
			discover_from: 'config:textDomain',
			default: 'fallback-domain',
		},
		{
			key: 'root_ns',
			description: 'Bare-root namespace (no sub-namespace in default)',
			discover_from: 'composer.json:autoload.psr-4',
			default: 'Inc',
		},
		{
			key: 'tests_namespace',
			description: 'Deep default, grafted onto the discovered root',
			discover_from: 'composer.json:autoload.psr-4',
			default: 'Inc\\Tests\\Cli',
		},
		{ key: 'name', description: 'Name', required: true },
	],
	files: [{ src: 'x.mustache', dest: '{{base_path}}/{{name}}.php' }],
	wiring: [
		{
			target_file: 'wire.php',
			snippet_template:
				'{{namespace}}::{{text_domain}}::{{root_ns}}::{{tests_namespace}}',
		},
	],
};

async function run(targetDir, supplied = { name: 'demo' }) {
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
	const result = await r.execute('wp/probe', supplied, {
		dryRun: true,
		cwd: targetDir,
	});
	// snippet is "{{namespace}}::{{text_domain}}::{{root_ns}}::{{tests_namespace}}"
	const [namespace, textDomain, rootNs, testsNamespace] =
		result.ai.wiring[0].snippet.split('::');
	const basePath = result.engine.wrote[0].replace(/\/demo\.php$/, '');
	fs.rmSync(projectDir, { recursive: true, force: true });
	return { namespace, textDomain, rootNs, testsNamespace, basePath };
}

describe('discover_from: composer.json:autoload.psr-4', () => {
	it('replaces the first segment of each default, preserving its sub-namespace', async () => {
		// One discovered root, three default shapes resolved in a single run:
		//   bare root      `Inc`            -> root
		//   one sub-ns     `Inc\Cli`        -> root\Cli
		//   multi-seg tail `Inc\Tests\Cli`  -> root\Tests\Cli
		const target = makeTmpDir();
		fs.writeFileSync(
			path.join(target, 'composer.json'),
			JSON.stringify({
				autoload: { 'psr-4': { 'rtCamp\\Theme\\MyTheme\\': 'inc/' } },
			})
		);
		const { rootNs, namespace, testsNamespace } = await run(target);
		expect(rootNs).toBe('rtCamp\\Theme\\MyTheme');
		expect(namespace).toBe('rtCamp\\Theme\\MyTheme\\Cli');
		expect(testsNamespace).toBe('rtCamp\\Theme\\MyTheme\\Tests\\Cli');
		fs.rmSync(target, { recursive: true, force: true });
	});

	it('does NOT override a path input (base_path keeps its default)', async () => {
		const target = makeTmpDir();
		fs.writeFileSync(
			path.join(target, 'composer.json'),
			JSON.stringify({
				autoload: { 'psr-4': { 'rtCamp\\Theme\\MyTheme\\': 'inc/' } },
			})
		);
		const { basePath } = await run(target);
		expect(basePath).toBe('includes/Cli'); // default, not 'inc' from psr-4
		fs.rmSync(target, { recursive: true, force: true });
	});

	it('falls back to default when composer.json is absent (backward compatible)', async () => {
		const target = makeTmpDir(); // no composer.json
		const { namespace, basePath } = await run(target);
		expect(namespace).toBe('Inc\\Cli');
		expect(basePath).toBe('includes/Cli');
		fs.rmSync(target, { recursive: true, force: true });
	});

	it('falls back to default when composer.json is malformed', async () => {
		const target = makeTmpDir();
		fs.writeFileSync(path.join(target, 'composer.json'), '{ not json');
		const { namespace } = await run(target);
		expect(namespace).toBe('Inc\\Cli');
		fs.rmSync(target, { recursive: true, force: true });
	});

	it('lets a supplied value win over discovery', async () => {
		const target = makeTmpDir();
		fs.writeFileSync(
			path.join(target, 'composer.json'),
			JSON.stringify({
				autoload: { 'psr-4': { 'rtCamp\\Theme\\MyTheme\\': 'inc/' } },
			})
		);
		const { namespace } = await run(target, {
			name: 'demo',
			namespace: 'Acme\\Custom',
		});
		expect(namespace).toBe('Acme\\Custom');
		fs.rmSync(target, { recursive: true, force: true });
	});
});

describe('discover_from: config:<key>', () => {
	it('resolves a value from .wp-tooling.json', async () => {
		const target = makeTmpDir();
		fs.writeFileSync(
			path.join(target, '.wp-tooling.json'),
			JSON.stringify({ textDomain: 'my-theme' })
		);
		const { textDomain } = await run(target);
		expect(textDomain).toBe('my-theme');
		fs.rmSync(target, { recursive: true, force: true });
	});

	it('falls back to default when .wp-tooling.json is absent', async () => {
		const target = makeTmpDir();
		const { textDomain } = await run(target);
		expect(textDomain).toBe('fallback-domain');
		fs.rmSync(target, { recursive: true, force: true });
	});
});

describe('discover_from: package.json:<dot.path>', () => {
	it('resolves a string value via a dotted path', async () => {
		const target = makeTmpDir();
		fs.writeFileSync(
			path.join(target, 'package.json'),
			JSON.stringify({ name: 'pkg-name' })
		);
		const projectDir = makeTmpDir();
		const sDir = path.join(projectDir, 'pkg');
		fs.mkdirSync(sDir, { recursive: true });
		fs.writeFileSync(
			path.join(sDir, 'scaffold.json'),
			JSON.stringify({
				slug: 'pkg',
				name: 'Pkg',
				description: 'd',
				source: 'template',
				inputs: [
					{
						key: 'pname',
						description: 'package name',
						discover_from: 'package.json:name',
						default: 'def',
					},
				],
				files: [{ src: 'x.mustache', dest: '{{pname}}.txt' }],
			}),
			'utf8'
		);
		const r = new ScaffoldRegistry({ projectDir });
		await r.scan();
		const result = await r.execute(
			'pkg',
			{},
			{ dryRun: true, cwd: target }
		);
		expect(result.engine.wrote[0]).toBe('pkg-name.txt');
		fs.rmSync(projectDir, { recursive: true, force: true });
		fs.rmSync(target, { recursive: true, force: true });
	});
});
