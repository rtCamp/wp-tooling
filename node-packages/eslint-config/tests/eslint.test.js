'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

// Paths are virtual: the files are linted from source and never read from disk.
const FILES = {
	'src/Logo.jsx': 'export const Logo = () => <img src="logo.png" />;\n',
	'src/answer.js': '/* eslint-disable */\nexport const answer = 42;\n',
	'src/sum.test.js': "it('works', () => {});\n",
	'src/focused.test.js':
		"test.only('works', () => {\n\texpect(true).toBe(true);\n});\n",
	'src/__tests__/sum.js': '',
	'test/sum.spec.jsx': '',
	'src/sum.ts':
		'export const sum = (a: number, b: number): number => a + b;\n',
	'src/sum.test.ts':
		"it('adds', () => {\n\tconst total: number = 3;\n\texpect(total).toBe(3);\n});\n",
	'test/x.spec.mts': 'export const answer: number = 42;\n',
	'build/index.js': '',
	'vendor/lib.js': '',
};

const lint = (configFile) =>
	JSON.parse(
		execFileSync(
			process.execPath,
			[
				path.join(__dirname, 'lint-files.js'),
				path.join(__dirname, '..', configFile),
			],
			{ input: JSON.stringify(FILES), encoding: 'utf8' }
		)
	);

const hasRulesFrom = (result, plugin) =>
	result.rules.some((rule) => rule.startsWith(`${plugin}/`));

describe('default config', () => {
	let results;

	beforeAll(() => {
		results = lint('index.js');
	});

	it('lints .jsx files', () => {
		expect(results['src/Logo.jsx'].ruleIds).toContain('jsx-a11y/alt-text');
	});

	it.each(['build/index.js', 'vendor/lib.js'])('ignores %s', (filePath) => {
		expect(results[filePath].ignored).toBe(true);
	});

	// A parse error or an unmatched file reports a message with no rule ID.
	it.each(['src/sum.ts', 'src/sum.test.ts', 'test/x.spec.mts'])(
		'parses TypeScript in %s',
		(filePath) => {
			expect(results[filePath].ignored).toBe(false);
			expect(results[filePath].ruleIds).not.toContain(null);
			expect(hasRulesFrom(results[filePath], '@typescript-eslint')).toBe(
				true
			);
		}
	);

	it.each([
		'src/sum.test.js',
		'src/__tests__/sum.js',
		'test/sum.spec.jsx',
		'src/sum.test.ts',
		'test/x.spec.mts',
	])('applies Vitest rules, not Jest rules, to %s', (filePath) => {
		expect(hasRulesFrom(results[filePath], 'vitest')).toBe(true);
		expect(hasRulesFrom(results[filePath], 'jest')).toBe(false);
	});

	it('reports Vitest rule violations in test files', () => {
		expect(results['src/sum.test.js'].ruleIds).toContain(
			'vitest/expect-expect'
		);
	});

	it('leaves source files free of test rules', () => {
		expect(hasRulesFrom(results['src/answer.js'], 'vitest')).toBe(false);
	});

	it('reports unpaired eslint-disable comments', () => {
		expect(results['src/answer.js'].ruleIds).toContain(
			'@eslint-community/eslint-comments/disable-enable-pair'
		);
	});
});

describe('package entry points', () => {
	// Loaded by name in a child process run from the package root, so Node resolves the
	// package through its own `exports`: ESM finds a subpath like `/jest` only there.
	const load = (specifier, inputType) =>
		execFileSync(
			process.execPath,
			[
				`--input-type=${inputType}`,
				'--eval',
				inputType === 'module'
					? `import config from '${specifier}'; process.stdout.write(String(config.length));`
					: `process.stdout.write(String(require('${specifier}').length));`,
			],
			{ cwd: path.join(__dirname, '..'), encoding: 'utf8' }
		);

	it.each([
		['@rtcamp/eslint-config', 'module'],
		['@rtcamp/eslint-config/jest', 'module'],
		['@rtcamp/eslint-config', 'commonjs'],
		['@rtcamp/eslint-config/jest', 'commonjs'],
	])('loads %s as %s', (specifier, inputType) => {
		expect(Number(load(specifier, inputType))).toBeGreaterThan(0);
	});
});

describe('jest config', () => {
	let results;

	beforeAll(() => {
		results = lint('jest.js');
	});

	it.each(['src/sum.test.js', 'src/sum.test.ts'])(
		'applies Jest rules, not Vitest rules, to %s',
		(filePath) => {
			expect(hasRulesFrom(results[filePath], 'jest')).toBe(true);
			expect(hasRulesFrom(results[filePath], 'vitest')).toBe(false);
		}
	);

	it('reports Jest rule violations in test files', () => {
		expect(results['src/focused.test.js'].ruleIds).toContain(
			'jest/no-focused-tests'
		);
	});

	it('keeps the shared ignores and .jsx discovery', () => {
		expect(results['build/index.js'].ignored).toBe(true);
		expect(results['src/Logo.jsx'].ruleIds).toContain('jsx-a11y/alt-text');
	});
});
