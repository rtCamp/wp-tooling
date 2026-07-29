/**
 * Project identity: derive every case variant and WordPress convention from a
 * name, build the search-replace pairs between two identities, validate a name,
 * and drive the interactive field editor used in both review and manage mode.
 */

'use strict';

const {
	collectFiles,
	replaceInFiles,
	renameFiles,
	applyVersion,
	PHP_RESERVED_WORDS,
} = require('./transform');
const { writeIdentityFile, readIdentityFile } = require('./persist');

/**
 * Split a name into words on spaces/hyphens/underscores and camelCase,
 * PascalCase and ACRONYM boundaries:
 *   "Elementary Theme" -> [ Elementary, Theme ]
 *   "myWidget"         -> [ my, Widget ]
 *   "WPGraphQL"        -> [ WP, Graph, QL ]
 *
 * @param {string} name - Raw name.
 * @return {string[]} Words.
 */
const tokenizeWords = (name) =>
	String(name)
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase boundary.
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // acronym -> word boundary.
		.split(/[\s_-]+/)
		.filter(Boolean);

/**
 * Title-case a word, preserving an all-caps acronym (length > 1).
 *
 * @param {string} word - Input word.
 * @return {string} Title-cased word (or the acronym unchanged).
 */
const titleWord = (word) =>
	word.length > 1 && word === word.toUpperCase()
		? word
		: word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

/**
 * Build the full identity from a name: case variants + WP-convention prefixes.
 *
 * @param {string} name             - Project name (e.g. "My Test Theme").
 * @param {Object} [options]        - Options.
 * @param {string} [options.vendor] - Package vendor prefix (default "rtcamp").
 * @return {Object} The identity object.
 */
const generateIdentity = (name, options = {}) => {
	const { vendor = 'rtcamp' } = options;

	const trimmed = String(name).trim();
	const words = tokenizeWords(trimmed);
	const lowerWords = words.map((word) => word.toLowerCase());

	const lower = lowerWords.join(' ');
	const kebab = lowerWords.join('-');
	const snake = lowerWords.join('_');
	const train = words.map(titleWord).join('-');
	const pascalSnake = words.map(titleWord).join('_');
	const macro = snake.toUpperCase();
	const cobolKebab = kebab.toUpperCase();
	const cobolDisplay = lower.toUpperCase();

	return {
		name: trimmed,
		lower,
		cobolDisplay,
		kebab,
		train,
		cobolKebab,
		snake,
		pascalSnake,
		macro,
		slug: kebab,
		textDomain: kebab,
		functionPrefix: `${snake}_`,
		constantPrefix: macro,
		cssPrefix: `${kebab}-`,
		package: `${vendor}/${kebab}`,
	};
};

/** Case-variant keys produced by {@link generateIdentity}, used to build token pairs. */
const CASE_KEYS = [
	'name',
	'lower',
	'cobolDisplay',
	'kebab',
	'train',
	'cobolKebab',
	'snake',
	'pascalSnake',
	'macro',
];

/** Semantic identity fields a config may template or a user may override. */
const FIELD_KEYS = [
	'textDomain',
	'package',
	'namespace',
	'functionPrefix',
	'constantPrefix',
	'cssPrefix',
];

/**
 * Build a full, canonical identity from a name, applying the config's namespace
 * and package templates and any explicit field overrides.
 *
 * The returned shape is what `.wp-scaffold.json` stores (minus version/features):
 * `{ name, textDomain, slug, package, namespace, functionPrefix, constantPrefix, cssPrefix }`.
 *
 * @param {string} name        - Project name.
 * @param {Object} config      - Scaffold config (uses `vendor`, `namespace`, `package`).
 * @param {Object} [overrides] - Explicit `{ field: value }` overrides.
 * @return {Object} The full identity.
 */
const identityFromName = (name, config, overrides = {}) => {
	const base = generateIdentity(name, { vendor: config.vendor || 'rtcamp' });

	const id = {
		name: base.name,
		textDomain: base.textDomain,
		slug: base.slug,
		package:
			'function' === typeof config.package
				? config.package(base)
				: base.package,
		namespace:
			'function' === typeof config.namespace
				? config.namespace(base)
				: '',
		functionPrefix: base.functionPrefix,
		constantPrefix: base.constantPrefix,
		cssPrefix: base.cssPrefix,
	};

	FIELD_KEYS.forEach((field) => {
		if (undefined !== overrides[field]) {
			id[field] = overrides[field];
		}
	});
	id.slug = id.textDomain;

	return id;
};

/**
 * Double every backslash, matching how a namespace is JSON-escaped in
 * composer.json (`rtCamp\Theme\X` on disk becomes `rtCamp\\Theme\\X`).
 *
 * @param {string} value - Source value.
 * @return {string} Backslash-doubled value.
 */
const escapeBackslashes = (value) => String(value || '').replace(/\\/g, '\\\\');

/**
 * Build replacement pairs that rewrite `oldId` to `newId` everywhere.
 *
 * Covers every case variant of the name plus each semantic field
 * (textDomain / package / prefixes), and the namespace in both single-backslash
 * (PHP source) and double-backslash (composer.json) forms. De-duplicated and
 * sorted longest-source-first so more-specific tokens replace before shorter ones.
 *
 * @param {Object} oldId - Current identity (replacement source).
 * @param {Object} newId - New identity (replacement target).
 * @return {Array<[string, string]>} Ordered [ from, to ] pairs.
 */
const buildIdentityReplacements = (oldId, newId) => {
	const pairs = [];
	const add = (from, to) => {
		if (from && to && from !== to) {
			pairs.push([from, to]);
		}
	};

	// Semantic fields FIRST: these are the unambiguous tokens that actually
	// appear in the code (constant prefix, text domain, ...). For a single-word
	// name several case variants collapse onto one token (e.g. "ARYAN" is both
	// the constant prefix and the COBOL display form), so adding fields before
	// case variants lets the de-dupe keep the correct mapping on re-rename.
	FIELD_KEYS.filter((field) => 'namespace' !== field).forEach((field) =>
		add(oldId[field], newId[field])
	);

	// Namespace: single-backslash (PHP) + double-backslash (composer.json).
	add(oldId.namespace, newId.namespace);
	add(escapeBackslashes(oldId.namespace), escapeBackslashes(newId.namespace));

	// Then every case variant of the name (catches forms no field covers).
	const oldBase = generateIdentity(oldId.name, { vendor: 'x' });
	const newBase = generateIdentity(newId.name, { vendor: 'x' });
	CASE_KEYS.forEach((key) => add(oldBase[key], newBase[key]));

	// De-duplicate by source token, then longest source first.
	const seen = new Set();
	const unique = pairs.filter(([from]) => {
		if (seen.has(from)) {
			return false;
		}
		seen.add(from);
		return true;
	});
	unique.sort((a, b) => b[0].length - a[0].length);

	return unique;
};

/**
 * Validate a project name.
 *
 * Returns `undefined` when valid, matching the `text({ validate })` contract in
 * `@rtcamp/wp-tooling/ui`. Rejects names that would generate invalid PHP (leading
 * digits, illegal characters, reserved keywords).
 *
 * @param {string} name - Candidate project name.
 * @return {string|undefined} Error message, or undefined when valid.
 */
const validateName = (name) => {
	const trimmed = String(name || '').trim();

	if ('' === trimmed) {
		return 'Name is required.';
	}

	const slug = trimmed.replace(/\s+/g, '-').toLowerCase();

	if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(slug)) {
		return 'Name must start with a letter and contain only letters, numbers, spaces or hyphens.';
	}

	const reserved = slug
		.split('-')
		.find((word) => PHP_RESERVED_WORDS.includes(word));
	if (reserved) {
		return `"${reserved}" is a reserved PHP keyword. Please choose another name.`;
	}

	return undefined;
};

/** Default editable fields when a config does not declare its own. */
const DEFAULT_FIELDS = [
	{ key: 'name', label: 'Name' },
	{ key: 'version', label: 'Version' },
	{ key: 'textDomain', label: 'Text Domain' },
	{ key: 'package', label: 'Package' },
	{ key: 'namespace', label: 'Namespace' },
	{ key: 'functionPrefix', label: 'Function Prefix' },
	{ key: 'constantPrefix', label: 'Constant Prefix' },
	{ key: 'cssPrefix', label: 'CSS Prefix' },
];

/**
 * A project's editable fields — its `fields` list, or the default set. Drives
 * both the details table and the editor so they can't diverge.
 *
 * @param {Object} config - Scaffold config.
 * @return {Array<{key: string, label: string}>} Fields.
 */
const fieldsOf = (config) =>
	Array.isArray(config.fields) ? config.fields : DEFAULT_FIELDS;

/**
 * Capitalise the first letter.
 *
 * @param {string} word - Input.
 * @return {string} Capitalised.
 */
const cap = (word = '') => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * Build the details table (label -> value) from the project's fields.
 *
 * @param {Object} config - Scaffold config.
 * @param {Object} id     - Full identity.
 * @return {Object} Label -> value map.
 */
const detailsOf = (config, id) =>
	fieldsOf(config).reduce((out, field) => {
		out[field.label] = id[field.key];
		return out;
	}, {});

/**
 * Per-field validators: return an error string, or undefined when valid. Lenient
 * but format-correct, just to catch typos.
 */
const FIELD_VALIDATORS = {
	name: validateName,
	version: (v) =>
		/^\d+(\.\d+)*(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(v.trim())
			? undefined
			: 'Version must look like 1.2.3.',
	textDomain: (v) =>
		/^[a-z][a-z0-9-]*$/.test(v.trim())
			? undefined
			: 'Text domain: lowercase letters, numbers, hyphens; start with a letter.',
	package: (v) =>
		/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?\/[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/.test(
			v.trim()
		)
			? undefined
			: 'Package must be vendor/name (lowercase).',
	namespace: (v) =>
		/^[A-Za-z_][A-Za-z0-9_]*(\\[A-Za-z_][A-Za-z0-9_]*)*$/.test(v.trim())
			? undefined
			: 'Namespace must be PHP-style, e.g. Vendor\\Sub\\Name.',
	functionPrefix: (v) =>
		/^[a-z_][a-z0-9_]*$/.test(v.trim())
			? undefined
			: 'Function prefix: lowercase letters, numbers, underscores.',
	constantPrefix: (v) =>
		/^[A-Z_][A-Z0-9_]*$/.test(v.trim())
			? undefined
			: 'Constant prefix: UPPERCASE letters, numbers, underscores.',
	cssPrefix: (v) =>
		/^[a-z][a-z0-9-]*$/.test(v.trim())
			? undefined
			: 'CSS prefix: lowercase letters, numbers, hyphens; start with a letter.',
};

/**
 * Interactively edit identity fields until the user confirms or cancels.
 *
 * Editing Name re-derives every field from the new name (keeping version and any
 * fields already overridden); editing any other field sets just that one. With
 * `flags.yes` the editor is skipped and startId accepted as-is. With `gate`, a
 * "Looks good?" confirm opens the field editor only on "no".
 *
 * @param {Object}  config  - Scaffold config.
 * @param {Object}  startId - Identity to start from.
 * @param {Object}  ui      - Merged UI.
 * @param {Object}  [flags] - CLI flags (honours `flags.yes`).
 * @param {boolean} [gate]  - Offer a "Looks good?" confirm before the editor.
 * @return {Promise<{id: Object, confirmed: boolean}>} The resulting identity and whether the user confirmed it.
 */
const editIdentityFields = async (
	config,
	startId,
	ui,
	flags = {},
	gate = false
) => {
	let id = { ...startId };
	const overridden = new Set();

	for (let first = true; ; first = false) {
		ui.table(detailsOf(config, id), {
			title: `${cap(config.kind || 'project')} details`,
		});

		if (flags.yes) {
			return { id, confirmed: true };
		}

		if (
			first &&
			gate &&
			(await ui.confirm({ message: 'Looks good?', defaultValue: true }))
		) {
			return { id, confirmed: true };
		}

		const fields = fieldsOf(config);
		const choice = await ui.radio({
			message: 'Edit a field, or confirm',
			choices: [
				...fields.map((field) => field.label),
				'Confirm',
				'Cancel',
			],
		});

		if ('Confirm' === choice) {
			return { id, confirmed: true };
		}
		if ('Cancel' === choice) {
			return { id: startId, confirmed: false };
		}

		const field = fields.find((entry) => entry.label === choice).key;
		const value = await ui.text({
			message: choice,
			defaultValue: id[field],
			validate: FIELD_VALIDATORS[field],
		});

		if ('name' === field) {
			const base = identityFromName(value, config, {});
			const kept = {};
			overridden.forEach((key) => {
				kept[key] = id[key];
			});
			id = { ...base, version: id.version, ...kept };
		} else if ('version' === field) {
			id.version = value;
		} else {
			id[field] = value;
			overridden.add(field);
		}
	}
};

/**
 * Apply an identity change (old -> new) across the repo: search-replace, rename,
 * version, and persist. Used by manage-mode editing (old comes from the JSON).
 *
 * @param {Object} config - Scaffold config.
 * @param {string} root   - Project root.
 * @param {Object} oldId  - Current identity (replacement source).
 * @param {Object} newId  - Edited identity (replacement target).
 * @param {Object} ui     - Merged UI.
 * @return {boolean} Whether anything changed.
 */
const applyIdentityEdit = (config, root, oldId, newId, ui) => {
	const replacements = buildIdentityReplacements(oldId, newId);

	if (!replacements.length) {
		ui.info('No identity changes to apply.');
		return false;
	}

	const files = collectFiles(root);
	const changed = replaceInFiles(files, replacements, ui);
	const renamed = renameFiles(files, replacements, ui);
	ui.success(`Updated ${changed} file(s), renamed ${renamed} file(s)`);

	if (oldId.version !== newId.version && Array.isArray(config.versionFiles)) {
		const target = { ...newId, kebab: newId.textDomain };
		const versionFiles = config.versionFiles.map((spec) => ({
			...spec,
			path:
				'function' === typeof spec.path ? spec.path(target) : spec.path,
		}));
		applyVersion(root, versionFiles, newId.version, ui);
	}

	const current = readIdentityFile(root) || {};
	writeIdentityFile(
		root,
		{
			...current,
			name: newId.name,
			version: newId.version,
			slug: newId.textDomain,
			textDomain: newId.textDomain,
			package: newId.package,
			namespace: newId.namespace,
			functionPrefix: newId.functionPrefix,
			constantPrefix: newId.constantPrefix,
			cssPrefix: newId.cssPrefix,
		},
		ui
	);

	return true;
};

/**
 * Manage-mode "Edit project details" flow: edit fields starting from the
 * persisted identity, then apply the diff against the repo.
 *
 * @param {Object} config   - Scaffold config.
 * @param {string} root     - Project root.
 * @param {Object} identity - Parsed `.wp-scaffold.json`.
 * @param {Object} ui       - Merged UI.
 * @param {Object} [flags]  - CLI flags.
 * @return {Promise<void>}
 */
const editDetailsFlow = async (config, root, identity, ui, flags = {}) => {
	const startId = {
		name: identity.name,
		version: identity.version,
		textDomain: identity.textDomain || identity.slug,
		package: identity.package,
		namespace: identity.namespace,
		functionPrefix: identity.functionPrefix,
		constantPrefix: identity.constantPrefix,
		cssPrefix: identity.cssPrefix,
	};

	const { id, confirmed } = await editIdentityFields(
		config,
		startId,
		ui,
		flags
	);
	if (!confirmed) {
		ui.warn('No changes made.');
		return;
	}

	const changed = fieldsOf(config).filter(
		(field) =>
			String(startId[field.key] ?? '') !== String(id[field.key] ?? '')
	);
	if (!changed.length) {
		ui.info('Nothing changed.');
		return;
	}

	ui.heading('Changes to apply');
	changed.forEach((field) =>
		ui.warn(`${field.label}: ${startId[field.key]} -> ${id[field.key]}`)
	);

	if (!flags.yes) {
		const ok = await ui.confirm({
			message: 'Apply these changes across the project?',
			defaultValue: true,
		});
		if (!ok) {
			ui.warn('No changes applied.');
			return;
		}
	}

	if (!applyIdentityEdit(config, root, startId, id, ui)) {
		return;
	}
	ui.success('Project details updated.');
};

module.exports = {
	generateIdentity,
	identityFromName,
	CASE_KEYS,
	FIELD_KEYS,
	buildIdentityReplacements,
	validateName,
	editIdentityFields,
	applyIdentityEdit,
	editDetailsFlow,
	detailsOf,
};
