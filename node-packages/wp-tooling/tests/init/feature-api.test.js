/**
 * The FeatureApi helpers skeleton feature hooks call to flip a feature: the
 * theme's Tailwind toggle rides on readDefine / setDefine and its HMR toggle on
 * readEnv / setEnv. Each mutation must journal an undo that restores exactly
 * what it changed, and every path must stay inside the project root.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { makeFeatureApi } = require('../../src/init/features');
const { makeRoot, touch } = require('./_helpers');

const IDENTITY = { kind: 'theme', slug: 'demo', features: {} };
const UI = {
	info() {},
	warn() {},
	success() {},
	error() {},
};

const raw = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');

/**
 * Replay the api journal in reverse, as a failed transaction does.
 *
 * @param {Object} api - FeatureApi whose journal to unwind.
 */
const rollback = async (api) => {
	for (let i = api._journal.length - 1; i >= 0; i--) {
		await api._journal[i].undo();
	}
	api._journal.length = 0;
};

let root;
let api;

beforeEach(() => {
	root = makeRoot('feature-api-');
	api = makeFeatureApi(root, IDENTITY, UI);
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('readEnv / setEnv (dotenv files, the HMR toggle)', () => {
	it('reads a value, trimming whitespace and quotes', () => {
		touch(root, '.env.local', '# comment\nENABLE_HMR = "false"\nOTHER=1\n');
		expect(api.readEnv('.env.local', 'ENABLE_HMR')).toBe('false');
		expect(api.readEnv('.env.local', 'OTHER')).toBe('1');
	});

	it('returns null for a missing file or key', () => {
		expect(api.readEnv('.env.local', 'ENABLE_HMR')).toBeNull();
		touch(root, '.env.local', 'OTHER=1\n');
		expect(api.readEnv('.env.local', 'ENABLE_HMR')).toBeNull();
	});

	it('treats a key as a literal, not a pattern', () => {
		touch(root, '.env.local', 'APPxDEBUG=1\n');
		expect(api.readEnv('.env.local', 'APP.DEBUG')).toBeNull();
	});

	it('replaces an existing line in place', () => {
		touch(root, '.env.local', 'A=1\nENABLE_HMR=true\nB=2\n');
		api.setEnv('.env.local', 'ENABLE_HMR', 'false');
		expect(raw(root, '.env.local')).toBe('A=1\nENABLE_HMR=false\nB=2\n');
	});

	it('appends to a file with or without a trailing newline', () => {
		touch(root, 'a.env', 'A=1\n');
		touch(root, 'b.env', 'A=1');
		api.setEnv('a.env', 'ENABLE_HMR', 'true');
		api.setEnv('b.env', 'ENABLE_HMR', 'true');
		expect(raw(root, 'a.env')).toBe('A=1\nENABLE_HMR=true\n');
		expect(raw(root, 'b.env')).toBe('A=1\nENABLE_HMR=true\n');
	});

	it('creates the file when it is missing, and rollback removes it again', async () => {
		api.setEnv('.env.local', 'ENABLE_HMR', 'true');
		expect(raw(root, '.env.local')).toBe('ENABLE_HMR=true\n');

		await rollback(api);

		expect(fs.existsSync(path.join(root, '.env.local'))).toBe(false);
	});
});

describe('readDefine / setDefine (PHP defines, the Tailwind toggle)', () => {
	const ENTRY = 'functions.php';
	const NAME = 'DEMO_ENABLE_TAILWIND';

	it('reads true, false and a mixed-case value', () => {
		touch(root, ENTRY, `<?php\ndefine( '${NAME}', TRUE );\n`);
		expect(api.readDefine(ENTRY, NAME)).toBe(true);
		touch(root, ENTRY, `<?php\ndefine("${NAME}",false);\n`);
		expect(api.readDefine(ENTRY, NAME)).toBe(false);
	});

	it('ignores a commented-out define and returns null when absent', () => {
		touch(root, ENTRY, `<?php\n// define( '${NAME}', true );\n`);
		expect(api.readDefine(ENTRY, NAME)).toBeNull();
		expect(api.readDefine('missing.php', NAME)).toBeNull();
	});

	it('treats the define name as a literal', () => {
		touch(root, ENTRY, `<?php\ndefine( 'DEMOxENABLE', true );\n`);
		expect(api.readDefine(ENTRY, 'DEMO.ENABLE')).toBeNull();
	});

	it('flips only the live define, keeping the commented one and the layout', async () => {
		const before = `<?php\n// define( '${NAME}', true );\ndefine( '${NAME}', false );\n`;
		touch(root, ENTRY, before);

		api.setDefine(ENTRY, NAME, true);

		expect(raw(root, ENTRY)).toBe(
			`<?php\n// define( '${NAME}', true );\ndefine( '${NAME}', true );\n`
		);
		await rollback(api);
		expect(raw(root, ENTRY)).toBe(before);
	});

	it('throws when the file or the define is missing', () => {
		expect(() => api.setDefine('missing.php', NAME, true)).toThrow(
			/setDefine: missing\.php not found/
		);
		touch(root, ENTRY, '<?php\n');
		expect(() => api.setDefine(ENTRY, NAME, true)).toThrow(
			new RegExp(
				`define\\( '${NAME}', \\.\\.\\. \\) not found in ${ENTRY}`
			)
		);
	});
});

describe('writeFlag / hasDep', () => {
	it('writes .wp-features.json, merging into existing flags, and rolls back', async () => {
		api.writeFlag('tailwind', true);
		expect(JSON.parse(raw(root, '.wp-features.json'))).toEqual({
			tailwind: true,
		});
		api.writeFlag('hmr', false);
		expect(JSON.parse(raw(root, '.wp-features.json'))).toEqual({
			tailwind: true,
			hmr: false,
		});

		await rollback(api);

		expect(fs.existsSync(path.join(root, '.wp-features.json'))).toBe(false);
	});

	it('restores the previous flags file on rollback', async () => {
		touch(root, '.wp-features.json', '{\n\t"tailwind": false\n}\n');
		api.writeFlag('tailwind', true);
		await rollback(api);
		expect(raw(root, '.wp-features.json')).toBe(
			'{\n\t"tailwind": false\n}\n'
		);
	});

	it('finds a dependency in either section, and none without package.json', () => {
		expect(api.hasDep('tailwindcss')).toBe(false);
		touch(
			root,
			'package.json',
			JSON.stringify({
				dependencies: { react: '^18' },
				devDependencies: { tailwindcss: '^4' },
			})
		);
		expect(api.hasDep('tailwindcss')).toBe(true);
		expect(api.hasDep('react')).toBe(true);
		expect(api.hasDep('left-pad')).toBe(false);
	});
});

describe('write / remove / editJson', () => {
	it('rollback of a nested write removes the directories it created', async () => {
		api.write('src/css/frontend/tailwind.css', '@import "tailwindcss";\n');
		expect(fs.existsSync(path.join(root, 'src/css/frontend'))).toBe(true);

		await rollback(api);

		expect(fs.existsSync(path.join(root, 'src'))).toBe(false);
	});

	it('remove restores the file on rollback and refuses directories', async () => {
		touch(root, 'postcss.config.js', 'module.exports = {};\n');
		api.remove('postcss.config.js');
		expect(fs.existsSync(path.join(root, 'postcss.config.js'))).toBe(false);
		api.remove('not-there.js'); // a no-op, not an error

		await rollback(api);

		expect(raw(root, 'postcss.config.js')).toBe('module.exports = {};\n');
		fs.mkdirSync(path.join(root, 'build'));
		expect(() => api.remove('build')).toThrow(
			/refusing to delete directory/
		);
	});

	it('editJson names the file when it is not valid JSON', () => {
		touch(root, 'package.json', '{ nope');
		expect(() => api.editJson('package.json', () => {})).toThrow(
			/editJson: package\.json is not valid JSON/
		);
	});

	it('editJson create takes its indentation from indentFrom', () => {
		touch(root, 'package.json', '{\n    "name": "demo"\n}\n');
		api.editJson(
			'config/tooling.json',
			(obj) => {
				obj.a = 1;
			},
			{ create: true, indentFrom: 'package.json' }
		);
		expect(raw(root, 'config/tooling.json')).toBe('{\n    "a": 1\n}\n');
	});

	it('editJson without create refuses a missing file', () => {
		expect(() => api.editJson('nope.json', () => {})).toThrow(
			/editJson: nope\.json not found/
		);
	});
});

describe('paths stay inside the project', () => {
	it.each([
		['read', (a) => a.read('../outside.txt')],
		['write', (a) => a.write('../outside.txt', 'x')],
		['setEnv', (a) => a.setEnv('../.env', 'A', '1')],
		['readDefine', (a) => a.readDefine('../functions.php', 'X')],
	])('%s rejects a path that escapes the root', (_name, call) => {
		expect(() => call(api)).toThrow();
		expect(
			fs.existsSync(path.join(path.dirname(root), 'outside.txt'))
		).toBe(false);
	});
});
