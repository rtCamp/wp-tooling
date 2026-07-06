'use strict';

jest.mock('child_process');

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
	resolveBin,
	detectBin,
	findInNodeModules,
} = require('../../src/a11y/resolve-bin');

const BIN = 'pa11y-ci';

function tmpTree() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-bin-'));
	return root;
}

function makeBin(dir, binName) {
	const binDir = path.join(dir, 'node_modules', '.bin');
	fs.mkdirSync(binDir, { recursive: true });
	const p = path.join(binDir, binName);
	fs.writeFileSync(p, '#!/bin/sh\n');
	return p;
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
		const p = makeBin(root, BIN);
		const found = findInNodeModules(BIN, root);
		expect(found).toEqual({ command: p, source: 'local' });
	});

	test('finds a hoisted binary in an ancestor as hoisted', () => {
		root = tmpTree();
		const p = makeBin(root, BIN);
		const child = path.join(root, 'packages', 'app');
		fs.mkdirSync(child, { recursive: true });
		const found = findInNodeModules(BIN, child);
		expect(found).toEqual({ command: p, source: 'hoisted' });
	});

	test('returns null when no installed copy exists', () => {
		root = tmpTree();
		expect(
			findInNodeModules('definitely-not-installed-xyz', root)
		).toBeNull();
	});
});

describe('resolveBin', () => {
	test('falls back to npx --no-install when nothing is installed', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-bin-'));
		try {
			const r = resolveBin('definitely-not-installed-xyz', { cwd: root });
			expect(r).toEqual({
				command: 'npx',
				args: ['--no-install', 'definitely-not-installed-xyz'],
				source: 'npx',
			});
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});

describe('detectBin', () => {
	test('reports available with a trimmed version when the probe succeeds', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-bin-'));
		try {
			execFileSync.mockReturnValue('3.1.0\n');
			const r = detectBin('definitely-not-installed-xyz', { cwd: root });
			expect(r.available).toBe(true);
			expect(r.version).toBe('3.1.0');
			expect(r.source).toBe('npx');
			const call = execFileSync.mock.calls[0];
			expect(call[1]).toContain('--version');
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	test('reports unavailable when the probe throws', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-bin-'));
		try {
			execFileSync.mockImplementation(() => {
				const err = new Error('not found');
				err.stderr = 'command not found';
				throw err;
			});
			const r = detectBin('definitely-not-installed-xyz', { cwd: root });
			expect(r.available).toBe(false);
			expect(r.version).toBeNull();
			expect(r.error).toMatch(/command not found/);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
