/**
 * Tests that src/scaffolds/validate.js and src/scaffolds/schema.js agree on
 * which keys a manifest may carry.
 *
 * schema.js closes every manifest shape with `additionalProperties: false`,
 * but validate.js is the validator that actually runs. The two used to keep
 * independent copies of the same key lists, so a new key could be accepted by
 * one and rejected by the other -- adding `enum` needed both edits, and
 * nothing would have caught doing only one. validate.js now derives its
 * allow-lists from the schema; these tests pin that from the outside, so the
 * derivation cannot be quietly replaced by a fresh set of literals.
 */

'use strict';

const { validate } = require('../../src/scaffolds/validate');
const {
	SCAFFOLD_SCHEMA,
	INPUT_ENTRY,
	WIRING_ENTRY,
	FILE_ENTRY,
	TEST_ENTRY,
	SECRET_ENTRY,
	FEATURE_BLOCK,
} = require('../../src/scaffolds/schema');

const SHAPES = {
	'scaffold.json root': SCAFFOLD_SCHEMA,
	'files[]': FILE_ENTRY,
	'inputs[]': INPUT_ENTRY,
	'wiring[]': WIRING_ENTRY,
	'tests[]': TEST_ENTRY,
	'secrets[]': SECRET_ENTRY,
	feature: FEATURE_BLOCK,
};

/**
 * A manifest exercising every key the schema declares, in every position.
 *
 * @return {Object} A scaffold.json object that must validate clean.
 */
const everyKey = () => ({
	slug: 'cli',
	category: 'wp',
	name: 'CLI',
	description: 'Adds a CLI command.',
	source: 'template',
	wizard_step: null,
	lens: ['performance'],
	module_class: 'Inc\\Cli\\Command',
	files: [{ src: 'a.mustache', dest: 'a.php', raw: false }],
	inputs: [
		{
			key: 'mode',
			description: 'Mode.',
			discover_from: 'input:name',
			default: 'auto',
			required: false,
			transform: 'kebab-case',
			enum: ['auto', 'manual'],
		},
	],
	wiring: [
		{
			target_file: 'includes/Plugin.php',
			anchor: '// scaffold:cli-commands',
			snippet_template: '{{class}}::class,',
			description: 'Register it.',
		},
	],
	tests: [
		{
			src: 't.mustache',
			dest: 'tests/ATest.php',
			framework: 'phpunit',
			command: 'npm run test:php',
		},
	],
	secrets: [
		{
			key: 'API_TOKEN',
			scope: 'github-actions',
			description: 'Token.',
			required: true,
		},
	],
	scripts: { npm: { lint: 'eslint .' }, composer: { lint: 'phpcs' } },
	feature: {
		config_key: 'cli',
		owned_files: ['includes/Cli/Command.php'],
		confirm_remove: ['tests/ATest.php'],
		gitignore: ['/build'],
	},
	npm_dependencies: { a: '^1.0.0' },
	npm_dev_dependencies: { b: '^1.0.0' },
	composer_dependencies: { 'a/b': '^1.0' },
	composer_dev_dependencies: { 'c/d': '^1.0' },
	composer_suggest: { 'e/f': 'why' },
});

describe('schema/validator key parity', () => {
	it.each(Object.entries(SHAPES))(
		'%s is a closed shape, so deriving its keys is meaningful',
		(_name, shape) => {
			expect(shape.additionalProperties).toBe(false);
		}
	);

	it('accepts a manifest using every key the schema declares', () => {
		expect(validate(everyKey())).toEqual([]);
	});

	it('covers every schema-declared root key in that manifest', () => {
		// Guards the test above from rotting: a key added to the schema but
		// not to the fixture would otherwise leave the parity check vacuous.
		expect(Object.keys(everyKey()).sort()).toEqual(
			Object.keys(SCAFFOLD_SCHEMA.properties).sort()
		);
	});
});

describe('unknown keys are rejected in every position', () => {
	it('rejects an unknown root key', () => {
		expect(validate({ ...everyKey(), bogus: 1 })).toEqual([
			"unknown top-level field 'bogus'",
		]);
	});

	it.each([
		['files', 'files[0]'],
		['inputs', 'inputs[0]'],
		['wiring', 'wiring[0]'],
		['tests', 'tests[0]'],
		['secrets', 'secrets[0]'],
	])('rejects an unknown key in %s', (block, fieldPath) => {
		const manifest = everyKey();
		manifest[block][0].bogus = 1;
		expect(validate(manifest)).toEqual([
			`${fieldPath}: unknown field 'bogus'`,
		]);
	});

	it('rejects an unknown key in feature', () => {
		const manifest = everyKey();
		manifest.feature.bogus = 1;
		expect(validate(manifest)).toEqual(["feature: unknown field 'bogus'"]);
	});
});
