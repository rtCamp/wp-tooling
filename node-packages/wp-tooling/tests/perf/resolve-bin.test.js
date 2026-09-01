'use strict';

jest.mock('child_process');

const fs = require('fs');
const os = require('os');
const path = require('path');

const { execFileSync } = require('child_process');
const {
	findInNodeModules,
	resolveBin,
	detectBin,
} = require('../../src/perf/resolve-bin');

const BIN_NAME = 'wp-tooling-perf-fixture-bin';

function tmpTree() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'perf-bin-'));
}

function makeBin(dir, name) {
	const binDir = path.join(dir, 'node_modules', '.bin');
	fs.mkdirSync(binDir, { recursive: true });
	const binPath = path.join(binDir, name);
	fs.writeFileSync(binPath, '#!/usr/bin/env node\n');
	return binPath;
}

describe('findInNodeModules', () => {
	let root;

	afterEach(() => {
		if (root) {
			fs.rmSync(root, { recursive: true, force: true });
			root = null;
		}
	});

	test('finds a directly installed binary as local', () => {
		root = tmpTree();
		const binPath = makeBin(root, BIN_NAME);
		expect(findInNodeModules(BIN_NAME, root)).toEqual({
			command: binPath,
			source: 'local',
		});
	});

	test('finds a hoisted binary in an ancestor as hoisted', () => {
		root = tmpTree();
		const binPath = makeBin(root, BIN_NAME);
		const child = path.join(root, 'packages', 'app');
		fs.mkdirSync(child, { recursive: true });
		expect(findInNodeModules(BIN_NAME, child)).toEqual({
			command: binPath,
			source: 'hoisted',
		});
	});

	test('returns null when no installed copy exists', () => {
		root = tmpTree();
		expect(
			findInNodeModules('definitely-not-installed-xyz', root)
		).toBeNull();
	});
});

describe('resolveBin', () => {
	let root;

	afterEach(() => {
		if (root) {
			fs.rmSync(root, { recursive: true, force: true });
			root = null;
		}
	});

	test('resolves a locally installed binary with no extra args', () => {
		root = tmpTree();
		const binPath = makeBin(root, BIN_NAME);
		expect(resolveBin(BIN_NAME, { cwd: root })).toEqual({
			command: binPath,
			args: [],
			source: 'local',
		});
	});

	test('resolves a hoisted binary from a child directory', () => {
		root = tmpTree();
		const binPath = makeBin(root, BIN_NAME);
		const child = path.join(root, 'packages', 'app');
		fs.mkdirSync(child, { recursive: true });
		expect(resolveBin(BIN_NAME, { cwd: child })).toEqual({
			command: binPath,
			args: [],
			source: 'hoisted',
		});
	});

	test('falls back to npx --no-install when not installed', () => {
		root = tmpTree();
		expect(
			resolveBin('definitely-not-installed-xyz', { cwd: root })
		).toEqual({
			command: 'npx',
			args: ['--no-install', 'definitely-not-installed-xyz'],
			source: 'npx',
		});
	});
});

describe('detectBin', () => {
	let root;

	afterEach(() => {
		execFileSync.mockReset();
		if (root) {
			fs.rmSync(root, { recursive: true, force: true });
			root = null;
		}
	});

	test('reports available with the trimmed --version output', () => {
		root = tmpTree();
		const binPath = makeBin(root, BIN_NAME);
		execFileSync.mockReturnValue('1.2.3\n');
		expect(detectBin(BIN_NAME, { cwd: root })).toEqual({
			available: true,
			version: '1.2.3',
			command: binPath,
			args: [],
			source: 'local',
		});
		expect(execFileSync).toHaveBeenCalledWith(
			binPath,
			['--version'],
			expect.objectContaining({ cwd: root })
		);
	});

	test('reports unavailable with the error detail when the probe fails', () => {
		root = tmpTree();
		execFileSync.mockImplementation(() => {
			const err = new Error('spawn npx ENOENT');
			err.stderr = 'not found\n';
			throw err;
		});
		const result = detectBin('definitely-not-installed-xyz', { cwd: root });
		expect(result).toEqual({
			available: false,
			version: null,
			command: 'npx',
			args: ['--no-install', 'definitely-not-installed-xyz'],
			source: 'npx',
			error: 'not found',
		});
	});
});
