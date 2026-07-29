/**
 * Tests for the --cwd containment guard (resolveInside): the engine must
 * refuse to write or remove any path that resolves outside the target
 * directory — whether smuggled in via a path input, a manifest dest, or a
 * tampered `.wp-tooling.json` featureFiles entry. Enforces the
 * docs/ai-orchestration.md §3 guarantee.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { ScaffoldRegistry } = require('../../src/scaffolds/registry');

function makeTmpDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'wp-tooling-traversal-'));
}

function writeScaffold(projectDir, scaffoldJson, templates = {}) {
	const dir = path.join(projectDir, scaffoldJson.slug);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, 'scaffold.json'),
		JSON.stringify(scaffoldJson),
		'utf8'
	);
	for (const [name, body] of Object.entries(templates)) {
		fs.writeFileSync(path.join(dir, name), body, 'utf8');
	}
}

async function registryWith(scaffoldJson, templates) {
	const projectDir = makeTmpDir();
	writeScaffold(projectDir, scaffoldJson, templates);
	const r = new ScaffoldRegistry({ projectDir });
	await r.scan();
	return r;
}

describe('execute() refuses paths outside --cwd', () => {
	const probe = {
		slug: 'probe',
		name: 'Probe',
		description: 'd',
		source: 'template',
		inputs: [{ key: 'base_path', description: 'dir', default: 'includes' }],
		files: [{ src: 'x.mustache', dest: '{{base_path}}/X.php' }],
	};

	// The same EOUTSIDE guard protects every path the engine writes; a `..`
	// must be rejected whichever field carries it. One parametrised case
	// covers all three entry points rather than three copy-pasted bodies.
	const escapeCases = [
		{
			name: 'a path input',
			scaffold: probe,
			id: 'probe',
			inputs: { base_path: '../escaped' },
		},
		{
			name: 'a manifest file dest',
			scaffold: {
				...probe,
				slug: 'evil',
				files: [{ src: 'x.mustache', dest: '../evil.txt' }],
			},
			id: 'evil',
			inputs: {},
		},
		{
			name: 'a manifest test dest',
			scaffold: {
				...probe,
				slug: 'evil-test',
				files: [],
				tests: [
					{
						src: 'x.mustache',
						dest: '../tests/XTest.php',
						framework: 'phpunit',
					},
				],
			},
			id: 'evil-test',
			inputs: {},
		},
	];

	it.each(escapeCases)('rejects a `..` in $name', async (c) => {
		const r = await registryWith(c.scaffold, { 'x.mustache': 'x' });
		const target = makeTmpDir();
		await expect(
			r.execute(c.id, c.inputs, { cwd: target })
		).rejects.toMatchObject({ code: 'EWRITEFAIL', errno: 'EOUTSIDE' });
		// Nothing was written to the sibling directory the `..` pointed at.
		expect(fs.existsSync(path.join(path.dirname(target), 'escaped'))).toBe(
			false
		);
		expect(fs.existsSync(path.join(path.dirname(target), 'evil.txt'))).toBe(
			false
		);
	});

	it('still allows nested paths inside the target directory', async () => {
		const r = await registryWith(probe, { 'x.mustache': 'x' });
		const target = makeTmpDir();
		const result = await r.execute(
			'probe',
			{ base_path: 'a/b/../c' }, // normalises to a/c — inside cwd
			{ cwd: target }
		);
		expect(result.engine.wrote).toEqual(['a/b/../c/X.php']);
		expect(fs.existsSync(path.join(target, 'a/c/X.php'))).toBe(true);
	});
});

describe('disable() refuses removals outside --cwd', () => {
	const featureScaffold = {
		slug: 'feat',
		name: 'Feat',
		description: 'd',
		source: 'template',
		files: [{ src: 'x.mustache', dest: 'feat.txt', raw: true }],
		feature: {
			config_key: 'feat',
			owned_files: ['feat.txt'],
		},
	};

	it('rejects a tampered featureFiles entry pointing outside the project', async () => {
		const r = await registryWith(featureScaffold, { 'x.mustache': 'x' });
		const target = makeTmpDir();
		await r.enable('feat', {}, { cwd: target });
		// Tamper: point the persisted owned file outside the project.
		const cfgPath = path.join(target, '.wp-tooling.json');
		const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
		cfg.featureFiles.feat.ownedFiles = ['../victim.txt'];
		fs.writeFileSync(cfgPath, JSON.stringify(cfg), 'utf8');
		const victim = path.join(path.dirname(target), 'victim.txt');
		fs.writeFileSync(victim, 'precious', 'utf8');
		await expect(r.disable('feat', { cwd: target })).rejects.toMatchObject({
			code: 'EWRITEFAIL',
			errno: 'EOUTSIDE',
		});
		expect(fs.readFileSync(victim, 'utf8')).toBe('precious');
		fs.rmSync(victim, { force: true });
	});
});
