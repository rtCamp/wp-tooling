/**
 * Tests for the additive feature/toggle layer:
 *   - schema/validate accept a `feature` block (and reject a malformed one)
 *   - ScaffoldRegistry.status()  reads .wp-tooling.json
 *   - ScaffoldRegistry.enable()  creates files, sets the flag, adds gitignore
 *   - ScaffoldRegistry.disable() removes owned files, honours confirmRemove,
 *                                clears the flag, removes gitignore lines
 *
 * The engine verbs are TTY-free, so these exercise them directly (no UI).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { ScaffoldRegistry } = require('../../src/scaffolds/registry');
const { readConfig, getFeatureFiles } = require('../../src/scaffolds/config');
const {
	parseArgs,
	applyChange,
	recordDeps,
} = require('../../src/scaffolds/features');

function makeTmpDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'wp-tooling-features-'));
}

// Write a project-local feature scaffold (Tailwind-shaped) into projectDir.
function writeFeatureScaffold(projectDir) {
	const dir = path.join(projectDir, 'setup', 'tailwind');
	fs.mkdirSync(path.join(dir, 'templates'), { recursive: true });
	fs.writeFileSync(
		path.join(dir, 'templates', 'postcss.config.js'),
		"module.exports = require('@rtcamp/wp-tooling/tailwind-config/postcss');\n",
		'utf8'
	);
	fs.writeFileSync(
		path.join(dir, 'templates', 'tailwind.css'),
		'@import "tailwindcss/utilities.css";\n',
		'utf8'
	);
	fs.writeFileSync(
		path.join(dir, 'scaffold.json'),
		JSON.stringify({
			slug: 'tailwind',
			category: 'setup',
			name: 'Tailwind CSS',
			description: 'Tailwind v4 build integration.',
			source: 'template',
			files: [
				{
					src: 'templates/postcss.config.js',
					dest: 'postcss.config.js',
					raw: true,
				},
				{
					src: 'templates/tailwind.css',
					dest: 'src/css/frontend/tailwind.css',
					raw: true,
				},
			],
			feature: {
				config_key: 'tailwind',
				owned_files: ['postcss.config.js'],
				confirm_remove: ['src/css/frontend/tailwind.css'],
				gitignore: ['src/css/frontend/_tailwind-theme.css'],
			},
			npm_dev_dependencies: { tailwindcss: '^4' },
		}),
		'utf8'
	);
	return projectDir;
}

async function freshRegistry() {
	const projectDir = makeTmpDir();
	writeFeatureScaffold(projectDir);
	const r = new ScaffoldRegistry({ projectDir });
	await r.scan();
	return { registry: r, projectDir };
}

describe('feature block validation', () => {
	it('rejects a feature block missing config_key', async () => {
		const projectDir = makeTmpDir();
		const dir = path.join(projectDir, 'bad');
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(
			path.join(dir, 'scaffold.json'),
			JSON.stringify({
				slug: 'bad',
				name: 'Bad',
				description: 'Bad',
				source: 'template',
				files: [],
				feature: { owned_files: ['x'] },
			}),
			'utf8'
		);
		const r = new ScaffoldRegistry({ projectDir });
		await expect(r.scan()).rejects.toThrow(/feature\.config_key/);
	});
});

describe('status()', () => {
	it('lists features as disabled when no .wp-tooling.json exists', async () => {
		const { registry } = await freshRegistry();
		const target = makeTmpDir();
		const status = registry.status(target);
		expect(status).toHaveLength(1);
		expect(status[0]).toMatchObject({
			id: 'setup/tailwind',
			configKey: 'tailwind',
			enabled: false,
		});
	});

	it('reflects an enabled flag from .wp-tooling.json', async () => {
		const { registry } = await freshRegistry();
		const target = makeTmpDir();
		fs.writeFileSync(
			path.join(target, '.wp-tooling.json'),
			JSON.stringify({ features: { tailwind: true } })
		);
		expect(registry.status(target)[0].enabled).toBe(true);
	});
});

describe('enable()', () => {
	it('creates files, sets the flag, and adds gitignore lines', async () => {
		const { registry } = await freshRegistry();
		const target = makeTmpDir();
		const result = await registry.enable(
			'setup/tailwind',
			{},
			{ cwd: target }
		);

		expect(result.feature).toMatchObject({
			configKey: 'tailwind',
			enabled: true,
		});
		expect(fs.existsSync(path.join(target, 'postcss.config.js'))).toBe(
			true
		);
		expect(
			fs.existsSync(path.join(target, 'src/css/frontend/tailwind.css'))
		).toBe(true);
		expect(readConfig(target).features.tailwind).toBe(true);
		expect(
			fs.readFileSync(path.join(target, '.gitignore'), 'utf8')
		).toContain('src/css/frontend/_tailwind-theme.css');
		// Engine reports the dep, does not install it.
		expect(result.developer.install.npmDev).toEqual({ tailwindcss: '^4' });
	});

	it('is idempotent on re-enable (existing files skipped, flag stays true)', async () => {
		const { registry } = await freshRegistry();
		const target = makeTmpDir();
		await registry.enable('setup/tailwind', {}, { cwd: target });
		const second = await registry.enable(
			'setup/tailwind',
			{},
			{ cwd: target }
		);
		expect(second.engine.wrote).toEqual([]);
		expect(second.engine.skipped).toContain('postcss.config.js');
		expect(readConfig(target).features.tailwind).toBe(true);
		// gitignore line not duplicated
		const gi = fs.readFileSync(path.join(target, '.gitignore'), 'utf8');
		expect(
			gi
				.split('\n')
				.filter((l) => l === 'src/css/frontend/_tailwind-theme.css')
		).toHaveLength(1);
	});

	it('renders {{placeholder}} gitignore lines against resolved inputs', async () => {
		// A feature whose gitignore line uses an input placeholder — it must be
		// Mustache-rendered before reaching .gitignore, exactly like owned_files.
		const projectDir = makeTmpDir();
		const dir = path.join(projectDir, 'setup', 'css');
		fs.mkdirSync(path.join(dir, 'templates'), { recursive: true });
		fs.writeFileSync(path.join(dir, 'templates', 'x.txt'), 'x\n', 'utf8');
		fs.writeFileSync(
			path.join(dir, 'scaffold.json'),
			JSON.stringify({
				slug: 'css',
				category: 'setup',
				name: 'CSS',
				description: 'd',
				source: 'template',
				inputs: [
					{
						key: 'css_dir',
						description: 'CSS dir',
						default: 'src/css/frontend',
					},
				],
				files: [{ src: 'templates/x.txt', dest: 'x.txt', raw: true }],
				feature: {
					config_key: 'css',
					gitignore: ['{{css_dir}}/_generated.css'],
				},
			}),
			'utf8'
		);
		const r = new ScaffoldRegistry({ projectDir });
		await r.scan();
		const target = makeTmpDir();

		const result = await r.enable('setup/css', {}, { cwd: target });
		const gi = fs.readFileSync(path.join(target, '.gitignore'), 'utf8');
		expect(gi).toContain('src/css/frontend/_generated.css');
		expect(gi).not.toContain('{{css_dir}}'); // never leak the raw placeholder
		expect(result.feature.gitignoreAdded).toContain(
			'src/css/frontend/_generated.css'
		);
		// The disable side (removing the *rendered* line) is covered by the
		// 'enable()/disable() mirror via persisted feature files' block below.
	});

	it('throws ENOTFEATURE for a non-feature scaffold', async () => {
		const projectDir = makeTmpDir();
		const dir = path.join(projectDir, 'plain');
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(
			path.join(dir, 'scaffold.json'),
			JSON.stringify({
				slug: 'plain',
				name: 'Plain',
				description: 'Plain',
				source: 'template',
				files: [],
			}),
			'utf8'
		);
		const r = new ScaffoldRegistry({ projectDir });
		await r.scan();
		await expect(
			r.enable('plain', {}, { cwd: makeTmpDir() })
		).rejects.toMatchObject({ code: 'ENOTFEATURE' });
	});
});

describe('disable()', () => {
	async function enabledTarget() {
		const { registry } = await freshRegistry();
		const target = makeTmpDir();
		await registry.enable('setup/tailwind', {}, { cwd: target });
		return { registry, target };
	}

	it('removes owned files, clears the flag, and removes gitignore lines', async () => {
		const { registry, target } = await enabledTarget();
		const result = await registry.disable('setup/tailwind', {
			cwd: target,
		});

		expect(result.removed).toContain('postcss.config.js');
		expect(fs.existsSync(path.join(target, 'postcss.config.js'))).toBe(
			false
		);
		expect(readConfig(target).features.tailwind).toBe(false);
		expect(
			fs.readFileSync(path.join(target, '.gitignore'), 'utf8')
		).not.toContain('_tailwind-theme.css');
	});

	it('keeps a confirm_remove file when confirmRemove is absent', async () => {
		const { registry, target } = await enabledTarget();
		const result = await registry.disable('setup/tailwind', {
			cwd: target,
		});
		expect(result.kept).toContain('src/css/frontend/tailwind.css');
		expect(
			fs.existsSync(path.join(target, 'src/css/frontend/tailwind.css'))
		).toBe(true);
	});

	it('removes a confirm_remove file when confirmRemove returns true', async () => {
		const { registry, target } = await enabledTarget();
		const result = await registry.disable('setup/tailwind', {
			cwd: target,
			confirmRemove: () => Promise.resolve(true),
		});
		expect(result.removed).toContain('src/css/frontend/tailwind.css');
		expect(
			fs.existsSync(path.join(target, 'src/css/frontend/tailwind.css'))
		).toBe(false);
	});

	it('reports missing files and is a safe no-op when already disabled', async () => {
		const { registry } = await freshRegistry();
		const target = makeTmpDir(); // nothing enabled / created
		const result = await registry.disable('setup/tailwind', {
			cwd: target,
		});
		expect(result.removed).toEqual([]);
		expect(result.missing).toContain('postcss.config.js');
		expect(readConfig(target).features.tailwind).toBe(false);
	});
});

describe('enable()/disable() mirror via persisted feature files', () => {
	// A feature whose paths depend on an input: disable must remove exactly
	// what enable created, even when the enable-time input (a one-off
	// `css_dir` here) is not supplied again on disable.
	async function placeholderRegistry() {
		const projectDir = makeTmpDir();
		const dir = path.join(projectDir, 'setup', 'css');
		fs.mkdirSync(path.join(dir, 'templates'), { recursive: true });
		fs.writeFileSync(path.join(dir, 'templates', 'x.css'), 'x\n', 'utf8');
		fs.writeFileSync(
			path.join(dir, 'scaffold.json'),
			JSON.stringify({
				slug: 'css',
				category: 'setup',
				name: 'CSS',
				description: 'd',
				source: 'template',
				inputs: [
					{
						key: 'css_dir',
						description: 'CSS dir',
						default: 'src/css/frontend',
					},
				],
				files: [
					{
						src: 'templates/x.css',
						dest: '{{css_dir}}/x.css',
						raw: true,
					},
				],
				feature: {
					config_key: 'css',
					owned_files: ['{{css_dir}}/x.css'],
					gitignore: ['{{css_dir}}/_generated.css'],
				},
			}),
			'utf8'
		);
		const r = new ScaffoldRegistry({ projectDir });
		await r.scan();
		return r;
	}

	it('persists rendered file lists on enable', async () => {
		const r = await placeholderRegistry();
		const target = makeTmpDir();
		await r.enable('setup/css', { css_dir: 'custom/css' }, { cwd: target });
		expect(getFeatureFiles(target, 'css')).toEqual({
			ownedFiles: ['custom/css/x.css'],
			confirmRemove: [],
			gitignore: ['custom/css/_generated.css'],
		});
	});

	it('disable removes the enable-time paths without re-supplying inputs', async () => {
		const r = await placeholderRegistry();
		const target = makeTmpDir();
		await r.enable('setup/css', { css_dir: 'custom/css' }, { cwd: target });

		// No inputs here — before persistence, css_dir would re-resolve to its
		// default and the custom paths would be orphaned.
		const result = await r.disable('setup/css', { cwd: target });

		expect(result.removed).toContain('custom/css/x.css');
		expect(fs.existsSync(path.join(target, 'custom/css/x.css'))).toBe(
			false
		);
		expect(
			fs.readFileSync(path.join(target, '.gitignore'), 'utf8')
		).not.toContain('custom/css/_generated.css');
		expect(getFeatureFiles(target, 'css')).toBeNull(); // tidy after disable
	});
});

describe('recordDeps()', () => {
	function projectWithPackageJson(raw) {
		const cwd = makeTmpDir();
		fs.writeFileSync(path.join(cwd, 'package.json'), raw, 'utf8');
		return cwd;
	}

	it('records missing deps sorted, preserving tab indentation', () => {
		const cwd = projectWithPackageJson(
			'{\n\t"name": "x",\n\t"devDependencies": {\n\t\t"zeta": "^1"\n\t}\n}\n'
		);
		const added = recordDeps(
			{ npm: {}, npmDev: { tailwindcss: '^4', alpha: '^2' } },
			cwd
		);
		expect(added.sort()).toEqual(['alpha@^2', 'tailwindcss@^4']);
		const raw = fs.readFileSync(path.join(cwd, 'package.json'), 'utf8');
		expect(raw).toContain('\t"devDependencies"');
		expect(raw).not.toContain('  "devDependencies"');
		const pkg = JSON.parse(raw);
		expect(Object.keys(pkg.devDependencies)).toEqual([
			'alpha',
			'tailwindcss',
			'zeta',
		]);
	});

	it('never overwrites an existing version range', () => {
		const cwd = projectWithPackageJson(
			JSON.stringify({ devDependencies: { tailwindcss: '^3' } }) + '\n'
		);
		const added = recordDeps({ npmDev: { tailwindcss: '^4' } }, cwd);
		expect(added).toEqual([]);
		const pkg = JSON.parse(
			fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')
		);
		expect(pkg.devDependencies.tailwindcss).toBe('^3');
	});

	it('is a no-op without a package.json', () => {
		expect(recordDeps({ npmDev: { a: '^1' } }, makeTmpDir())).toEqual([]);
	});

	it('applyChange with install:false, record:true records deps instead of installing', async () => {
		const { registry } = await freshRegistry();
		const target = makeTmpDir();
		fs.writeFileSync(
			path.join(target, 'package.json'),
			'{\n\t"name": "x"\n}\n',
			'utf8'
		);
		const summary = await applyChange(
			registry,
			{ id: 'setup/tailwind', target: true },
			{ cwd: target, dryRun: false, install: false, record: true }
		);
		expect(summary.installed).toBe(false);
		expect(summary.recorded).toEqual(['tailwindcss@^4']);
		const pkg = JSON.parse(
			fs.readFileSync(path.join(target, 'package.json'), 'utf8')
		);
		expect(pkg.devDependencies).toEqual({ tailwindcss: '^4' });
	});

	it('applyChange with plain install:false reports deps without touching package.json', async () => {
		const { registry } = await freshRegistry();
		const target = makeTmpDir();
		const raw = '{\n\t"name": "x"\n}\n';
		fs.writeFileSync(path.join(target, 'package.json'), raw, 'utf8');
		const summary = await applyChange(
			registry,
			{ id: 'setup/tailwind', target: true },
			{ cwd: target, dryRun: false, install: false }
		);
		expect(summary.installed).toBe(false);
		expect(summary.recorded).toEqual([]);
		expect(summary.install.npmDev).toEqual({ tailwindcss: '^4' });
		// Consent contract: no-install must not edit package.json.
		expect(fs.readFileSync(path.join(target, 'package.json'), 'utf8')).toBe(
			raw
		);
	});
});

describe('parseArgs()', () => {
	// The missing/flag-shaped-value contract is pinned in cli-support.test.js;
	// here we smoke-test the wiring and the features-specific flags.
	it('wires the shared value guard for --enable', () => {
		expect(() => parseArgs(['--enable'])).toThrow(
			/Missing value for --enable/
		);
	});

	it('accepts --flag=value and repeated flags', () => {
		const opts = parseArgs(['--enable=tailwind', '--disable', 'other']);
		expect(opts.enable).toEqual(['tailwind']);
		expect(opts.disable).toEqual(['other']);
		expect(opts.nonInteractive).toBe(true);
	});

	it('parses --record-deps (off by default)', () => {
		expect(parseArgs([]).record).toBe(false);
		expect(parseArgs(['--record-deps']).record).toBe(true);
	});
});

describe('applyChange disable summary', () => {
	it('includes the documented `missing` list', async () => {
		const { registry } = await freshRegistry();
		const target = makeTmpDir();
		await applyChange(
			registry,
			{ id: 'setup/tailwind', target: true },
			{ cwd: target, dryRun: false, install: false }
		);
		// Remove an owned file by hand so disable reports it as missing.
		fs.rmSync(path.join(target, 'postcss.config.js'), { force: true });
		const summary = await applyChange(
			registry,
			{ id: 'setup/tailwind', target: false },
			{ cwd: target, dryRun: false, install: false }
		);
		expect(summary.action).toBe('disabled');
		expect(summary.missing).toEqual(['postcss.config.js']);
	});
});
