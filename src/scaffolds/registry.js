/**
 * ScaffoldRegistry: scans, validates, exposes, and executes scaffolds.
 *
 * Two-directory scan model (WTL-09): the registry consults both
 *   - the wp-tooling package's bundled `scaffolds/` (defaults), and
 *   - the consuming project's `bin/scaffolds/` (project-local overrides).
 * Project entries win on category/slug collision; each entry is tagged
 * `source: 'default' | 'project'` so callers can show provenance.
 *
 * No runtime dependencies. Pure JS using built-in `fs/promises` and `path`.
 *
 * IMPORTANT: this module is the engine core. It does NOT import the TTY UI
 * kit. AI orchestrators and CI callers must be able to use it from any
 * context (non-TTY containers, headless harnesses, JSON-only pipelines).
 * Interactive prompting lives in `src/scaffolds/prompt-inputs.js` and is
 * only invoked from `src/scaffolds/add.js` in interactive mode.
 *
 * Implements:
 *   WTL-02  scan / get / filter / collectDependencies
 *   WTL-06  execute(slug, inputs, opts) programmatic API with the
 *           four-block result shape (scaffold / engine / developer / ai)
 *   WTL-09  two-directory scan (defaults + project)
 */

'use strict';

const fs = require('fs/promises');
const path = require('path');

const { validate } = require('./validate');
const { render, collectPlaceholders, applyTransform } = require('./render');

class ScaffoldError extends Error {
	constructor(code, message, details = {}) {
		super(message);
		this.name = 'ScaffoldError';
		this.code = code;
		Object.assign(this, details);
	}
}

class ScaffoldRegistry {
	/**
	 * @param {Object|string} options
	 *                                When passed a string, interpreted as `{ projectDir: options }`
	 *                                (back-compat with single-directory callers).
	 *
	 *                                Object form:
	 *                                defaultsDir {string=}  - absolute path to wp-tooling bundled scaffolds
	 *                                projectDir  {string=}  - absolute path to project bin/scaffolds
	 *
	 *                                Both directories are optional. At least one must be provided.
	 */
	constructor(options) {
		let defaultsDir;
		let projectDir;
		if (typeof options === 'string') {
			projectDir = options;
		} else if (options && typeof options === 'object') {
			defaultsDir = options.defaultsDir;
			projectDir = options.projectDir;
		}
		if (!defaultsDir && !projectDir) {
			throw new ScaffoldError(
				'EBADARGS',
				'ScaffoldRegistry needs at least defaultsDir or projectDir'
			);
		}
		this._defaultsDir = defaultsDir ? path.resolve(defaultsDir) : null;
		this._projectDir = projectDir ? path.resolve(projectDir) : null;
		this._entries = new Map(); // key = `${category||''}/${slug}` => scaffold record
	}

	/**
	 * Discover scaffolds in both directories. Project entries win on
	 * collision. Each entry is tagged with `origin: 'default' | 'project'`
	 * (which directory it came from) and `_dir` (its on-disk root, used by
	 * execute() to resolve templates). NB: `origin` is distinct from the
	 * manifest's `source` field (`template`/`package`), which is preserved
	 * verbatim from scaffold.json.
	 *
	 * @return {Promise<this>} Self, after scanning completes.
	 */
	async scan() {
		this._entries.clear();
		const sources = [
			{ dir: this._defaultsDir, tag: 'default' },
			{ dir: this._projectDir, tag: 'project' },
		].filter((s) => s.dir);

		for (const { dir, tag } of sources) {
			const found = await scanDirectory(dir);
			for (const { record, root } of found) {
				record.origin = tag; // intentionally NOT `source`; that's manifest data.
				record._dir = root;
				const key = makeKey(record);
				this._entries.set(key, record); // last write wins (project)
			}
		}
		return this;
	}

	/** Return all scaffolds in a stable order (by id). */
	all() {
		return Array.from(this._entries.values()).sort((a, b) =>
			makeId(a).localeCompare(makeId(b))
		);
	}

	/**
	 * Find by `<category>/<slug>` (or just `<slug>` when there is no category).
	 *
	 * @param {string} id - Scaffold identifier.
	 * @return {Object|null} The scaffold record, or `null` if not found.
	 */
	get(id) {
		for (const e of this._entries.values()) {
			if (makeId(e) === id || e.slug === id) {
				return e;
			}
		}
		return null;
	}

	/**
	 * Filter by a shallow predicate object (e.g., `{ wizard_step: 'modules' }`).
	 *
	 * @param {Object} predicate - Field/value pairs every match must satisfy.
	 * @return {Object[]} Matching scaffold records.
	 */
	filter(predicate = {}) {
		return this.all().filter((e) =>
			Object.entries(predicate).every(([k, v]) => e[k] === v)
		);
	}

	/**
	 * Merge the five dependency maps across selected slugs.
	 * Returns `{ npm, npmDev, composer, composerDev, composerSuggest }`.
	 * Later entries win on key collision.
	 *
	 * @param {string[]} ids - Scaffold ids whose dep maps should be merged.
	 * @return {Object} Merged dependency maps.
	 */
	collectDependencies(ids) {
		const out = {
			npm: {},
			npmDev: {},
			composer: {},
			composerDev: {},
			composerSuggest: {},
		};
		for (const id of ids) {
			const e = this.get(id);
			if (!e) {
				continue;
			}
			Object.assign(out.npm, e.npm_dependencies || {});
			Object.assign(out.npmDev, e.npm_dev_dependencies || {});
			Object.assign(out.composer, e.composer_dependencies || {});
			Object.assign(out.composerDev, e.composer_dev_dependencies || {});
			Object.assign(out.composerSuggest, e.composer_suggest || {});
		}
		return out;
	}

	/**
	 * Execute one scaffold. Returns the four-block result shape per WTL-06.
	 *
	 * @param {string}                id     - `<category>/<slug>` or `<slug>`.
	 * @param {Object<string,string>} inputs - Caller-supplied input values.
	 * @param {Object}                opts
	 *                                       dryRun {boolean=}  - When true, do not write files (still returns the plan).
	 *                                       cwd    {string=}   - Target directory. Defaults to process.cwd().
	 * @return {Promise<Object>} Result with scaffold/engine/developer/ai/warnings blocks.
	 * @throws {ScaffoldError} ENOSCAFFOLD, EMISSINGINPUT, EWRITEFAIL, ERENDERFAIL.
	 */
	async execute(id, inputs = {}, opts = {}) {
		const scaffold = this.get(id);
		if (!scaffold) {
			throw new ScaffoldError(
				'ENOSCAFFOLD',
				`No scaffold registered for slug: ${id}`,
				{ requested: id, available: this.all().map(makeId) }
			);
		}

		const cwd = opts.cwd ? path.resolve(opts.cwd) : process.cwd();
		const dryRun = !!opts.dryRun;
		const warnings = [];

		const resolved = resolveInputs(scaffold, inputs);

		const filesCreated = [];
		const filesSkipped = [];
		for (const file of scaffold.files || []) {
			const destRel = render(file.dest, resolved);
			const destAbs = path.join(cwd, destRel);
			if (await pathExists(destAbs)) {
				filesSkipped.push(destRel);
				warnings.push(
					`file already exists, not overwritten: ${destRel}`
				);
				continue;
			}
			if (!dryRun) {
				const srcAbs = path.join(scaffold._dir, file.src);
				const tpl = await fs.readFile(srcAbs, 'utf8');
				const out = render(tpl, resolved);
				await fs.mkdir(path.dirname(destAbs), { recursive: true });
				await fs.writeFile(destAbs, out, 'utf8').catch((err) => {
					throw new ScaffoldError(
						'EWRITEFAIL',
						`Failed to write ${destRel}: ${err.code || err.message}`,
						{ path: destRel, errno: err.code }
					);
				});
			}
			filesCreated.push(destRel);
		}

		const aiWiring = (scaffold.wiring || []).map((w) => ({
			targetFile: render(w.target_file, resolved),
			anchor: w.anchor,
			snippet: render(w.snippet_template, resolved),
			description: w.description || '',
		}));

		// Declarative tests (lint-only entries like actionlint on the YAML the
		// files-loop just wrote) reuse a files[].dest. Track those so we don't
		// re-check existence (always true post-write), don't re-write, and don't
		// emit a false-positive "already exists" warning.
		const writtenDestSet = new Set(filesCreated);

		const aiTests = [];
		for (const t of scaffold.tests || []) {
			const destRel = render(t.dest, resolved);
			const isDeclarativeLint = writtenDestSet.has(destRel);
			if (!isDeclarativeLint) {
				const destAbs = path.join(cwd, destRel);
				if (await pathExists(destAbs)) {
					warnings.push(
						`test stub already exists, not overwritten: ${destRel}`
					);
				} else if (!dryRun) {
					const srcAbs = path.join(scaffold._dir, t.src);
					const tpl = await fs.readFile(srcAbs, 'utf8');
					const out = render(tpl, resolved);
					await fs.mkdir(path.dirname(destAbs), { recursive: true });
					await fs.writeFile(destAbs, out, 'utf8').catch((err) => {
						throw new ScaffoldError(
							'EWRITEFAIL',
							`Failed to write ${destRel}: ${err.code || err.message}`,
							{ path: destRel, errno: err.code }
						);
					});
				}
			}
			aiTests.push({
				path: destRel,
				framework: t.framework,
				command: typeof t.command === 'string' ? t.command : null,
			});
		}

		const scaffoldScripts = scaffold.scripts || {};
		return {
			scaffold: {
				id: makeId(scaffold),
				slug: scaffold.slug,
				kind: scaffold.source === 'package' ? 'package' : 'template',
				dryRun,
			},
			engine: { wrote: filesCreated, skipped: filesSkipped },
			developer: {
				install: {
					composer: { ...(scaffold.composer_dependencies || {}) },
					composerDev: {
						...(scaffold.composer_dev_dependencies || {}),
					},
					composerSuggest: { ...(scaffold.composer_suggest || {}) },
					npm: { ...(scaffold.npm_dependencies || {}) },
					npmDev: { ...(scaffold.npm_dev_dependencies || {}) },
				},
				scripts: {
					npm: { ...(scaffoldScripts.npm || {}) },
					composer: { ...(scaffoldScripts.composer || {}) },
				},
				secrets: (scaffold.secrets || []).map((s) => ({ ...s })),
			},
			ai: { wiring: aiWiring, tests: aiTests },
			warnings,
		};
	}
}

/**
 * Build the resolved-inputs map per WTL-07: declared `inputs[]` is
 * authoritative when present; otherwise fall back to placeholder scan.
 *
 * Throws EMISSINGINPUT (with `missingDetails`) when required inputs are
 * not supplied (after `default` is applied).
 *
 * @param {Object}                scaffold - The scaffold record being executed.
 * @param {Object<string,string>} supplied - Caller-supplied input values.
 * @return {Object<string,string>} Resolved inputs ready for template substitution.
 */
function resolveInputs(scaffold, supplied) {
	const declared = Array.isArray(scaffold.inputs) ? scaffold.inputs : null;
	const resolved = {};
	const missing = [];
	const missingDetails = [];

	if (declared) {
		// Two-pass: (1) literal/discovered values from caller or default,
		// (2) derived inputs that reference earlier inputs via `discover_from: input:<other>`.
		for (let pass = 0; pass < 2; pass++) {
			for (const decl of declared) {
				if (decl.key in resolved) {
					continue;
				}
				let value;
				if (decl.key in supplied) {
					value = supplied[decl.key];
				} else if (
					pass === 1 &&
					typeof decl.discover_from === 'string' &&
					decl.discover_from.startsWith('input:')
				) {
					const sourceKey = decl.discover_from.slice('input:'.length);
					if (sourceKey in resolved) {
						value = resolved[sourceKey];
					}
				} else if (decl.default !== undefined) {
					value = decl.default;
				}
				if (value === undefined) {
					continue;
				}
				resolved[decl.key] = applyTransform(value, decl.transform);
			}
		}
		// Anything still missing and required is an error.
		for (const decl of declared) {
			if (!(decl.key in resolved) && decl.required) {
				missing.push(decl.key);
				missingDetails.push({
					key: decl.key,
					description: decl.description,
					discover_from: decl.discover_from || null,
				});
			}
		}
	} else {
		// No declared inputs: infer from placeholders in dest paths and snippets.
		const needed = inferPlaceholders(scaffold);
		for (const key of needed) {
			if (key in supplied) {
				resolved[key] = supplied[key];
			} else {
				missing.push(key);
				missingDetails.push({
					key,
					description: '(inferred from template)',
					discover_from: null,
				});
			}
		}
	}

	if (missing.length) {
		throw new ScaffoldError(
			'EMISSINGINPUT',
			`Missing required inputs: ${missing.join(', ')}`,
			{ scaffold: makeId(scaffold), missing, missingDetails }
		);
	}
	return resolved;
}

function inferPlaceholders(scaffold) {
	const seen = new Set();
	for (const file of scaffold.files || []) {
		for (const p of collectPlaceholders(file.dest)) {
			seen.add(p);
		}
	}
	for (const w of scaffold.wiring || []) {
		for (const p of collectPlaceholders(w.target_file)) {
			seen.add(p);
		}
		for (const p of collectPlaceholders(w.snippet_template)) {
			seen.add(p);
		}
	}
	for (const t of scaffold.tests || []) {
		for (const p of collectPlaceholders(t.dest)) {
			seen.add(p);
		}
	}
	return Array.from(seen);
}

function makeId(scaffold) {
	return scaffold.category
		? `${scaffold.category}/${scaffold.slug}`
		: scaffold.slug;
}

function makeKey(scaffold) {
	return `${scaffold.category || ''}/${scaffold.slug}`;
}

async function scanDirectory(root) {
	const found = [];
	let entries;
	try {
		entries = await fs.readdir(root, { withFileTypes: true });
	} catch (err) {
		if (err.code === 'ENOENT') {
			return found;
		}
		throw err;
	}
	for (const entry of entries) {
		const child = path.join(root, entry.name);
		if (entry.isDirectory()) {
			const sub = await scanDirectory(child);
			found.push(...sub);
		} else if (entry.isFile() && entry.name === 'scaffold.json') {
			const raw = await fs.readFile(child, 'utf8');
			let parsed;
			try {
				parsed = JSON.parse(raw);
			} catch (err) {
				throw new ScaffoldError(
					'EBADSCAFFOLD',
					`Invalid JSON in ${child}: ${err.message}`,
					{ file: child }
				);
			}
			const errors = validate(parsed);
			if (errors.length) {
				throw new ScaffoldError(
					'EBADSCAFFOLD',
					`Invalid scaffold ${child}:\n  - ${errors.join('\n  - ')}`,
					{ file: child, errors }
				);
			}
			found.push({ record: parsed, root: path.dirname(child) });
		}
	}
	return found;
}

async function pathExists(p) {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
}

module.exports = { ScaffoldRegistry, ScaffoldError };
