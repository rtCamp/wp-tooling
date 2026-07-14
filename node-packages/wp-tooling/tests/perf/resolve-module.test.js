'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
	findModuleDir,
	resolveModuleDir,
	resolveModuleFile,
	requireModule,
	detectModule,
} = require('../../src/perf/resolve-module');

const MODULE_NAME = 'wp-tooling-perf-fixture-module';

function tmpTree() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'perf-module-'));
}

function makeModule(dir, name, { version = '1.2.3', main } = {}) {
	const modDir = path.join(dir, 'node_modules', name);
	fs.mkdirSync(modDir, { recursive: true });
	const pkg = { name, version };
	if (main) {
		pkg.main = main;
	}
	fs.writeFileSync(path.join(modDir, 'package.json'), JSON.stringify(pkg));
	return modDir;
}

describe('findModuleDir', () => {
	let root;

	afterEach(() => {
		if (root) {
			fs.rmSync(root, { recursive: true, force: true });
			root = null;
		}
	});

	test('finds a directly installed module as local', () => {
		root = tmpTree();
		const dir = makeModule(root, MODULE_NAME);
		expect(findModuleDir(MODULE_NAME, root)).toEqual({
			dir,
			source: 'local',
		});
	});

	test('finds a hoisted module in an ancestor as hoisted', () => {
		root = tmpTree();
		const dir = makeModule(root, MODULE_NAME);
		const child = path.join(root, 'packages', 'app');
		fs.mkdirSync(child, { recursive: true });
		expect(findModuleDir(MODULE_NAME, child)).toEqual({
			dir,
			source: 'hoisted',
		});
	});

	test('returns null when no installed copy exists', () => {
		root = tmpTree();
		expect(findModuleDir('definitely-not-installed-xyz', root)).toBeNull();
	});
});

describe('resolveModuleDir / resolveModuleFile', () => {
	let root;

	afterEach(() => {
		if (root) {
			fs.rmSync(root, { recursive: true, force: true });
			root = null;
		}
	});

	test('resolves the module directory when installed', () => {
		root = tmpTree();
		const dir = makeModule(root, MODULE_NAME);
		expect(resolveModuleDir(MODULE_NAME, { cwd: root })).toBe(dir);
	});

	test('returns null when not installed', () => {
		root = tmpTree();
		expect(
			resolveModuleDir('definitely-not-installed-xyz', { cwd: root })
		).toBeNull();
	});

	test('resolves a file inside the module when it exists', () => {
		root = tmpTree();
		const dir = makeModule(root, MODULE_NAME);
		fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
		fs.writeFileSync(path.join(dir, 'dist', 'thing.js'), '// noop');
		expect(
			resolveModuleFile(MODULE_NAME, 'dist/thing.js', { cwd: root })
		).toBe(path.join(dir, 'dist', 'thing.js'));
	});

	test('returns null when the file does not exist inside an installed module', () => {
		root = tmpTree();
		makeModule(root, MODULE_NAME);
		expect(
			resolveModuleFile(MODULE_NAME, 'dist/missing.js', { cwd: root })
		).toBeNull();
	});

	test('returns null when the module itself is not installed', () => {
		root = tmpTree();
		expect(
			resolveModuleFile('definitely-not-installed-xyz', 'dist/thing.js', {
				cwd: root,
			})
		).toBeNull();
	});
});

describe('requireModule', () => {
	let root;

	afterEach(() => {
		if (root) {
			fs.rmSync(root, { recursive: true, force: true });
			root = null;
		}
	});

	test('requires and returns the resolved module', () => {
		root = tmpTree();
		const dir = makeModule(root, MODULE_NAME, { main: 'index.js' });
		fs.writeFileSync(
			path.join(dir, 'index.js'),
			'module.exports = { marker: "fixture-loaded" };'
		);
		expect(requireModule(MODULE_NAME, { cwd: root })).toEqual({
			marker: 'fixture-loaded',
		});
	});

	test('returns null when not installed', () => {
		root = tmpTree();
		expect(
			requireModule('definitely-not-installed-xyz', { cwd: root })
		).toBeNull();
	});
});

describe('detectModule', () => {
	let root;

	afterEach(() => {
		if (root) {
			fs.rmSync(root, { recursive: true, force: true });
			root = null;
		}
	});

	test('reports available with the declared version', () => {
		root = tmpTree();
		const dir = makeModule(root, MODULE_NAME, { version: '9.9.9' });
		expect(detectModule(MODULE_NAME, { cwd: root })).toEqual({
			available: true,
			version: '9.9.9',
			dir,
			source: 'local',
		});
	});

	test('reports unavailable when not installed', () => {
		root = tmpTree();
		expect(
			detectModule('definitely-not-installed-xyz', { cwd: root })
		).toEqual({
			available: false,
			version: null,
			dir: null,
			source: null,
		});
	});

	test('tolerates a package.json with no version field', () => {
		root = tmpTree();
		const modDir = path.join(root, 'node_modules', MODULE_NAME);
		fs.mkdirSync(modDir, { recursive: true });
		fs.writeFileSync(
			path.join(modDir, 'package.json'),
			JSON.stringify({ name: MODULE_NAME })
		);
		expect(detectModule(MODULE_NAME, { cwd: root }).version).toBeNull();
	});
});
