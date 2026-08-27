/**
 * Tests for src/init/persist.js -- the .wp-scaffold.json read/write layer,
 * including the corrupt-vs-missing distinction the --list contract relies on.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const {
	readIdentityFile,
	writeIdentityFile,
	writeFeatures,
	IdentityFileError,
	IDENTITY_FILE,
} = require('../../src/init/persist');
const { makeRoot } = require('./_helpers');

let root;

beforeEach(() => {
	root = makeRoot('persist-');
});

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

describe('readIdentityFile', () => {
	it('returns null when the file is absent', () => {
		expect(readIdentityFile(root)).toBeNull();
	});

	it('returns the parsed object for a valid file', () => {
		writeIdentityFile(root, { name: 'X', features: { hmr: true } });
		expect(readIdentityFile(root)).toEqual({
			name: 'X',
			features: { hmr: true },
		});
	});

	it('throws EIDENTITYCORRUPT (not null) for an unparseable file', () => {
		fs.writeFileSync(path.join(root, IDENTITY_FILE), '{broken');
		let caught;
		try {
			readIdentityFile(root);
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(IdentityFileError);
		expect(caught.code).toBe('EIDENTITYCORRUPT');
		expect(caught.path).toBe(path.join(root, IDENTITY_FILE));
		expect(caught.message).toMatch(/--reinit/);
	});

	it.each([
		['null', 'null'],
		['an array', '[]'],
		['a string', '"a string"'],
		['a number', '42'],
	])(
		'throws EIDENTITYCORRUPT (not null) when the file parses to %s',
		(_label, raw) => {
			fs.writeFileSync(path.join(root, IDENTITY_FILE), raw);
			let caught;
			try {
				readIdentityFile(root);
			} catch (err) {
				caught = err;
			}
			expect(caught).toBeInstanceOf(IdentityFileError);
			expect(caught.code).toBe('EIDENTITYCORRUPT');
		}
	);
});

describe('writeFeatures', () => {
	it('updates features while preserving the examples record', () => {
		writeIdentityFile(root, {
			name: 'X',
			examples: { removed: ['cron'] },
			features: { hmr: false },
		});
		writeFeatures(root, { hmr: true });
		expect(readIdentityFile(root)).toEqual({
			name: 'X',
			examples: { removed: ['cron'] },
			features: { hmr: true },
		});
	});
});
