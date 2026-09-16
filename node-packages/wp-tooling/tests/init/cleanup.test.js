'use strict';
const { runCleanup } = require('../../src/init/cleanup');
const fs = require('fs');
const path = require('path');
const { makeRoot, touch } = require('./_helpers');

describe('runCleanup', () => {
	let root;
	const ui = { info: jest.fn() };
	beforeEach(() => {
		root = makeRoot();
	});
	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
		jest.restoreAllMocks();
	});
	test('cleanup validates all paths before deleting any target', () => {
		touch(root, 'keep.txt', 'keep');
		expect(() => runCleanup(root, ['keep.txt', '.'], ui)).toThrow(
			/project root/
		);
		expect(fs.readFileSync(path.join(root, 'keep.txt'), 'utf8')).toBe(
			'keep'
		);
	});

	test.each(['keep.txt', {}, [null]])(
		'rejects malformed cleanup targets %j before deletion',
		(targets) => {
			touch(root, 'keep.txt', 'keep');
			expect(() => runCleanup(root, targets, ui)).toThrow(/Expected/);
			expect(fs.readFileSync(path.join(root, 'keep.txt'), 'utf8')).toBe(
				'keep'
			);
		}
	);
	test('removes files and directories and skips missing targets', () => {
		touch(root, 'file.txt');
		touch(root, 'nested/file.txt');
		expect(runCleanup(root, ['file.txt', 'nested', 'missing'], ui)).toBe(2);
		expect(fs.readdirSync(root)).toEqual([]);
	});
});
