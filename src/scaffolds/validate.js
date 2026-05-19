/**
 * Hand-rolled scaffold.json validator.
 *
 * Returns an array of error messages (empty array = valid). Each message is
 * prefixed with the field path so authors can locate problems quickly:
 *
 *   wiring[0]: missing required field 'target_file'
 *   tests[1].framework: must be one of phpunit, jest, playwright, pa11y, actionlint, yaml-parse
 *   secrets[0].key: must match pattern ^[A-Z][A-Z0-9_]*$
 *
 * Implements:
 *   WTL-02  base validation (required fields, enums, file shapes, dep maps)
 *   WTL-07  validation for the inputs/wiring/tests/secrets blocks
 */

'use strict';

const {
	REQUIRED_FIELDS,
	ALLOWED_SOURCES,
	ALLOWED_WIZARD_STEPS,
	ALLOWED_TEST_FRAMEWORKS,
	ALLOWED_SECRET_SCOPES,
	ALLOWED_INPUT_TRANSFORMS,
	DEPENDENCY_MAPS,
	SLUG_PATTERN,
	CATEGORY_PATTERN,
	INPUT_KEY_PATTERN,
	SECRET_KEY_PATTERN,
} = require('./schema');

const SLUG_RE = new RegExp(SLUG_PATTERN);
const CATEGORY_RE = new RegExp(CATEGORY_PATTERN);
const INPUT_KEY_RE = new RegExp(INPUT_KEY_PATTERN);
const SECRET_KEY_RE = new RegExp(SECRET_KEY_PATTERN);

const TOP_LEVEL_KEYS = new Set([
	'slug',
	'category',
	'name',
	'description',
	'source',
	'wizard_step',
	'module_class',
	'files',
	'inputs',
	'wiring',
	'tests',
	'secrets',
	...DEPENDENCY_MAPS,
]);

/**
 * Validate a parsed scaffold.json object.
 *
 * @param {unknown} scaffold - The parsed JSON object.
 * @return {string[]} Array of error messages. Empty when valid.
 */
function validate(scaffold) {
	const errors = [];

	if (
		scaffold === null ||
		typeof scaffold !== 'object' ||
		Array.isArray(scaffold)
	) {
		return ['scaffold.json must be a JSON object'];
	}

	for (const field of REQUIRED_FIELDS) {
		if (!(field in scaffold)) {
			errors.push(`missing required field '${field}'`);
		}
	}

	for (const key of Object.keys(scaffold)) {
		if (!TOP_LEVEL_KEYS.has(key)) {
			errors.push(`unknown top-level field '${key}'`);
		}
	}

	if (typeof scaffold.slug === 'string' && !SLUG_RE.test(scaffold.slug)) {
		errors.push(`slug: must match pattern ${SLUG_PATTERN}`);
	}
	if (scaffold.category !== undefined) {
		if (
			typeof scaffold.category !== 'string' ||
			!CATEGORY_RE.test(scaffold.category)
		) {
			errors.push(`category: must match pattern ${CATEGORY_PATTERN}`);
		}
	}
	if (scaffold.name !== undefined && typeof scaffold.name !== 'string') {
		errors.push('name: must be a string');
	}
	if (
		scaffold.description !== undefined &&
		typeof scaffold.description !== 'string'
	) {
		errors.push('description: must be a string');
	}
	if (
		scaffold.source !== undefined &&
		!ALLOWED_SOURCES.includes(scaffold.source)
	) {
		errors.push(`source: must be one of ${ALLOWED_SOURCES.join(', ')}`);
	}
	if (
		scaffold.wizard_step !== undefined &&
		!ALLOWED_WIZARD_STEPS.includes(scaffold.wizard_step)
	) {
		errors.push(
			`wizard_step: must be one of ${ALLOWED_WIZARD_STEPS.map((s) =>
				s === null ? 'null' : s
			).join(', ')}`
		);
	}

	if (scaffold.files !== undefined) {
		errors.push(...validateFiles(scaffold.files));
	}
	if (scaffold.inputs !== undefined) {
		errors.push(...validateInputs(scaffold.inputs));
	}
	if (scaffold.wiring !== undefined) {
		errors.push(...validateWiring(scaffold.wiring));
	}
	if (scaffold.tests !== undefined) {
		errors.push(...validateTests(scaffold.tests));
	}
	if (scaffold.secrets !== undefined) {
		errors.push(...validateSecrets(scaffold.secrets));
	}

	for (const mapKey of DEPENDENCY_MAPS) {
		if (scaffold[mapKey] !== undefined) {
			errors.push(...validateDependencyMap(scaffold[mapKey], mapKey));
		}
	}

	return errors;
}

function validateFiles(files) {
	const errors = [];
	if (!Array.isArray(files)) {
		return ['files: must be an array'];
	}
	for (let i = 0; i < files.length; i++) {
		const entry = files[i];
		const path = `files[${i}]`;
		if (
			entry === null ||
			typeof entry !== 'object' ||
			Array.isArray(entry)
		) {
			errors.push(`${path}: must be an object`);
			continue;
		}
		if (typeof entry.src !== 'string' || entry.src.length === 0) {
			errors.push(`${path}.src: must be a non-empty string`);
		}
		if (typeof entry.dest !== 'string' || entry.dest.length === 0) {
			errors.push(`${path}.dest: must be a non-empty string`);
		}
		for (const k of Object.keys(entry)) {
			if (k !== 'src' && k !== 'dest') {
				errors.push(`${path}: unknown field '${k}'`);
			}
		}
	}
	return errors;
}

function validateInputs(inputs) {
	const errors = [];
	if (!Array.isArray(inputs)) {
		return ['inputs: must be an array'];
	}
	const seenKeys = new Set();
	for (let i = 0; i < inputs.length; i++) {
		const entry = inputs[i];
		const path = `inputs[${i}]`;
		if (
			entry === null ||
			typeof entry !== 'object' ||
			Array.isArray(entry)
		) {
			errors.push(`${path}: must be an object`);
			continue;
		}
		if (typeof entry.key !== 'string' || !INPUT_KEY_RE.test(entry.key)) {
			errors.push(`${path}.key: must match pattern ${INPUT_KEY_PATTERN}`);
		} else if (seenKeys.has(entry.key)) {
			errors.push(`${path}.key: duplicate key '${entry.key}'`);
		} else {
			seenKeys.add(entry.key);
		}
		if (
			typeof entry.description !== 'string' ||
			entry.description.length === 0
		) {
			errors.push(`${path}.description: must be a non-empty string`);
		}
		if (
			entry.discover_from !== undefined &&
			typeof entry.discover_from !== 'string'
		) {
			errors.push(`${path}.discover_from: must be a string`);
		}
		if (entry.default !== undefined && typeof entry.default !== 'string') {
			errors.push(`${path}.default: must be a string`);
		}
		if (
			entry.required !== undefined &&
			typeof entry.required !== 'boolean'
		) {
			errors.push(`${path}.required: must be a boolean`);
		}
		if (
			entry.transform !== undefined &&
			!ALLOWED_INPUT_TRANSFORMS.includes(entry.transform)
		) {
			errors.push(
				`${path}.transform: must be one of ${ALLOWED_INPUT_TRANSFORMS.join(', ')}`
			);
		}
		for (const k of Object.keys(entry)) {
			if (
				![
					'key',
					'description',
					'discover_from',
					'default',
					'required',
					'transform',
				].includes(k)
			) {
				errors.push(`${path}: unknown field '${k}'`);
			}
		}
	}
	return errors;
}

function validateWiring(wiring) {
	const errors = [];
	if (!Array.isArray(wiring)) {
		return ['wiring: must be an array'];
	}
	for (let i = 0; i < wiring.length; i++) {
		const entry = wiring[i];
		const path = `wiring[${i}]`;
		if (
			entry === null ||
			typeof entry !== 'object' ||
			Array.isArray(entry)
		) {
			errors.push(`${path}: must be an object`);
			continue;
		}
		for (const field of ['target_file', 'anchor', 'snippet_template']) {
			if (typeof entry[field] !== 'string' || entry[field].length === 0) {
				errors.push(`${path}.${field}: must be a non-empty string`);
			}
		}
		if (
			entry.description !== undefined &&
			typeof entry.description !== 'string'
		) {
			errors.push(`${path}.description: must be a string`);
		}
		for (const k of Object.keys(entry)) {
			if (
				![
					'target_file',
					'anchor',
					'snippet_template',
					'description',
				].includes(k)
			) {
				errors.push(`${path}: unknown field '${k}'`);
			}
		}
	}
	return errors;
}

function validateTests(tests) {
	const errors = [];
	if (!Array.isArray(tests)) {
		return ['tests: must be an array'];
	}
	for (let i = 0; i < tests.length; i++) {
		const entry = tests[i];
		const path = `tests[${i}]`;
		if (
			entry === null ||
			typeof entry !== 'object' ||
			Array.isArray(entry)
		) {
			errors.push(`${path}: must be an object`);
			continue;
		}
		if (typeof entry.src !== 'string' || entry.src.length === 0) {
			errors.push(`${path}.src: must be a non-empty string`);
		}
		if (typeof entry.dest !== 'string' || entry.dest.length === 0) {
			errors.push(`${path}.dest: must be a non-empty string`);
		}
		if (!ALLOWED_TEST_FRAMEWORKS.includes(entry.framework)) {
			errors.push(
				`${path}.framework: must be one of ${ALLOWED_TEST_FRAMEWORKS.join(', ')}`
			);
		}
		if (entry.command !== undefined && typeof entry.command !== 'string') {
			errors.push(`${path}.command: must be a string`);
		}
		for (const k of Object.keys(entry)) {
			if (!['src', 'dest', 'framework', 'command'].includes(k)) {
				errors.push(`${path}: unknown field '${k}'`);
			}
		}
	}
	return errors;
}

function validateSecrets(secrets) {
	const errors = [];
	if (!Array.isArray(secrets)) {
		return ['secrets: must be an array'];
	}
	for (let i = 0; i < secrets.length; i++) {
		const entry = secrets[i];
		const path = `secrets[${i}]`;
		if (
			entry === null ||
			typeof entry !== 'object' ||
			Array.isArray(entry)
		) {
			errors.push(`${path}: must be an object`);
			continue;
		}
		if (typeof entry.key !== 'string' || !SECRET_KEY_RE.test(entry.key)) {
			errors.push(
				`${path}.key: must match pattern ${SECRET_KEY_PATTERN}`
			);
		}
		if (!ALLOWED_SECRET_SCOPES.includes(entry.scope)) {
			errors.push(
				`${path}.scope: must be one of ${ALLOWED_SECRET_SCOPES.join(', ')}`
			);
		}
		if (
			typeof entry.description !== 'string' ||
			entry.description.length === 0
		) {
			errors.push(`${path}.description: must be a non-empty string`);
		}
		if (
			entry.required !== undefined &&
			typeof entry.required !== 'boolean'
		) {
			errors.push(`${path}.required: must be a boolean`);
		}
		for (const k of Object.keys(entry)) {
			if (!['key', 'scope', 'description', 'required'].includes(k)) {
				errors.push(`${path}: unknown field '${k}'`);
			}
		}
	}
	return errors;
}

function validateDependencyMap(map, name) {
	if (map === null || typeof map !== 'object' || Array.isArray(map)) {
		return [`${name}: must be an object`];
	}
	const errors = [];
	for (const [pkg, ver] of Object.entries(map)) {
		if (typeof ver !== 'string') {
			errors.push(`${name}['${pkg}']: version must be a string`);
		}
	}
	return errors;
}

module.exports = { validate };
