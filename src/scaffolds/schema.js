/**
 * Scaffold JSON schema -- single source of truth for `validate.js`.
 *
 * Hand-rolled (the zero-runtime-dep policy rules out ajv). The object is
 * shaped like a JSON Schema Draft-07 document so a real schema validator
 * could be swapped in later without changing the scaffold authoring
 * contract.
 */

'use strict';

/** Order matters only for deterministic error output. */
const REQUIRED_FIELDS = ['slug', 'name', 'description', 'source', 'files'];

/**
 * `template` renders files from Mustache templates; `package` registers
 * boot wiring for a class shipped in vendor.
 */
const ALLOWED_SOURCES = ['template', 'package'];

/**
 * `null` means the scaffold is invoked via `npm run add:module <slug>`
 * rather than the setup wizard's tree. `undefined` (field omitted) is
 * accepted and treated as `null`.
 */
const ALLOWED_WIZARD_STEPS = ['modules', 'integrations', 'wp-apis', null];

/** Optional; each map is `<package> -> <version-range-string>`. */
const DEPENDENCY_MAPS = [
	'npm_dependencies',
	'npm_dev_dependencies',
	'composer_dependencies',
	'composer_dev_dependencies',
	'composer_suggest',
];

const SCAFFOLD_SCHEMA = {
	$schema: 'http://json-schema.org/draft-07/schema#',
	title: 'rtCamp scaffold definition',
	type: 'object',
	required: REQUIRED_FIELDS,
	properties: {
		slug: {
			type: 'string',
			description: 'Kebab-case identifier. Unique within a registry.',
			pattern: '^[a-z0-9-]+$',
		},
		name: {
			type: 'string',
			description: 'Human-readable name shown in the wizard.',
		},
		description: {
			type: 'string',
			description: 'What this scaffold creates.',
		},
		source: {
			type: 'string',
			description:
				'`template` renders Mustache files; `package` registers boot wiring only.',
			enum: ALLOWED_SOURCES,
		},
		wizard_step: {
			description:
				'Wizard group this scaffold belongs to, or `null` for `add:module`-only.',
			enum: ALLOWED_WIZARD_STEPS,
		},
		module_class: {
			type: 'string',
			description:
				'PHP class name, used by `source: package` scaffolds when wiring boot.',
		},
		files: {
			type: 'array',
			description:
				'Files to render. Empty array is valid (used by `source: package`).',
			items: {
				type: 'object',
				required: ['src', 'dest'],
				properties: {
					src: { type: 'string' },
					dest: { type: 'string' },
				},
			},
		},
		npm_dependencies: { type: 'object' },
		npm_dev_dependencies: { type: 'object' },
		composer_dependencies: { type: 'object' },
		composer_dev_dependencies: { type: 'object' },
		composer_suggest: { type: 'object' },
	},
};

module.exports = {
	SCAFFOLD_SCHEMA,
	REQUIRED_FIELDS,
	ALLOWED_SOURCES,
	ALLOWED_WIZARD_STEPS,
	DEPENDENCY_MAPS,
};
