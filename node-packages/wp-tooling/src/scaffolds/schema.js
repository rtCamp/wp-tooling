/**
 * Scaffold JSON schema, single source of truth for `validate.js`.
 *
 * Hand-rolled (the zero-runtime-dep policy rules out ajv). The object is
 * shaped like a JSON Schema Draft-07 document so a real schema validator
 * could be swapped in later without changing the scaffold authoring
 * contract.
 *
 * Implements:
 *   WTL-02  base scaffold registry schema (slug, name, description, source, files, ...)
 *   WTL-07  optional manifest extensions (inputs, wiring, tests, secrets)
 */

'use strict';

/** Required top-level fields. Order matters for deterministic error output. */
const REQUIRED_FIELDS = ['slug', 'name', 'description', 'source', 'files'];

/**
 * `template` renders files from Mustache templates; `package` registers
 * boot wiring for a class shipped in vendor and writes zero files.
 */
const ALLOWED_SOURCES = ['template', 'package'];

/**
 * Wizard step grouping. `null` (or omitted) means the scaffold is
 * invoked via `add <category>/<slug>` rather than the setup wizard's tree.
 */
const ALLOWED_WIZARD_STEPS = ['modules', 'integrations', 'wp-apis', null];

/** Test frameworks the engine recognises. Closed enum to catch typos. */
const ALLOWED_TEST_FRAMEWORKS = [
	'phpunit',
	'jest',
	'playwright',
	'pa11y',
	'actionlint',
	'yaml-parse',
];

/** Where a declared secret needs to be set by the developer. */
const ALLOWED_SECRET_SCOPES = ['github-actions', 'env', 'dotenv'];

/** Transforms the engine applies to a resolved input before substitution. */
const ALLOWED_INPUT_TRANSFORMS = [
	'pascal-case',
	'kebab-case',
	'snake-case',
	'upper-snake-case',
];

/** Optional dependency maps. Each is `{ "<package>": "<version-range>" }`. */
const DEPENDENCY_MAPS = [
	'npm_dependencies',
	'npm_dev_dependencies',
	'composer_dependencies',
	'composer_dev_dependencies',
	'composer_suggest',
];

/** Where a declared script lives. Closed enum. */
const ALLOWED_SCRIPT_TARGETS = ['npm', 'composer'];

/** Identifier patterns. */
const SLUG_PATTERN = '^[a-z0-9-]+$';
const CATEGORY_PATTERN = '^[a-z][a-z0-9/-]*$';
const INPUT_KEY_PATTERN = '^[a-z][a-z0-9_]*$';
const SECRET_KEY_PATTERN = '^[A-Z][A-Z0-9_]*$';

/** Reusable Draft-07 entry shapes. */
const INPUT_ENTRY = {
	type: 'object',
	required: ['key', 'description'],
	additionalProperties: false,
	properties: {
		key: { type: 'string', pattern: INPUT_KEY_PATTERN },
		description: { type: 'string', minLength: 1 },
		discover_from: { type: 'string' },
		default: { type: 'string' },
		required: { type: 'boolean' },
		transform: { type: 'string', enum: ALLOWED_INPUT_TRANSFORMS },
	},
};

// `anchor` is intentionally NOT required: the AI contract treats it as advisory
// (the AI falls through to pattern sampling when no anchor is present in the
// target file). Validate that it's a non-empty string when supplied, but allow
// scaffolds to omit it entirely. See docs/ai-orchestration.md for the rule.
const WIRING_ENTRY = {
	type: 'object',
	required: ['target_file', 'snippet_template'],
	additionalProperties: false,
	properties: {
		target_file: { type: 'string', minLength: 1 },
		anchor: { type: 'string', minLength: 1 },
		snippet_template: { type: 'string', minLength: 1 },
		description: { type: 'string' },
	},
};

const TEST_ENTRY = {
	type: 'object',
	required: ['src', 'dest', 'framework'],
	additionalProperties: false,
	properties: {
		src: { type: 'string', minLength: 1 },
		dest: { type: 'string', minLength: 1 },
		framework: { type: 'string', enum: ALLOWED_TEST_FRAMEWORKS },
		command: { type: 'string' },
	},
};

const SECRET_ENTRY = {
	type: 'object',
	required: ['key', 'scope', 'description'],
	additionalProperties: false,
	properties: {
		key: { type: 'string', pattern: SECRET_KEY_PATTERN },
		scope: { type: 'string', enum: ALLOWED_SECRET_SCOPES },
		description: { type: 'string', minLength: 1 },
		required: { type: 'boolean' },
	},
};

const FILE_ENTRY = {
	type: 'object',
	required: ['src', 'dest'],
	additionalProperties: false,
	properties: {
		src: { type: 'string', minLength: 1 },
		dest: { type: 'string', minLength: 1 },
		raw: {
			type: 'boolean',
			description:
				'When true, the file content is copied verbatim (no Mustache rendering). The `dest` path is still rendered. Use for files that contain literal `{{` or `}}` that would otherwise be misinterpreted as placeholders.',
		},
	},
};

const DEPENDENCY_MAP = {
	type: 'object',
	additionalProperties: { type: 'string' },
};

/**
 * Scripts to add to package.json (npm) or composer.json (composer).
 * The engine treats this as a verbatim passthrough; the AI orchestrator
 * applies the merge with developer consent, since editing the user's
 * package/composer manifest is a cross-file edit.
 */
const SCRIPTS_BLOCK = {
	type: 'object',
	additionalProperties: false,
	properties: {
		npm: { type: 'object', additionalProperties: { type: 'string' } },
		composer: { type: 'object', additionalProperties: { type: 'string' } },
	},
};

const SCAFFOLD_SCHEMA = {
	$schema: 'http://json-schema.org/draft-07/schema#',
	title: 'rtCamp scaffold definition',
	type: 'object',
	required: REQUIRED_FIELDS,
	additionalProperties: false,
	properties: {
		slug: {
			type: 'string',
			description:
				'Kebab-case identifier. Unique within a registry (after category).',
			pattern: SLUG_PATTERN,
		},
		category: {
			type: 'string',
			description:
				'Optional grouping. With slug forms a `category/slug` id (e.g., `wp/cli`).',
			pattern: CATEGORY_PATTERN,
		},
		name: {
			type: 'string',
			description:
				'Human-readable name shown in the wizard and CLI output.',
			minLength: 1,
		},
		description: {
			type: 'string',
			description: 'One-line description of what this scaffold creates.',
			minLength: 1,
		},
		source: {
			type: 'string',
			description:
				'`template` renders Mustache files; `package` registers boot wiring only.',
			enum: ALLOWED_SOURCES,
		},
		wizard_step: {
			description: 'Wizard group, or `null` for `add`-only invocation.',
			enum: ALLOWED_WIZARD_STEPS,
		},
		module_class: {
			type: 'string',
			description:
				'Fully qualified PHP class name. Used by `source: package` scaffolds.',
		},
		files: {
			type: 'array',
			description:
				'Files to render. Empty array is valid (used by `source: package`).',
			items: FILE_ENTRY,
		},
		inputs: {
			type: 'array',
			description:
				'Inputs the scaffold consumes. The engine treats this as authoritative when declared.',
			items: INPUT_ENTRY,
		},
		wiring: {
			type: 'array',
			description:
				'Wiring points the consumer is expected to apply after the scaffold runs.',
			items: WIRING_ENTRY,
		},
		tests: {
			type: 'array',
			description:
				'Test stubs scaffolded alongside the production output.',
			items: TEST_ENTRY,
		},
		secrets: {
			type: 'array',
			description:
				'Secrets the developer must set (never values, only declarations).',
			items: SECRET_ENTRY,
		},
		scripts: SCRIPTS_BLOCK,
		npm_dependencies: DEPENDENCY_MAP,
		npm_dev_dependencies: DEPENDENCY_MAP,
		composer_dependencies: DEPENDENCY_MAP,
		composer_dev_dependencies: DEPENDENCY_MAP,
		composer_suggest: DEPENDENCY_MAP,
	},
};

module.exports = {
	SCAFFOLD_SCHEMA,
	REQUIRED_FIELDS,
	ALLOWED_SOURCES,
	ALLOWED_WIZARD_STEPS,
	ALLOWED_TEST_FRAMEWORKS,
	ALLOWED_SECRET_SCOPES,
	ALLOWED_INPUT_TRANSFORMS,
	ALLOWED_SCRIPT_TARGETS,
	DEPENDENCY_MAPS,
	SLUG_PATTERN,
	CATEGORY_PATTERN,
	INPUT_KEY_PATTERN,
	SECRET_KEY_PATTERN,
};
