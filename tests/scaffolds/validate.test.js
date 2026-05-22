/**
 * Tests for src/scaffolds/validate.js.
 *
 * Covers required-field detection, enum validation, regex patterns,
 * and all four manifest extensions (inputs, wiring, tests, secrets).
 */

'use strict';

const { validate } = require('../../src/scaffolds/validate');

const baseValid = () => ({
	slug: 'cli',
	name: 'CLI',
	description: 'Adds a CLI command.',
	source: 'template',
	files: [{ src: 'a.mustache', dest: 'a.php' }],
});

describe('validate base scaffold', () => {
	it('accepts a minimal valid scaffold', () => {
		expect(validate(baseValid())).toEqual([]);
	});

	it('rejects non-objects', () => {
		expect(validate(null)[0]).toMatch(/must be a JSON object/);
		expect(validate([])[0]).toMatch(/must be a JSON object/);
		expect(validate('x')[0]).toMatch(/must be a JSON object/);
	});

	it('reports missing required fields', () => {
		const errors = validate({});
		expect(errors).toEqual(
			expect.arrayContaining([
				"missing required field 'slug'",
				"missing required field 'name'",
				"missing required field 'description'",
				"missing required field 'source'",
				"missing required field 'files'",
			])
		);
	});

	it('rejects unknown top-level fields', () => {
		const errors = validate({ ...baseValid(), bogus: 1 });
		expect(errors).toEqual(
			expect.arrayContaining(["unknown top-level field 'bogus'"])
		);
	});

	it('rejects malformed slug', () => {
		const errors = validate({ ...baseValid(), slug: 'NotKebab' });
		expect(errors[0]).toMatch(/slug: must match pattern/);
	});

	it('accepts optional category in kebab-case', () => {
		expect(validate({ ...baseValid(), category: 'wp' })).toEqual([]);
	});

	it('accepts nested category with slashes (e.g. lint/phpcs)', () => {
		expect(validate({ ...baseValid(), category: 'lint/phpcs' })).toEqual(
			[]
		);
	});

	it('rejects unknown source value', () => {
		const errors = validate({ ...baseValid(), source: 'magic' });
		expect(errors[0]).toMatch(/source: must be one of/);
	});

	it('rejects unknown wizard_step value', () => {
		const errors = validate({ ...baseValid(), wizard_step: 'bogus' });
		expect(errors[0]).toMatch(/wizard_step: must be one of/);
	});
});

describe('validate files block', () => {
	it('rejects non-array files', () => {
		const errors = validate({ ...baseValid(), files: 'nope' });
		expect(errors).toContain('files: must be an array');
	});

	it('rejects entry missing src', () => {
		const errors = validate({ ...baseValid(), files: [{ dest: 'a.php' }] });
		expect(errors[0]).toMatch(
			/files\[0\]\.src: must be a non-empty string/
		);
	});

	it('accepts empty files array (source: package case)', () => {
		expect(
			validate({
				...baseValid(),
				source: 'package',
				files: [],
				module_class: 'Foo\\Bar',
			})
		).toEqual([]);
	});
});

describe('validate inputs block', () => {
	it('accepts a full inputs entry', () => {
		expect(
			validate({
				...baseValid(),
				inputs: [
					{ key: 'name', description: 'Slug', required: true },
					{
						key: 'class',
						description: 'Class',
						discover_from: 'input:name',
						transform: 'pascal-case',
					},
				],
			})
		).toEqual([]);
	});

	it('rejects uppercase input key', () => {
		const errors = validate({
			...baseValid(),
			inputs: [{ key: 'Name', description: 'X' }],
		});
		expect(errors[0]).toMatch(/inputs\[0\]\.key: must match pattern/);
	});

	it('rejects duplicate input keys', () => {
		const errors = validate({
			...baseValid(),
			inputs: [
				{ key: 'name', description: 'A' },
				{ key: 'name', description: 'B' },
			],
		});
		expect(errors).toContain("inputs[1].key: duplicate key 'name'");
	});

	it('rejects invalid transform value', () => {
		const errors = validate({
			...baseValid(),
			inputs: [
				{ key: 'name', description: 'X', transform: 'PascalCase' },
			],
		});
		expect(errors[0]).toMatch(/inputs\[0\]\.transform: must be one of/);
	});
});

describe('validate wiring block', () => {
	it('accepts a wiring entry', () => {
		expect(
			validate({
				...baseValid(),
				wiring: [
					{
						target_file: 'includes/Plugin.php',
						anchor: '// scaffold:cli',
						snippet_template: '$x;',
						description: 'desc',
					},
				],
			})
		).toEqual([]);
	});

	it('rejects wiring entry missing anchor', () => {
		const errors = validate({
			...baseValid(),
			wiring: [{ target_file: 'x.php', snippet_template: 'y;' }],
		});
		expect(errors[0]).toMatch(
			/wiring\[0\]\.anchor: must be a non-empty string/
		);
	});
});

describe('validate tests block', () => {
	it('accepts a tests entry', () => {
		expect(
			validate({
				...baseValid(),
				tests: [
					{ src: 'a.mustache', dest: 'a.php', framework: 'phpunit' },
				],
			})
		).toEqual([]);
	});

	it('rejects unknown framework', () => {
		const errors = validate({
			...baseValid(),
			tests: [{ src: 'a', dest: 'b', framework: 'mocha' }],
		});
		expect(errors[0]).toMatch(/tests\[0\]\.framework: must be one of/);
	});

	it('accepts actionlint for YAML', () => {
		expect(
			validate({
				...baseValid(),
				tests: [
					{ src: 'a.yml', dest: 'b.yml', framework: 'actionlint' },
				],
			})
		).toEqual([]);
	});
});

describe('validate secrets block', () => {
	it('accepts a secrets entry', () => {
		expect(
			validate({
				...baseValid(),
				secrets: [
					{
						key: 'WPORG_USERNAME',
						scope: 'github-actions',
						description: 'X',
					},
				],
			})
		).toEqual([]);
	});

	it('rejects lowercase secret key', () => {
		const errors = validate({
			...baseValid(),
			secrets: [
				{ key: 'wporg', scope: 'github-actions', description: 'X' },
			],
		});
		expect(errors[0]).toMatch(/secrets\[0\]\.key: must match pattern/);
	});

	it('rejects unknown scope', () => {
		const errors = validate({
			...baseValid(),
			secrets: [{ key: 'X', scope: 'kubernetes', description: 'Y' }],
		});
		expect(errors[0]).toMatch(/secrets\[0\]\.scope: must be one of/);
	});

	it('rejects extra fields (no value smuggling)', () => {
		const errors = validate({
			...baseValid(),
			secrets: [
				{ key: 'X', scope: 'env', description: 'D', value: 'leaked' },
			],
		});
		expect(errors[0]).toMatch(/secrets\[0\]: unknown field 'value'/);
	});
});

describe('validate scripts block', () => {
	it('accepts npm-only scripts', () => {
		expect(
			validate({
				...baseValid(),
				scripts: { npm: { 'lint:js': 'eslint .' } },
			})
		).toEqual([]);
	});

	it('accepts composer-only scripts', () => {
		expect(
			validate({
				...baseValid(),
				scripts: { composer: { 'lint:php': 'phpcs' } },
			})
		).toEqual([]);
	});

	it('accepts both targets', () => {
		expect(
			validate({
				...baseValid(),
				scripts: {
					npm: { 'lint:js': 'eslint .' },
					composer: { 'lint:php': 'phpcs' },
				},
			})
		).toEqual([]);
	});

	it('rejects unknown script target', () => {
		const errors = validate({
			...baseValid(),
			scripts: { yarn: { 'lint:js': 'eslint .' } },
		});
		expect(errors[0]).toMatch(/scripts: unknown target 'yarn'/);
	});

	it('rejects non-string command', () => {
		const errors = validate({
			...baseValid(),
			scripts: { npm: { 'lint:js': 42 } },
		});
		expect(errors[0]).toMatch(
			/scripts\.npm\['lint:js'\]: must be a non-empty string/
		);
	});

	it('rejects non-object map per target', () => {
		const errors = validate({
			...baseValid(),
			scripts: { npm: 'eslint .' },
		});
		expect(errors[0]).toMatch(/scripts\.npm: must be an object/);
	});
});

describe('validate dependency maps', () => {
	it('accepts a composer dependency map', () => {
		expect(
			validate({
				...baseValid(),
				composer_dependencies: { 'rtcamp/wp-php-toolkit': '^1.0' },
			})
		).toEqual([]);
	});

	it('rejects non-string version', () => {
		const errors = validate({
			...baseValid(),
			composer_dependencies: { 'foo/bar': 1 },
		});
		expect(errors[0]).toMatch(
			/composer_dependencies\['foo\/bar'\]: version must be a string/
		);
	});
});
