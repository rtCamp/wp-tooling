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

const fs = require('fs');
const path = require('path');

const {
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
} = require('./schema');
const { render, collectPlaceholders } = require('./render');
const {
	SOURCES_FILENAME,
	INDEX_FILENAME,
	validateSources,
	validateIndex,
	indexEntryToRecord,
} = require('./sources');
const { fetchRemoteFile, readCached } = require('./fetch');
const { defaultsDir, projectDir, requireFlagValue } = require('./cli-support');

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
	'scripts',
	'feature',
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
	if (scaffold.scripts !== undefined) {
		errors.push(...validateScripts(scaffold.scripts));
	}
	if (scaffold.feature !== undefined) {
		errors.push(...validateFeature(scaffold.feature));
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
		const fieldPath = `files[${i}]`;
		if (
			entry === null ||
			typeof entry !== 'object' ||
			Array.isArray(entry)
		) {
			errors.push(`${fieldPath}: must be an object`);
			continue;
		}
		if (typeof entry.src !== 'string' || entry.src.length === 0) {
			errors.push(`${fieldPath}.src: must be a non-empty string`);
		}
		if (typeof entry.dest !== 'string' || entry.dest.length === 0) {
			errors.push(`${fieldPath}.dest: must be a non-empty string`);
		}
		if (entry.raw !== undefined && typeof entry.raw !== 'boolean') {
			errors.push(`${fieldPath}.raw: must be a boolean`);
		}
		for (const k of Object.keys(entry)) {
			if (k !== 'src' && k !== 'dest' && k !== 'raw') {
				errors.push(`${fieldPath}: unknown field '${k}'`);
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
		const fieldPath = `inputs[${i}]`;
		if (
			entry === null ||
			typeof entry !== 'object' ||
			Array.isArray(entry)
		) {
			errors.push(`${fieldPath}: must be an object`);
			continue;
		}
		if (typeof entry.key !== 'string' || !INPUT_KEY_RE.test(entry.key)) {
			errors.push(
				`${fieldPath}.key: must match pattern ${INPUT_KEY_PATTERN}`
			);
		} else if (seenKeys.has(entry.key)) {
			errors.push(`${fieldPath}.key: duplicate key '${entry.key}'`);
		} else {
			seenKeys.add(entry.key);
		}
		if (
			typeof entry.description !== 'string' ||
			entry.description.length === 0
		) {
			errors.push(`${fieldPath}.description: must be a non-empty string`);
		}
		if (
			entry.discover_from !== undefined &&
			typeof entry.discover_from !== 'string'
		) {
			errors.push(`${fieldPath}.discover_from: must be a string`);
		}
		if (entry.default !== undefined && typeof entry.default !== 'string') {
			errors.push(`${fieldPath}.default: must be a string`);
		}
		if (
			entry.required !== undefined &&
			typeof entry.required !== 'boolean'
		) {
			errors.push(`${fieldPath}.required: must be a boolean`);
		}
		if (
			entry.transform !== undefined &&
			!ALLOWED_INPUT_TRANSFORMS.includes(entry.transform)
		) {
			errors.push(
				`${fieldPath}.transform: must be one of ${ALLOWED_INPUT_TRANSFORMS.join(', ')}`
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
				errors.push(`${fieldPath}: unknown field '${k}'`);
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
		const fieldPath = `wiring[${i}]`;
		if (
			entry === null ||
			typeof entry !== 'object' ||
			Array.isArray(entry)
		) {
			errors.push(`${fieldPath}: must be an object`);
			continue;
		}
		// target_file and snippet_template are required (engine needs both to
		// place anything). anchor is advisory per the AI contract: validate it's
		// a non-empty string WHEN PRESENT, but allow scaffolds to omit it.
		for (const field of ['target_file', 'snippet_template']) {
			if (typeof entry[field] !== 'string' || entry[field].length === 0) {
				errors.push(
					`${fieldPath}.${field}: must be a non-empty string`
				);
			}
		}
		if (
			entry.anchor !== undefined &&
			(typeof entry.anchor !== 'string' || entry.anchor.length === 0)
		) {
			errors.push(
				`${fieldPath}.anchor: must be a non-empty string when present`
			);
		}
		if (
			entry.description !== undefined &&
			typeof entry.description !== 'string'
		) {
			errors.push(`${fieldPath}.description: must be a string`);
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
				errors.push(`${fieldPath}: unknown field '${k}'`);
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
		const fieldPath = `tests[${i}]`;
		if (
			entry === null ||
			typeof entry !== 'object' ||
			Array.isArray(entry)
		) {
			errors.push(`${fieldPath}: must be an object`);
			continue;
		}
		if (typeof entry.src !== 'string' || entry.src.length === 0) {
			errors.push(`${fieldPath}.src: must be a non-empty string`);
		}
		if (typeof entry.dest !== 'string' || entry.dest.length === 0) {
			errors.push(`${fieldPath}.dest: must be a non-empty string`);
		}
		if (!ALLOWED_TEST_FRAMEWORKS.includes(entry.framework)) {
			errors.push(
				`${fieldPath}.framework: must be one of ${ALLOWED_TEST_FRAMEWORKS.join(', ')}`
			);
		}
		if (entry.command !== undefined && typeof entry.command !== 'string') {
			errors.push(`${fieldPath}.command: must be a string`);
		}
		for (const k of Object.keys(entry)) {
			if (!['src', 'dest', 'framework', 'command'].includes(k)) {
				errors.push(`${fieldPath}: unknown field '${k}'`);
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
		const fieldPath = `secrets[${i}]`;
		if (
			entry === null ||
			typeof entry !== 'object' ||
			Array.isArray(entry)
		) {
			errors.push(`${fieldPath}: must be an object`);
			continue;
		}
		if (typeof entry.key !== 'string' || !SECRET_KEY_RE.test(entry.key)) {
			errors.push(
				`${fieldPath}.key: must match pattern ${SECRET_KEY_PATTERN}`
			);
		}
		if (!ALLOWED_SECRET_SCOPES.includes(entry.scope)) {
			errors.push(
				`${fieldPath}.scope: must be one of ${ALLOWED_SECRET_SCOPES.join(', ')}`
			);
		}
		if (
			typeof entry.description !== 'string' ||
			entry.description.length === 0
		) {
			errors.push(`${fieldPath}.description: must be a non-empty string`);
		}
		if (
			entry.required !== undefined &&
			typeof entry.required !== 'boolean'
		) {
			errors.push(`${fieldPath}.required: must be a boolean`);
		}
		for (const k of Object.keys(entry)) {
			if (!['key', 'scope', 'description', 'required'].includes(k)) {
				errors.push(`${fieldPath}: unknown field '${k}'`);
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

function validateScripts(scripts) {
	const errors = [];
	if (
		scripts === null ||
		typeof scripts !== 'object' ||
		Array.isArray(scripts)
	) {
		return ['scripts: must be an object'];
	}
	for (const target of Object.keys(scripts)) {
		if (!ALLOWED_SCRIPT_TARGETS.includes(target)) {
			errors.push(
				`scripts: unknown target '${target}' (must be one of ${ALLOWED_SCRIPT_TARGETS.join(', ')})`
			);
			continue;
		}
		const map = scripts[target];
		if (map === null || typeof map !== 'object' || Array.isArray(map)) {
			errors.push(`scripts.${target}: must be an object`);
			continue;
		}
		for (const [name, cmd] of Object.entries(map)) {
			if (typeof cmd !== 'string' || cmd.length === 0) {
				errors.push(
					`scripts.${target}['${name}']: must be a non-empty string`
				);
			}
		}
	}
	return errors;
}

const FEATURE_LIST_KEYS = ['owned_files', 'confirm_remove', 'gitignore'];
const FEATURE_KEYS = new Set(['config_key', ...FEATURE_LIST_KEYS]);

function validateFeature(feature) {
	if (
		feature === null ||
		typeof feature !== 'object' ||
		Array.isArray(feature)
	) {
		return ['feature: must be an object'];
	}
	const errors = [];
	if (
		typeof feature.config_key !== 'string' ||
		feature.config_key.length === 0
	) {
		errors.push('feature.config_key: must be a non-empty string');
	}
	for (const arrKey of FEATURE_LIST_KEYS) {
		if (feature[arrKey] === undefined) {
			continue;
		}
		if (!Array.isArray(feature[arrKey])) {
			errors.push(`feature.${arrKey}: must be an array`);
			continue;
		}
		feature[arrKey].forEach((v, i) => {
			if (typeof v !== 'string' || v.length === 0) {
				errors.push(
					`feature.${arrKey}[${i}]: must be a non-empty string`
				);
			}
		});
	}
	for (const k of Object.keys(feature)) {
		if (!FEATURE_KEYS.has(k)) {
			errors.push(`feature: unknown field '${k}'`);
		}
	}
	return errors;
}

// ---------------------------------------------------------------------------
// CLI surface (`wp-tooling validate [scaffold-id...] [flags]`)
//
// The `src/cli/commands/validate.js` thin shim defers to `runCli` here.
// Walks the bundled catalogue (and optionally a project's bin/scaffolds/)
// for each scaffold.json, runs schema validation + on-disk template checks +
// a render dry-run with placeholder fill-ins.
//
// Implements:
//   WTL-11  validate subcommand for scaffold authoring ergonomics
// ---------------------------------------------------------------------------

function parseArgs(argv) {
	const opts = {
		ids: [],
		cwd: null,
		json: false,
		help: false,
		remote: false,
		refresh: false,
		cacheDir: null,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		// Value of a space-separated flag; rejects a missing or flag-shaped
		// value rather than swallowing the next flag.
		const value = () => requireFlagValue(argv[++i], a);
		if (a === '--help' || a === '-h') {
			opts.help = true;
		} else if (a === '--json') {
			opts.json = true;
		} else if (a === '--cwd') {
			opts.cwd = value();
		} else if (a.startsWith('--cwd=')) {
			opts.cwd = a.slice('--cwd='.length);
		} else if (a === '--remote') {
			opts.remote = true;
		} else if (a === '--refresh') {
			opts.refresh = true;
		} else if (a === '--cache-dir') {
			opts.cacheDir = value();
		} else if (a.startsWith('--cache-dir=')) {
			opts.cacheDir = a.slice('--cache-dir='.length);
		} else if (a.startsWith('--')) {
			throw new Error(`Unexpected flag: ${a}`);
		} else {
			opts.ids.push(a);
		}
	}
	return opts;
}

function printHelp() {
	process.stdout.write(
		[
			'Usage: wp-tooling validate [scaffold-id...] [flags]',
			'',
			'Validates scaffold manifests. With no id, checks the whole bundled catalogue.',
			'With one or more ids (e.g. wp/cli, lint/phpcs/vip), only those are checked.',
			'Remote scaffolds (from sources.json) are recognised; by default only the',
			'sources.json shape is checked offline (plus remote ids from any cached index).',
			'Pass --remote to fetch each repo index + scaffold manifest and schema-validate.',
			'',
			'Flags:',
			'  --cwd <path>      Also include project-local scaffolds at <path>/bin/scaffolds.',
			'  --remote          Fetch + schema-validate each remote index + manifest (network).',
			'  --refresh         With --remote, bypass the cache and re-fetch.',
			'  --cache-dir <p>   With --remote, override the remote-fetch cache directory.',
			'  --json            Machine-readable output.',
			'  --help, -h        Show this help.',
			'',
			'Exit code: 0 if all valid, 1 if any errors.',
			'',
		].join('\n')
	);
}

function findScaffoldJsons(root) {
	const out = [];
	const walk = (dir) => {
		let entries;
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch (err) {
			if (err.code === 'ENOENT') {
				return;
			}
			throw err;
		}
		for (const entry of entries) {
			const child = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(child);
			} else if (entry.isFile() && entry.name === 'scaffold.json') {
				out.push(child);
			}
		}
	};
	walk(root);
	return out;
}

function makeId(parsed) {
	return parsed.category ? `${parsed.category}/${parsed.slug}` : parsed.slug;
}

function checkTemplatesExist(scaffold, scaffoldDir) {
	const errs = [];
	const checkFile = (src, kind) => {
		if (typeof src !== 'string') {
			return;
		}
		const abs = path.join(scaffoldDir, src);
		if (!fs.existsSync(abs)) {
			errs.push(`${kind} template not found on disk: ${src}`);
		}
	};
	for (const file of scaffold.files || []) {
		checkFile(file.src, 'files[]');
	}
	for (const test of scaffold.tests || []) {
		checkFile(test.src, 'tests[]');
	}
	return errs;
}

function checkTemplatesRender(scaffold, scaffoldDir) {
	const errs = [];
	const supply = {};
	for (const i of scaffold.inputs || []) {
		supply[i.key] = i.default !== undefined ? i.default : 'x';
	}
	const tryRender = (src, kind) => {
		if (typeof src !== 'string') {
			return;
		}
		const abs = path.join(scaffoldDir, src);
		if (!fs.existsSync(abs)) {
			return;
		}
		const tpl = fs.readFileSync(abs, 'utf8');
		const missing = collectPlaceholders(tpl).filter((k) => !(k in supply));
		for (const k of missing) {
			supply[k] = 'x';
		}
		try {
			render(tpl, supply);
		} catch (err) {
			errs.push(`${kind} render failed for ${src}: ${err.message}`);
		}
	};
	for (const file of scaffold.files || []) {
		tryRender(file.src, 'files[]');
	}
	for (const test of scaffold.tests || []) {
		tryRender(test.src, 'tests[]');
	}
	for (const w of scaffold.wiring || []) {
		try {
			const missing = collectPlaceholders(w.snippet_template).filter(
				(k) => !(k in supply)
			);
			for (const k of missing) {
				supply[k] = 'x';
			}
			render(w.snippet_template, supply);
		} catch (err) {
			errs.push(`wiring snippet_template render failed: ${err.message}`);
		}
	}
	return errs;
}

function validateOne(file) {
	const result = { file, id: null, valid: true, errors: [] };
	let parsed;
	try {
		parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch (err) {
		result.valid = false;
		result.errors.push(`Invalid JSON: ${err.message}`);
		return result;
	}
	result.id = makeId(parsed);
	const schemaErrors = validate(parsed);
	if (schemaErrors.length) {
		result.valid = false;
		result.errors.push(...schemaErrors);
	}
	const dir = path.dirname(file);
	const missingTpl = checkTemplatesExist(parsed, dir);
	if (missingTpl.length) {
		result.valid = false;
		result.errors.push(...missingTpl);
	}
	const renderErrs = checkTemplatesRender(parsed, dir);
	if (renderErrs.length) {
		result.valid = false;
		result.errors.push(...renderErrs);
	}
	return result;
}

function collectFiles(opts) {
	const files = findScaffoldJsons(defaultsDir());
	if (opts.cwd) {
		files.push(...findScaffoldJsons(projectDir(opts.cwd)));
	}
	return files;
}

/**
 * Validate the `sources.json` file(s) and the remote scaffolds they reach.
 *
 * Emits rows shaped like `validateOne` output:
 *   - one file-level row per `sources.json` (`id: 'sources'`) carrying its
 *     shape result (malformed JSON, bad/duplicate source entries);
 *   - one row per remote scaffold (`id: <category/slug>`, `remote: true`) so
 *     that `validate <remote-id>` resolves instead of erroring; and
 *   - an index-level error row when a reachable index is unfetchable/invalid.
 *
 * Default is offline: the `sources.json` shape is checked, and remote ids are
 * enumerated only from a **cached** index (none → no per-id rows). With
 * `opts.remote`, each repo's `index.json` and every scaffold's `scaffold.json`
 * is fetched at the pinned ref and schema-validated (reusing the same
 * `validate()` the registry runs on `add`); network/HTTP failures become
 * `EFETCHFAIL`-tagged errors. Per-id rows are only produced when the
 * `sources.json` shape is sound.
 *
 * Absent `sources.json` files contribute nothing — the dormant default leaves
 * `validate` behaving exactly as before.
 *
 * @param {Object}      opts     - Parsed CLI options (`cwd`, `remote`, `refresh`, `cacheDir`, `ids`).
 * @param {Set<string>} localIds - Ids of the discovered local scaffolds.
 * @return {Promise<Array<{file: string, id: string, valid: boolean, errors: string[], remote?: boolean}>>} Result rows.
 */
async function collectSourcesResults(opts, localIds) {
	const dirs = [defaultsDir()];
	if (opts.cwd) {
		dirs.push(projectDir(opts.cwd));
	}
	const fetchOpts = {};
	if (opts.refresh) {
		fetchOpts.refresh = true;
	}
	if (opts.cacheDir) {
		fetchOpts.cacheDir = opts.cacheDir;
	}
	const wanted = opts.ids.length ? new Set(opts.ids) : null;

	const results = [];
	for (const dir of dirs) {
		const file = path.join(dir, SOURCES_FILENAME);
		if (!fs.existsSync(file)) {
			continue;
		}
		const fileRow = { file, id: 'sources', valid: true, errors: [] };
		let parsed;
		try {
			parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
		} catch (err) {
			fileRow.valid = false;
			fileRow.errors.push(`Invalid JSON: ${err.message}`);
			results.push(fileRow);
			continue;
		}
		const shapeErrs = validateSources(parsed);
		if (shapeErrs.length) {
			fileRow.valid = false;
			fileRow.errors.push(...shapeErrs);
		}
		results.push(fileRow);

		// Per-remote-id rows require a sound sources file: we never fetch from a
		// malformed source list.
		if (!fileRow.valid) {
			continue;
		}
		for (const source of parsed.sources) {
			const records = await resolveSourceRecords(
				source,
				opts,
				fetchOpts,
				results,
				file
			);
			for (const record of records) {
				const id = makeId(record);
				if (wanted && !wanted.has(id)) {
					continue;
				}
				const row = {
					file,
					id,
					valid: true,
					errors: [],
					remote: true,
				};
				if (localIds.has(id)) {
					row.valid = false;
					row.errors.push(
						`id '${id}' collides with a local scaffold`
					);
				}
				if (opts.remote && row.valid) {
					await validateRemoteManifest(record, fetchOpts, row);
				}
				results.push(row);
			}
		}
	}
	return results;
}

/**
 * Resolve the thin remote records a source offers: under `opts.remote` fetch +
 * validate its `index.json`; otherwise read a cached index only (offline). An
 * unfetchable/invalid reachable index pushes an error row into `results` and
 * yields no records.
 *
 * @param {Object} source    - A validated `sources.json` entry `{ repository, ref, path }`.
 * @param {Object} opts      - Parsed CLI options.
 * @param {Object} fetchOpts - Forwarded to `fetchRemoteFile`.
 * @param {Array}  results   - Result rows (mutated to append index-level errors).
 * @param {string} file      - The `sources.json` path (for row attribution).
 * @return {Promise<Object[]>} Thin remote records (empty on uncached-offline or index error).
 */
async function resolveSourceRecords(source, opts, fetchOpts, results, file) {
	const indexRepo = {
		repository: source.repository,
		ref: source.ref,
		path: source.path,
	};
	const ref = `${source.repository}@${source.ref}/${source.path}/${INDEX_FILENAME}`;
	const indexErr = (errors) =>
		results.push({
			file,
			id: `${source.repository} (index)`,
			valid: false,
			errors,
			remote: true,
		});

	let text;
	if (opts.remote) {
		try {
			text = await fetchRemoteFile(indexRepo, INDEX_FILENAME, fetchOpts);
		} catch (err) {
			indexErr([`${err.code || 'EFETCHFAIL'}: ${err.message}`]);
			return [];
		}
	} else {
		text = await readCached(indexRepo, INDEX_FILENAME, {
			cacheDir: opts.cacheDir || undefined,
		});
		if (text === null) {
			return [];
		}
	}

	let indexParsed;
	try {
		indexParsed = JSON.parse(text);
	} catch (err) {
		indexErr([`invalid index JSON (${ref}): ${err.message}`]);
		return [];
	}
	const errs = validateIndex(indexParsed);
	if (errs.length) {
		indexErr(errs.map((e) => `index (${ref}): ${e}`));
		return [];
	}
	return indexParsed.scaffolds.map((entry) =>
		indexEntryToRecord(source, entry)
	);
}

/**
 * Fetch a remote scaffold's `scaffold.json` at its pinned ref and schema-validate
 * it, mutating `row` in place. A fetch failure (`EFETCHFAIL`) or invalid manifest
 * (bad JSON / schema errors) marks the row invalid with attributed messages.
 *
 * @param {Object} record    - A thin remote record (`_repository`).
 * @param {Object} fetchOpts - Forwarded to `fetchRemoteFile` (`refresh`, `cacheDir`).
 * @param {Object} row       - The result row to annotate.
 * @return {Promise<void>} Resolves once `row` reflects the manifest's validity.
 */
async function validateRemoteManifest(record, fetchOpts, row) {
	const repo = record._repository;
	const ref = `${repo.repository}@${repo.ref}/${repo.path}/scaffold.json`;
	let text;
	try {
		text = await fetchRemoteFile(repo, 'scaffold.json', fetchOpts);
	} catch (err) {
		row.valid = false;
		row.errors.push(`${err.code || 'EFETCHFAIL'}: ${err.message}`);
		return;
	}
	let manifest;
	try {
		manifest = JSON.parse(text);
	} catch (err) {
		row.valid = false;
		row.errors.push(
			`remote manifest not valid JSON (${ref}): ${err.message}`
		);
		return;
	}
	const errs = validate(manifest);
	if (errs.length) {
		row.valid = false;
		row.errors.push(...errs.map((e) => `remote manifest (${ref}): ${e}`));
	}
}

function filterByIds(results, ids) {
	if (!ids.length) {
		return results;
	}
	const wanted = new Set(ids);
	return results.filter((r) => wanted.has(r.id));
}

function printHuman(results) {
	const writeln = (s) => process.stdout.write(`${s}\n`);
	const totals = { valid: 0, invalid: 0 };
	for (const r of results) {
		const tag = r.remote ? ' (remote)' : '';
		if (r.valid) {
			totals.valid++;
			writeln(`ok   ${r.id || '(unknown)'}${tag}`);
		} else {
			totals.invalid++;
			writeln(`FAIL ${r.id || '(unknown)'}${tag}  (${r.file})`);
			for (const e of r.errors) {
				writeln(`     - ${e}`);
			}
		}
	}
	writeln('');
	writeln(
		`Total: ${results.length}  valid: ${totals.valid}  invalid: ${totals.invalid}`
	);
}

async function runCli(argv) {
	let opts;
	try {
		opts = parseArgs(argv);
	} catch (err) {
		process.stderr.write(`Error: ${err.message}\n`);
		return 1;
	}
	if (opts.help) {
		printHelp();
		return 0;
	}
	const files = collectFiles(opts);
	const allResults = files.map(validateOne);
	const localIds = new Set(allResults.map((r) => r.id).filter(Boolean));
	allResults.push(...(await collectSourcesResults(opts, localIds)));
	const results = filterByIds(allResults, opts.ids);
	if (opts.ids.length && results.length === 0) {
		const available = allResults.map((r) => r.id).filter(Boolean);
		const err = `No scaffolds matched: ${opts.ids.join(', ')}`;
		if (opts.json) {
			process.stderr.write(
				JSON.stringify({
					code: 'ENOSCAFFOLD',
					message: err,
					available,
				}) + '\n'
			);
		} else {
			process.stderr.write(`Error: ${err}\n`);
			process.stderr.write(`Available ids: ${available.join(', ')}\n`);
		}
		return 1;
	}
	const anyInvalid = results.some((r) => !r.valid);
	if (opts.json) {
		process.stdout.write(JSON.stringify({ results }) + '\n');
	} else {
		printHuman(results);
	}
	return anyInvalid ? 1 : 0;
}

module.exports = {
	validate,
	runCli,
	parseArgs,
	printHelp,
	validateOne,
	findScaffoldJsons,
};
