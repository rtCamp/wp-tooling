'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
	resolveBin,
	detectBin,
	findInNodeModules,
} = require('../../src/a11y/resolve-bin');

const BIN = 'pa11y-ci';
let root;

function makePackage(dir, bin = { [BIN]: './bin/cli.js' }) {
	const packageDir = path.join(dir, 'node_modules', BIN);
	fs.mkdirSync(path.join(packageDir, 'bin'), { recursive: true });
	fs.writeFileSync(
		path.join(packageDir, 'package.json'),
		JSON.stringify({ name: BIN, bin })
	);
	const entry = path.join(packageDir, 'bin', 'cli.js');
	fs.writeFileSync(entry, 'console.log("4.1.1");\n');
	return { packageDir, entry };
}

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y bin & spaces-'));
});

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

describe('Node CLI resolution', () => {
	test('resolves a local package entry, bypassing POSIX and Windows shims', () => {
		const { entry } = makePackage(root);
		const binDir = path.join(root, 'node_modules', '.bin');
		fs.mkdirSync(binDir);
		fs.writeFileSync(path.join(binDir, BIN), '#!/bin/sh\nexit 99\n');
		fs.writeFileSync(path.join(binDir, `${BIN}.cmd`), '@exit /b 99\r\n');
		expect(resolveBin(BIN, { cwd: root })).toEqual({
			command: process.execPath,
			args: [entry],
			source: 'local',
		});
		expect(detectBin(BIN, { cwd: root })).toMatchObject({
			available: true,
			version: '4.1.1',
			source: 'local',
		});
	});

	test('resolves a hoisted package and a string bin declaration', () => {
		const { entry, packageDir } = makePackage(root, './bin/cli.js');
		const child = path.join(root, 'packages', 'app');
		fs.mkdirSync(child, { recursive: true });
		expect(findInNodeModules(BIN, child)).toEqual({
			packageDir,
			source: 'hoisted',
		});
		expect(resolveBin(BIN, { cwd: child })).toEqual({
			command: process.execPath,
			args: [entry],
			source: 'hoisted',
		});
		expect(detectBin(BIN, { cwd: child }).available).toBe(true);
	});

	test('uses the nearest package instead of a hoisted copy', () => {
		makePackage(root);
		const child = path.join(root, 'packages', 'app');
		const { entry } = makePackage(child);
		expect(resolveBin(BIN, { cwd: child }).args).toEqual([entry]);
	});

	test('reports a missing installation without probing Node or npx', () => {
		expect(
			findInNodeModules('definitely-not-installed-xyz', root)
		).toBeNull();
		expect(
			detectBin('definitely-not-installed-xyz', { cwd: root })
		).toEqual({
			command: process.execPath,
			args: [],
			source: 'missing',
			available: false,
			version: null,
		});
	});

	test('preserves stderr when an installed CLI cannot start', () => {
		const { entry } = makePackage(root);
		fs.writeFileSync(
			entry,
			'console.error("Unsupported Node version"); process.exit(1);'
		);
		expect(detectBin(BIN, { cwd: root })).toMatchObject({
			available: false,
			source: 'local',
			error: 'Unsupported Node version',
		});
	});

	test('reports a missing entry file as an installed package failure', () => {
		makePackage(root, './missing.js');
		expect(detectBin(BIN, { cwd: root })).toMatchObject({
			available: false,
			source: 'local',
			error: expect.stringContaining('missing.js'),
		});
	});

	test('does not fall back to a hoisted package when the local manifest is corrupt', () => {
		makePackage(root);
		const child = path.join(root, 'packages', 'app');
		const { packageDir } = makePackage(child);
		fs.writeFileSync(path.join(packageDir, 'package.json'), '{');
		expect(detectBin(BIN, { cwd: child })).toMatchObject({
			available: false,
			source: 'local',
			error: expect.any(String),
		});
	});

	test('reports an invalid bin declaration as an installed package failure', () => {
		makePackage(root, {});
		expect(detectBin(BIN, { cwd: root })).toMatchObject({
			available: false,
			source: 'local',
			error: expect.stringContaining('Expected a bin entry'),
		});
	});
});
