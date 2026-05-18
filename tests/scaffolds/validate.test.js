'use strict';

const { validate } = require('../../src/scaffolds/validate');

const SOURCE_PATH = '/fake/scaffolds/example/scaffold.json';

/**
 * Build a minimal valid scaffold. Tests override individual fields to
 * trigger each rule in isolation.
 *
 * @param {Object} [overrides]
 * @return {Object} Scaffold definition.
 */
function buildScaffold(overrides = {}) {
	return {
		slug: 'example',
		name: 'Example',
		description: 'An example scaffold',
		source: 'template',
		files: [{ src: 'templates/example.mustache', dest: 'src/example.php' }],
		...overrides,
	};
}

describe('validate()', () => {
	test('returns [] for a fully valid scaffold', () => {
		expect(validate(buildScaffold(), SOURCE_PATH)).toEqual([]);
	});

	test('returns [] for a valid source:package scaffold with empty files', () => {
		const scaffold = buildScaffold({
			source: 'package',
			module_class: 'Inc\\Module\\Cache',
			files: [],
		});
		expect(validate(scaffold, SOURCE_PATH)).toEqual([]);
	});

	test('returns [] when wizard_step is omitted', () => {
		const scaffold = buildScaffold();
		expect(validate(scaffold, SOURCE_PATH)).toEqual([]);
	});

	test('returns [] when wizard_step is explicit null', () => {
		const scaffold = buildScaffold({ wizard_step: null });
		expect(validate(scaffold, SOURCE_PATH)).toEqual([]);
	});

	test('rejects non-object input', () => {
		const errors = validate('nope', SOURCE_PATH);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain('scaffold must be a JSON object');
	});

	test.each(['slug', 'name', 'description', 'source', 'files'])(
		'flags missing required field "%s"',
		(field) => {
			const scaffold = buildScaffold();
			delete scaffold[field];
			const errors = validate(scaffold, SOURCE_PATH);
			expect(errors.some((e) => e.includes(`"${field}"`))).toBe(true);
		}
	);

	test('rejects non-kebab slug', () => {
		const errors = validate(
			buildScaffold({ slug: 'NotKebab_Case' }),
			SOURCE_PATH
		);
		expect(errors.some((e) => e.includes('kebab-case'))).toBe(true);
	});

	test('rejects unknown source', () => {
		const errors = validate(
			buildScaffold({ source: 'fancy' }),
			SOURCE_PATH
		);
		expect(errors.some((e) => e.includes('source must be one of'))).toBe(
			true
		);
	});

	test('rejects unknown wizard_step', () => {
		const errors = validate(
			buildScaffold({ wizard_step: 'options' }),
			SOURCE_PATH
		);
		expect(
			errors.some((e) => e.includes('wizard_step must be one of'))
		).toBe(true);
	});

	test('rejects non-array files', () => {
		const errors = validate(buildScaffold({ files: 'nope' }), SOURCE_PATH);
		expect(errors.some((e) => e.includes('files must be an array'))).toBe(
			true
		);
	});

	test('rejects file entries missing src', () => {
		const errors = validate(
			buildScaffold({ files: [{ dest: 'x' }] }),
			SOURCE_PATH
		);
		expect(errors.some((e) => e.includes('files[0] missing'))).toBe(true);
		expect(errors.some((e) => e.includes('"src"'))).toBe(true);
	});

	test('rejects file entries missing dest', () => {
		const errors = validate(
			buildScaffold({ files: [{ src: 'x' }] }),
			SOURCE_PATH
		);
		expect(errors.some((e) => e.includes('files[0] missing'))).toBe(true);
		expect(errors.some((e) => e.includes('"dest"'))).toBe(true);
	});

	test('rejects non-string slug', () => {
		const errors = validate(buildScaffold({ slug: 7 }), SOURCE_PATH);
		expect(errors.some((e) => e.includes('kebab-case'))).toBe(true);
	});

	test('rejects non-string module_class', () => {
		const errors = validate(
			buildScaffold({ module_class: 42 }),
			SOURCE_PATH
		);
		expect(errors.some((e) => e.includes('module_class'))).toBe(true);
	});

	test('rejects non-object dependency map', () => {
		const errors = validate(
			buildScaffold({ npm_dependencies: 'nope' }),
			SOURCE_PATH
		);
		expect(
			errors.some((e) => e.includes('npm_dependencies must be an object'))
		).toBe(true);
	});

	test.each([
		'npm_dependencies',
		'npm_dev_dependencies',
		'composer_dependencies',
		'composer_dev_dependencies',
		'composer_suggest',
	])('rejects non-string version range in %s', (mapName) => {
		const errors = validate(
			buildScaffold({ [mapName]: { react: 18 } }),
			SOURCE_PATH
		);
		expect(errors.some((e) => e.includes(`${mapName}["react"]`))).toBe(
			true
		);
	});

	test('rejects empty-string version range', () => {
		const errors = validate(
			buildScaffold({ npm_dependencies: { react: '' } }),
			SOURCE_PATH
		);
		expect(
			errors.some((e) => e.includes('npm_dependencies["react"]'))
		).toBe(true);
	});

	test('rejects null version range', () => {
		const errors = validate(
			buildScaffold({ npm_dependencies: { react: null } }),
			SOURCE_PATH
		);
		expect(
			errors.some((e) => e.includes('npm_dependencies["react"]'))
		).toBe(true);
	});

	test('rejects array version range', () => {
		const errors = validate(
			buildScaffold({ npm_dependencies: { react: ['^18.0'] } }),
			SOURCE_PATH
		);
		expect(
			errors.some((e) => e.includes('npm_dependencies["react"]'))
		).toBe(true);
	});

	test('accepts valid composer @dev marker', () => {
		const errors = validate(
			buildScaffold({
				composer_dependencies: { 'rtcamp/wp-php-toolkit': '@dev' },
			}),
			SOURCE_PATH
		);
		expect(errors).toEqual([]);
	});

	test('every error message is prefixed with the source path', () => {
		const errors = validate(
			buildScaffold({ slug: 'BAD', source: 'BAD' }),
			SOURCE_PATH
		);
		expect(errors.length).toBeGreaterThan(0);
		for (const e of errors) {
			expect(e.startsWith(`${SOURCE_PATH}:`)).toBe(true);
		}
	});
});
