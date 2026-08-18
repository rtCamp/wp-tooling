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
const { ScaffoldError } = require('./errors');
const {
	readConfig,
	setFeatureEnabled,
	setFeatureState,
	getFeatureFiles,
	clearFeatureFiles,
} = require('./config');
const { fetchRemoteFile, verifyChecksum } = require('./fetch');
const {
	INDEX_FILENAME,
	readSources,
	validateSources,
	validateIndex,
	indexEntryToRecord,
} = require('./sources');

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
	 * Remote scaffolds are discovered from `sources.json` (a list of repos),
	 * each of which publishes an `index.json` the registry fetches (cached,
	 * offline-tolerant) to learn what scaffolds it offers. Their manifests are
	 * hydrated lazily on execute() (see hydrateRemote).
	 *
	 * @param {Object} [opts]
	 *                        fetchOpts {Object=} - Forwarded to `fetchRemoteFile`
	 *                        when loading remote indexes (cacheDir, refresh,
	 *                        token, warnings).
	 * @return {Promise<this>} Self, after scanning completes.
	 */
	async scan(opts = {}) {
		this._entries.clear();
		const fetchOpts = opts.fetchOpts || {};
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

		// Remote scaffolds: each entry in sources.json names a repo whose
		// index.json enumerates its scaffolds. Loaded after the local walk so a
		// remote id can be rejected when it collides with a local one. The full
		// manifest is fetched lazily on execute() (see hydrateRemote); here we
		// only learn id + where it lives. `origin: 'remote'` distinguishes it.
		//
		// Gather every declared source (in declaration order), then fetch all
		// their indexes concurrently — N sources is N independent network
		// round-trips, so serialising them needlessly slows `list`/`add`
		// startup. The collision/dedup checks below still run in deterministic
		// source order, so parallel fetching does not change the outcome.
		const allSources = [];
		for (const { dir } of sources) {
			const src = await readSources(dir);
			if (!src) {
				continue;
			}
			const errs = validateSources(src.parsed);
			if (errs.length) {
				throw new ScaffoldError(
					'EBADSCAFFOLD',
					`Invalid sources ${src.file}:\n  - ${errs.join('\n  - ')}`,
					{ file: src.file, errors: errs }
				);
			}
			allSources.push(...src.parsed.sources);
		}

		const perSourceRecords = await Promise.all(
			allSources.map(async (source) => {
				try {
					return await discoverSource(source, fetchOpts);
				} catch (err) {
					// A bad index must not take down local scaffolds or healthy
					// sources; skip it with a warning, as an unreachable index
					// already is in discoverSource.
					if (Array.isArray(fetchOpts.warnings)) {
						fetchOpts.warnings.push(
							`skipping source ${source.repository}@${source.ref}: ${err.message}`
						);
					}
					return [];
				}
			})
		);

		for (let s = 0; s < allSources.length; s++) {
			const source = allSources[s];
			for (const record of perSourceRecords[s]) {
				const key = makeKey(record);
				const existing = this._entries.get(key);
				if (existing && existing.origin !== 'remote') {
					throw new ScaffoldError(
						'EBADSCAFFOLD',
						`remote id '${makeId(record)}' collides with a local scaffold`,
						{ id: makeId(record), source }
					);
				}
				if (existing && existing.origin === 'remote') {
					throw new ScaffoldError(
						'EBADSCAFFOLD',
						`remote id '${makeId(record)}' is offered by more than one source`,
						{ id: makeId(record), source }
					);
				}
				this._entries.set(key, record);
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
	 *                                       dryRun    {boolean=} - When true, do not write files (still returns the plan).
	 *                                       cwd       {string=}  - Target directory. Defaults to process.cwd().
	 *                                       fetchOpts {Object=}  - Forwarded to `fetchRemoteFile` for remote (sources) scaffolds (cacheDir, refresh, token).
	 * @return {Promise<Object>} Result with scaffold/engine/developer/ai/warnings blocks.
	 * @throws {ScaffoldError} ENOSCAFFOLD, EMISSINGINPUT, EBADSCAFFOLD, EWRITEFAIL, ERENDERFAIL, EFETCHFAIL.
	 */
	async execute(id, inputs = {}, opts = {}) {
		let scaffold = this.get(id);
		if (!scaffold) {
			throw new ScaffoldError(
				'ENOSCAFFOLD',
				`No scaffold registered for slug: ${id}`,
				{ requested: id, available: this.all().map(makeId) }
			);
		}

		const cwd = resolveCwd(opts.cwd);
		const dryRun = !!opts.dryRun;
		const warnings = [];
		const fetchOpts = { ...(opts.fetchOpts || {}), warnings };

		// Remote scaffold: fetch + validate its manifest before doing anything
		// else, so the rest of execute() works on a fully-shaped record exactly
		// like a local one. This happens even on a dry run — the plan (which
		// files, which inputs) is meaningless without the manifest — but only
		// the manifest is fetched on a dry run, never the template bodies. The
		// manifest is a single small file, cached for pinned (tag/SHA) refs.
		if (scaffold.origin === 'remote') {
			scaffold = await hydrateRemote(scaffold, fetchOpts);
		}

		const discovery = await loadDiscovery(cwd);
		const resolved = resolveInputs(scaffold, inputs, discovery);

		// Warn on supplied keys the scaffold does not declare. Typos like
		// `--namspace=Inc` would otherwise be silently dropped while the
		// real `namespace` input falls back to its default. Soft warning,
		// not a hard error: the CLI parser cannot know per-scaffold
		// declared inputs at parse time (unlike `detect-changes`, which
		// has a fixed flag list).
		const declaredKeys = Array.isArray(scaffold.inputs)
			? new Set(scaffold.inputs.map((d) => d.key))
			: new Set(inferPlaceholders(scaffold));
		for (const key of Object.keys(inputs)) {
			if (!declaredKeys.has(key)) {
				const known = [...declaredKeys].sort().join(', ') || '(none)';
				warnings.push(
					`unknown input "${key}" supplied — ignored. Declared inputs: ${known}`
				);
			}
		}

		// Pre-fetch the template bodies of a remote scaffold in parallel. The
		// sequential file/test loops below then read from this map instead of
		// hitting the network N times.
		//
		// Only fetch a src whose dest is actually missing — this mirrors the
		// local path (which skips an existing dest before ever reading its
		// template) so a re-run of an already-scaffolded remote scaffold does
		// no network I/O and, crucially, does not fail offline. Test entries
		// that reuse a files[].dest are declarative-lint markers (no body of
		// their own) and are excluded. Dedupe via Set so a shared src fetches
		// once.
		let remoteBodies = null;
		if (scaffold.origin === 'remote' && !dryRun) {
			const fileDests = (scaffold.files || []).map((f) =>
				render(f.dest, resolved)
			);
			const fileDestSet = new Set(fileDests);
			const neededSrcs = new Set();
			for (let i = 0; i < (scaffold.files || []).length; i++) {
				const destAbs = resolveInside(cwd, fileDests[i], 'write');
				if (!(await pathExists(destAbs))) {
					neededSrcs.add(scaffold.files[i].src);
				}
			}
			for (const t of scaffold.tests || []) {
				const destRel = render(t.dest, resolved);
				if (fileDestSet.has(destRel)) {
					continue; // declarative lint — no template body to fetch
				}
				const destAbs = resolveInside(cwd, destRel, 'write');
				if (!(await pathExists(destAbs))) {
					neededSrcs.add(t.src);
				}
			}
			const uniqueSrcs = [...neededSrcs];
			const bodies = await Promise.all(
				uniqueSrcs.map((src) =>
					fetchRemoteFile(scaffold._repository, src, fetchOpts)
				)
			);
			remoteBodies = new Map(
				uniqueSrcs.map((src, i) => [src, bodies[i]])
			);
		}

		const loadTemplate = async (fileSrc) => {
			// For remote scaffolds every src whose dest is missing was
			// prefetched above; the file/test loops only call loadTemplate on
			// a missing dest, so the body is always present in the map.
			if (remoteBodies) {
				return remoteBodies.get(fileSrc);
			}
			return fs.readFile(path.join(scaffold._dir, fileSrc), 'utf8');
		};

		const filesCreated = [];
		const filesSkipped = [];
		for (const file of scaffold.files || []) {
			const destRel = render(file.dest, resolved);
			const destAbs = resolveInside(cwd, destRel, 'write');
			if (await pathExists(destAbs)) {
				filesSkipped.push(destRel);
				warnings.push(
					`file already exists, not overwritten: ${destRel}`
				);
				continue;
			}
			if (!dryRun) {
				const tpl = await loadTemplate(file.src);
				const out = file.raw === true ? tpl : render(tpl, resolved);
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

		// `target_file` templates often build on a path input (e.g.
		// `{{base_path}}/../Modules/Cli.php`); normalise so the caller gets
		// `includes/Modules/Cli.php`, not a `..` segment to clean up.
		const aiWiring = (scaffold.wiring || []).map((w) => ({
			targetFile: path.posix.normalize(render(w.target_file, resolved)),
			anchor: w.anchor,
			snippet: render(w.snippet_template, resolved),
			description: w.description || '',
		}));

		// Declarative tests (lint-only entries like actionlint on the YAML the
		// files-loop just wrote) reuse a files[].dest. Track those so we don't
		// re-check existence (always true post-write), don't re-write, and don't
		// emit a false-positive "already exists" warning.
		const writtenDestSet = new Set([...filesCreated, ...filesSkipped]);

		const aiTests = [];
		for (const t of scaffold.tests || []) {
			const destRel = render(t.dest, resolved);
			const isDeclarativeLint = writtenDestSet.has(destRel);
			if (!isDeclarativeLint) {
				const destAbs = resolveInside(cwd, destRel, 'write');
				if (await pathExists(destAbs)) {
					warnings.push(
						`test stub already exists, not overwritten: ${destRel}`
					);
				} else if (!dryRun) {
					const tpl = await loadTemplate(t.src);
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
				// `kind: 'template'` covers both local and remote (sources)
				// template scaffolds — the AI orchestrator doesn't need to
				// branch on where the body came from; both render Mustache.
				kind: scaffold.source === 'package' ? 'package' : 'template',
				dryRun,
			},
			engine: {
				wrote: filesCreated,
				skipped: filesSkipped,
				// The inputs the engine actually rendered with (supplied →
				// discover_from → default). enable() reuses these to render
				// the feature's owned/gitignore paths, so they can never
				// drift from what execute() created.
				inputs: { ...resolved },
			},
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

	/**
	 * List every toggleable feature (scaffold carrying a `feature` block) with
	 * its current on/off state read from `.wp-tooling.json`. Drives the
	 * per-feature confirm prompts (defaulted to the current state) in the
	 * interactive feature manager.
	 *
	 * @param {string} [cwd=process.cwd()] - Project directory.
	 * @return {Array<{id,slug,name,description,configKey,enabled}>} Feature states.
	 */
	status(cwd = process.cwd()) {
		const dir = path.resolve(cwd);
		// Read .wp-tooling.json once and check each feature against it, rather
		// than one readConfig per feature (status is the features-command hot
		// path).
		const features = readConfig(dir).features || {};
		return this.all()
			.filter((s) => s.feature && s.feature.config_key)
			.map((s) => ({
				id: makeId(s),
				slug: s.slug,
				name: s.name,
				description: s.description,
				configKey: s.feature.config_key,
				enabled: Boolean(features[s.feature.config_key]),
			}));
	}

	/**
	 * Enable a feature: run its scaffold (idempotent file creation, dep/script
	 * reporting), set its flag true in `.wp-tooling.json`, and add its
	 * `gitignore` lines. Engine reports deps; it never installs them.
	 *
	 * The feature's path templates are rendered with the same inputs
	 * execute() used (`result.engine.inputs`), and the rendered lists are
	 * persisted to `.wp-tooling.json` so a later disable() removes exactly
	 * the paths this enable created — even if the inputs are no longer
	 * reproducible (e.g. a one-off `--css_dir` flag).
	 *
	 * @param {string} id       - Feature scaffold id.
	 * @param {Object} [inputs] - Inputs forwarded to execute().
	 * @param {Object} [opts]   - execute() opts (cwd, dryRun, fetchOpts).
	 * @return {Promise<Object>} The execute() result plus a `feature` block.
	 * @throws {ScaffoldError} ENOSCAFFOLD / ENOTFEATURE.
	 */
	async enable(id, inputs = {}, opts = {}) {
		const scaffold = this.requireFeature(id);
		const cwd = resolveCwd(opts.cwd);
		const result = await this.execute(id, inputs, opts);
		const feature = scaffold.feature;
		const vars = result.engine.inputs;
		const files = {
			ownedFiles: renderFeatureLines(feature.owned_files, vars),
			confirmRemove: renderFeatureLines(feature.confirm_remove, vars),
			gitignore: renderFeatureLines(feature.gitignore, vars),
		};
		let gitignoreAdded = [];
		if (!opts.dryRun) {
			// Filesystem effects first, persisted state last: if the
			// .gitignore write fails the feature is NOT recorded as enabled,
			// so .wp-tooling.json never claims a state the disk doesn't back.
			// (execute() already wrote the owned files; re-enable skips them.)
			gitignoreAdded = await addGitignoreLines(cwd, files.gitignore);
			setFeatureState(cwd, feature.config_key, true, files);
		}
		return {
			...result,
			feature: {
				configKey: feature.config_key,
				enabled: true,
				gitignoreAdded,
			},
		};
	}

	/**
	 * Disable a feature: remove its `owned_files`, optionally remove its
	 * `confirm_remove` files (only when `opts.confirmRemove(path)` resolves
	 * truthy — absent ⇒ those are kept, never blind-deleted), drop its
	 * `gitignore` lines, and set its flag false. Idempotent.
	 *
	 * @param {string} id     - Feature scaffold id.
	 * @param {Object} [opts] - { cwd, dryRun, inputs, confirmRemove }.
	 * @return {Promise<Object>} `{ scaffold:{id}, removed, kept, missing, feature }`.
	 * @throws {ScaffoldError} ENOSCAFFOLD / ENOTFEATURE.
	 */
	async disable(id, opts = {}) {
		const scaffold = this.requireFeature(id);
		const cwd = resolveCwd(opts.cwd);
		const feature = scaffold.feature;
		const dryRun = !!opts.dryRun;

		// Prefer the rendered lists persisted by enable() — they are exactly
		// what was created. Fall back to re-rendering the manifest templates
		// for features enabled before this persistence existed (or by hand).
		const persisted = getFeatureFiles(cwd, feature.config_key);
		let ownedFiles, confirmRemove, gitignore;
		if (persisted) {
			ownedFiles = persisted.ownedFiles || [];
			confirmRemove = persisted.confirmRemove || [];
			gitignore = persisted.gitignore || [];
		} else {
			const discovery = await loadDiscovery(cwd);
			const vars = Array.isArray(scaffold.inputs)
				? resolveDeclared(scaffold.inputs, opts.inputs || {}, discovery)
				: opts.inputs || {};
			ownedFiles = renderFeatureLines(feature.owned_files, vars);
			confirmRemove = renderFeatureLines(feature.confirm_remove, vars);
			gitignore = renderFeatureLines(feature.gitignore, vars);
		}

		// Resolve every path up front so the containment check is all-or-
		// nothing: a tampered featureFiles entry pointing outside cwd aborts
		// before any file is removed, never half-way through.
		const ownedAbs = ownedFiles.map((rel) => [
			rel,
			resolveInside(cwd, rel, 'remove'),
		]);
		const confirmAbs = confirmRemove.map((rel) => [
			rel,
			resolveInside(cwd, rel, 'remove'),
		]);

		const removed = [];
		const kept = [];
		const missing = [];

		for (const [rel, abs] of ownedAbs) {
			if (!(await pathExists(abs))) {
				missing.push(rel);
				continue;
			}
			if (!dryRun) {
				await fs.rm(abs, { force: true });
			}
			removed.push(rel);
		}

		for (const [rel, abs] of confirmAbs) {
			if (!(await pathExists(abs))) {
				missing.push(rel);
				continue;
			}
			const ok =
				typeof opts.confirmRemove === 'function'
					? await opts.confirmRemove(rel)
					: false;
			if (ok) {
				if (!dryRun) {
					await fs.rm(abs, { force: true });
				}
				removed.push(rel);
			} else {
				kept.push(rel);
			}
		}

		if (!dryRun) {
			await removeGitignoreLines(cwd, gitignore);
			setFeatureEnabled(cwd, feature.config_key, false);
			clearFeatureFiles(cwd, feature.config_key);
		}

		return {
			scaffold: { id: makeId(scaffold), slug: scaffold.slug, dryRun },
			removed,
			kept,
			missing,
			feature: { configKey: feature.config_key, enabled: false },
		};
	}

	/**
	 * Resolve a scaffold id to a record that carries a `feature` block, or throw.
	 *
	 * @param {string} id - Scaffold id.
	 * @return {Object} The scaffold record.
	 * @throws {ScaffoldError} ENOSCAFFOLD / ENOTFEATURE.
	 */
	requireFeature(id) {
		const scaffold = this.get(id);
		if (!scaffold) {
			throw new ScaffoldError(
				'ENOSCAFFOLD',
				`No scaffold registered for slug: ${id}`,
				{ requested: id, available: this.all().map(makeId) }
			);
		}
		if (!scaffold.feature || !scaffold.feature.config_key) {
			throw new ScaffoldError(
				'ENOTFEATURE',
				`Scaffold '${id}' is not a toggleable feature (no feature.config_key)`,
				{ requested: id }
			);
		}
		return scaffold;
	}
}

/**
 * Discover the scaffolds offered by one source repo by fetching its
 * `index.json` (cached, ETag-validated) and turning each listed entry into a
 * thin remote record. The fetch is offline-tolerant: `fetchRemoteFile` serves
 * a cached index when the network is down, and only throws when there is no
 * cache at all — in which case we skip the source with a warning rather than
 * hard-fail discovery (so local `list`/`add` keep working offline).
 *
 * @param {Object} source    - One validated `sources.json` entry `{ repository, ref, path }`.
 * @param {Object} fetchOpts - Forwarded to `fetchRemoteFile` (cacheDir, refresh, token, warnings).
 * @return {Promise<Object[]>} Thin remote records (empty when the source is unreachable + uncached).
 * @throws {ScaffoldError} EBADSCAFFOLD when a reachable index is invalid JSON or fails its schema.
 */
async function discoverSource(source, fetchOpts) {
	const indexRepo = {
		repository: source.repository,
		ref: source.ref,
		path: source.path,
	};
	const ref = `${source.repository}@${source.ref}/${source.path}/${INDEX_FILENAME}`;
	let text;
	try {
		text = await fetchRemoteFile(indexRepo, INDEX_FILENAME, fetchOpts);
	} catch (err) {
		if (Array.isArray(fetchOpts.warnings)) {
			fetchOpts.warnings.push(
				`could not load scaffold index ${ref}: ${err.message}`
			);
		}
		return [];
	}
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch (err) {
		throw new ScaffoldError(
			'EBADSCAFFOLD',
			`Invalid JSON in remote index ${ref}: ${err.message}`,
			{ source }
		);
	}
	const errs = validateIndex(parsed);
	if (errs.length) {
		throw new ScaffoldError(
			'EBADSCAFFOLD',
			`Invalid remote index ${ref}:\n  - ${errs.join('\n  - ')}`,
			{ source, errors: errs }
		);
	}
	return parsed.scaffolds.map((entry) => indexEntryToRecord(source, entry));
}

/**
 * Hydrate a thin remote record into a full scaffold record by fetching,
 * parsing, and validating its `scaffold.json` from the owning repo. The parsed
 * manifest is memoized on the thin record so a repeat execute in the same
 * process skips the fetch (the on-disk fetch cache covers pinned refs across
 * processes). `--refresh` re-fetches the manifest too.
 *
 * The remote manifest is an ordinary scaffold.json (no special fields). The
 * returned record carries the manifest's fields plus the index's identity
 * (slug/category) and the remote markers (`origin`, `_repository`).
 *
 * @param {Object} record    - Thin remote record from a source index.
 * @param {Object} fetchOpts - Forwarded to `fetchRemoteFile`.
 * @return {Promise<Object>} A full scaffold record.
 * @throws {ScaffoldError} EBADSCAFFOLD (bad JSON / schema), EFETCHFAIL (network).
 */
async function hydrateRemote(record, fetchOpts) {
	const ref = `${record._repository.repository}@${record._repository.ref}/${record._repository.path}/scaffold.json`;
	if (!record._manifest || (fetchOpts && fetchOpts.refresh)) {
		const text = await fetchRemoteFile(
			record._repository,
			'scaffold.json',
			fetchOpts
		);
		// When the index declares a checksum for this scaffold, the fetched
		// manifest must match it — integrity check against a moved ref or a
		// tampered/poisoned response. Format: hex SHA-256 of the manifest
		// body, with an optional `sha256:` prefix.
		if (record._checksum) {
			const { ok, expected, actual } = verifyChecksum(
				record._checksum,
				text
			);
			if (!ok) {
				throw new ScaffoldError(
					'EBADSCAFFOLD',
					`Checksum mismatch for remote scaffold ${makeId(record)} (${ref}): index declares sha256:${expected}, fetched manifest is sha256:${actual}`,
					{ id: makeId(record), repository: record._repository }
				);
			}
		}
		let parsed;
		try {
			parsed = JSON.parse(text);
		} catch (err) {
			throw new ScaffoldError(
				'EBADSCAFFOLD',
				`Invalid JSON in remote scaffold ${makeId(record)} (${ref}): ${err.message}`,
				{ id: makeId(record), repository: record._repository }
			);
		}
		const errs = validate(parsed);
		if (errs.length) {
			throw new ScaffoldError(
				'EBADSCAFFOLD',
				`Invalid remote scaffold ${makeId(record)} (${ref}):\n  - ${errs.join(
					'\n  - '
				)}`,
				{
					id: makeId(record),
					repository: record._repository,
					errors: errs,
				}
			);
		}
		record._manifest = parsed;
	}
	return {
		...record._manifest,
		slug: record.slug,
		category: record.category,
		origin: 'remote',
		_repository: record._repository,
	};
}

/**
 * Load the project files `discover_from` can read, tolerantly. A missing or
 * malformed file becomes `null` (composer/package) or `{}` (config) so that
 * discovery silently falls back to each input's `default` — preserving the
 * behaviour of projects that have no composer.json / .wp-tooling.json.
 *
 * @param {string} cwd - Target project directory.
 * @return {Promise<Object>} `{ 'composer.json', 'package.json', config }`.
 */
async function loadDiscovery(cwd) {
	const readJson = async (file) => {
		let raw;
		try {
			raw = await fs.readFile(path.join(cwd, file), 'utf8');
		} catch {
			return null;
		}
		try {
			const parsed = JSON.parse(raw);
			return parsed && typeof parsed === 'object' ? parsed : null;
		} catch {
			return null;
		}
	};
	return {
		'composer.json': await readJson('composer.json'),
		'package.json': await readJson('package.json'),
		config: readConfig(cwd),
	};
}

/**
 * Resolve a single `discover_from` spec against the loaded project files.
 * Returns `undefined` (→ caller falls back to `default`) for anything that
 * cannot be resolved, which keeps the resolver backward-compatible: a project
 * without the source file behaves exactly as before this resolver existed.
 *
 * Supported sources:
 *   - `composer.json:<dot.path>` / `package.json:<dot.path>` — dotted lookup of
 *     a string value. Special case: `autoload.psr-4` / `autoload.psr-0` reads the
 *     first map entry — its **namespace** (key, trailing `\\` stripped) for
 *     ordinary inputs, its **directory** (value) for path inputs — and grafts
 *     that root onto the input's `default`, keeping the default's sub-namespace
 *     or sub-directory.
 *   - `config:<dot.path>` — string value from `.wp-tooling.json`.
 *
 * Unknown sources (e.g. `plugin-header:`, `input:` handled by the caller)
 * return `undefined`.
 *
 * @param {Object} decl      - The input declaration (its `key` disambiguates psr-4).
 * @param {Object} discovery - The object returned by {@link loadDiscovery}.
 * @return {string|undefined} The discovered string value, or undefined.
 */
function discoverFromSource(decl, discovery) {
	const spec = decl.discover_from;
	const colon = spec.indexOf(':');
	if (colon === -1) {
		return undefined;
	}
	const source = spec.slice(0, colon);

	if (source === 'composer.json' || source === 'package.json') {
		const obj = discovery[source];
		if (!obj) {
			return undefined;
		}
		const selector = spec.slice(colon + 1);
		if (selector === 'autoload.psr-4' || selector === 'autoload.psr-0') {
			const map = getByPath(obj, selector);
			const firstKey =
				map && typeof map === 'object' && !Array.isArray(map)
					? Object.keys(map)[0]
					: undefined;
			if (!firstKey) {
				return undefined;
			}
			if (isPathInput(decl.key)) {
				const def =
					typeof decl.default === 'string' ? decl.default : '';
				return graftPath(map[firstKey], def);
			}
			const root = firstKey.replace(/\\+$/, '');
			// Graft the discovered root onto the default's sub-namespace: a
			// default of `Inc\Cli` means "PSR-4 root + `\Cli`", so a project
			// whose root is `Acme\Blog` gets `Acme\Blog\Cli` — replacing only
			// the first segment would otherwise drop the kind sub-namespace
			// and break PSR-4 (class in includes/Cli/ named `Acme\Blog`).
			const def = typeof decl.default === 'string' ? decl.default : '';
			const sep = def.indexOf('\\');
			return sep === -1 ? root : root + def.slice(sep);
		}
		const value = getByPath(obj, selector);
		return typeof value === 'string' ? value : undefined;
	}
	if (source === 'config') {
		const selector = spec.slice(colon + 1);
		const value = getByPath(discovery.config || {}, selector);
		return typeof value === 'string' ? value : undefined;
	}
	return undefined;
}

// Heuristic: does this input key name a filesystem path/dir rather than a namespace?
function isPathInput(key) {
	return /(^|_)(path|dir)$/.test(key) || key === 'base_path';
}

// The directory counterpart of the namespace graft in discoverFromSource(): a
// PSR-4 map's *value* is the autoload root directory, so a default of
// `includes/Cli` means "root dir + `/Cli`". Grafting keeps the scaffold's
// sub-directory while following the project's own layout — without it, a project
// mapping its root to `inc/` or `src/` gets a correctly-namespaced class written
// outside the autoload root, where it never loads.
function graftPath(value, def) {
	// A PSR-4 target may be a list of directories; the first is the canonical one.
	const raw = Array.isArray(value) ? value[0] : value;
	if (typeof raw !== 'string') {
		return undefined;
	}
	let dir = raw.trim().replace(/\/+$/, '');
	if (dir === '.') {
		dir = '';
	} else if (dir.startsWith('./')) {
		dir = dir.slice(2);
	}
	const slash = def.indexOf('/');
	const tail = slash === -1 ? '' : def.slice(slash + 1);
	if (!dir) {
		// Root-level autoload: the sub-directory alone is the whole path.
		return tail || undefined;
	}
	return tail ? `${dir}/${tail}` : dir;
}

// Resolve a dotted path (`a.b.c`) within a plain object; undefined if absent.
function getByPath(obj, dotted) {
	let cur = obj;
	for (const part of dotted.split('.')) {
		if (cur && typeof cur === 'object' && part in cur) {
			cur = cur[part];
		} else {
			return undefined;
		}
	}
	return cur;
}

/**
 * Pick the value for one input declaration, honouring precedence
 * (supplied → discover_from → default) and the two-pass ordering.
 *
 * `input:<other>` derivations depend on another resolved input, so they are
 * deferred to pass 1; everything else (file discovery, default) resolves on
 * pass 0. Returns `undefined` when nothing is available yet.
 *
 * @param {Object} decl      - Input declaration.
 * @param {Object} supplied  - Caller-supplied inputs.
 * @param {Object} resolved  - Inputs resolved so far (this pass + prior).
 * @param {Object} discovery - Project files for file-based discovery.
 * @param {number} pass      - Resolution pass (0 then 1).
 * @return {string|undefined} The chosen raw value (pre-transform), or undefined.
 */
function valueForInput(decl, supplied, resolved, discovery, pass) {
	if (decl.key in supplied) {
		return supplied[decl.key];
	}
	const df =
		typeof decl.discover_from === 'string' ? decl.discover_from : null;
	if (df && df.startsWith('input:')) {
		if (pass < 1) {
			return undefined; // wait until the source input may be resolved
		}
		const sourceKey = df.slice('input:'.length);
		if (sourceKey in resolved) {
			return resolved[sourceKey];
		}
		return decl.default; // may be undefined
	}
	if (df) {
		const discovered = discoverFromSource(decl, discovery);
		if (discovered !== undefined) {
			return discovered;
		}
	}
	return decl.default; // may be undefined
}

// Two-pass resolution of declared inputs, WITHOUT the required-input check:
// (1) literal / file-discovered / default values, (2) inputs derived from
// earlier inputs via `discover_from: input:<other>`. Returns whatever resolved
// (partial maps are fine for callers like disable() that only need paths).
function resolveDeclared(declared, supplied, discovery) {
	const resolved = {};
	for (let pass = 0; pass < 2; pass++) {
		for (const decl of declared) {
			if (decl.key in resolved) {
				continue;
			}
			const value = valueForInput(
				decl,
				supplied,
				resolved,
				discovery,
				pass
			);
			if (value === undefined) {
				continue;
			}
			resolved[decl.key] = applyTransform(value, decl.transform);
		}
	}
	return resolved;
}

/**
 * Build the resolved-inputs map per WTL-07: declared `inputs[]` is
 * authoritative when present; otherwise fall back to placeholder scan.
 *
 * Precedence per input: supplied value → `discover_from` → `default`. A
 * supplied value always wins, so explicit CLI/AI flags are never overridden by
 * discovery.
 *
 * Throws EMISSINGINPUT (with `missingDetails`) when required inputs are
 * not supplied (after `default` is applied), then EINVALIDINPUT (with
 * `invalid`) when a resolved value falls outside its declared `enum`.
 *
 * @param {Object}                scaffold  - The scaffold record being executed.
 * @param {Object<string,string>} supplied  - Caller-supplied input values.
 * @param {Object}                discovery - Project files for file-based discovery (see loadDiscovery).
 * @return {Object<string,string>} Resolved inputs ready for template substitution.
 */
function resolveInputs(scaffold, supplied, discovery = {}) {
	const declared = Array.isArray(scaffold.inputs) ? scaffold.inputs : null;
	let resolved = {};
	const missing = [];
	const missingDetails = [];

	if (declared) {
		resolved = resolveDeclared(declared, supplied, discovery);
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

	// Constrained inputs are checked post-transform, i.e. on the value that
	// actually reaches the templates.
	const invalid = [];
	for (const decl of declared || []) {
		if (!Array.isArray(decl.enum) || !(decl.key in resolved)) {
			continue;
		}
		if (!decl.enum.includes(resolved[decl.key])) {
			invalid.push({
				key: decl.key,
				value: resolved[decl.key],
				allowed: decl.enum,
			});
		}
	}
	if (invalid.length) {
		throw new ScaffoldError(
			'EINVALIDINPUT',
			`Invalid input values: ${invalid
				.map(
					(i) =>
						`${i.key}='${i.value}' (allowed: ${i.allowed.join(', ')})`
				)
				.join('; ')}`,
			{ scaffold: makeId(scaffold), invalid }
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

/**
 * Resolve an optional target directory, defaulting to the process cwd.
 *
 * @param {string} [cwd] - Target directory.
 * @return {string} Absolute path.
 */
function resolveCwd(cwd) {
	return cwd ? path.resolve(cwd) : process.cwd();
}

/**
 * Join a rendered relative path onto the target directory, refusing anything
 * that escapes it. Enforces the §3 contract guarantee that the engine never
 * reads or writes outside `--cwd`: a `..` smuggled in via a path input, a
 * (possibly remote, third-party) manifest `dest`, or a tampered
 * `.wp-tooling.json` `featureFiles` entry must never reach the filesystem.
 *
 * @param {string} cwd  - Absolute target directory.
 * @param {string} rel  - Rendered path relative to `cwd`.
 * @param {string} verb - Action for the error message ('write' / 'remove').
 * @return {string} The absolute path, guaranteed inside `cwd`.
 * @throws {ScaffoldError} EWRITEFAIL when the path resolves outside `cwd`.
 */
function resolveInside(cwd, rel, verb) {
	const abs = path.resolve(cwd, rel);
	if (abs !== cwd && !abs.startsWith(cwd + path.sep)) {
		throw new ScaffoldError(
			'EWRITEFAIL',
			`Refusing to ${verb} outside the target directory: ${rel}`,
			{ path: rel, errno: 'EOUTSIDE' }
		);
	}
	return abs;
}

/**
 * Render a feature's path/line templates (`gitignore`, etc.) against resolved
 * inputs, dropping any whose placeholders can't be resolved. Mirrors the
 * `renderPath` used for `owned_files`/`confirm_remove` so every feature array
 * gets the same Mustache treatment — a `{{css_dir}}/...` line must never reach
 * `.gitignore` un-rendered.
 *
 * @param {string[]} lines - Raw template lines from the feature block.
 * @param {Object}   vars  - Resolved input values for substitution.
 * @return {string[]} Rendered lines (unresolved ones omitted).
 */
function renderFeatureLines(lines, vars) {
	const out = [];
	for (const raw of lines || []) {
		try {
			out.push(render(raw, vars));
		} catch {
			/* unresolved placeholder — skip this line */
		}
	}
	return out;
}

/**
 * Append the given lines to `<cwd>/.gitignore`, skipping any already present.
 * Creates the file when absent. Returns the lines that were actually added.
 *
 * @param {string}   cwd   - Project directory.
 * @param {string[]} lines - .gitignore lines to ensure are present.
 * @return {Promise<string[]>} The subset of lines newly added.
 */
async function addGitignoreLines(cwd, lines) {
	if (!lines || lines.length === 0) {
		return [];
	}
	const file = path.join(cwd, '.gitignore');
	let current = '';
	try {
		current = await fs.readFile(file, 'utf8');
	} catch {
		current = '';
	}
	const existing = new Set(current.split('\n').map((l) => l.trim()));
	const toAdd = lines.filter((l) => !existing.has(l.trim()));
	if (toAdd.length === 0) {
		return [];
	}
	const prefix =
		current.length === 0 || current.endsWith('\n')
			? current
			: current + '\n';
	await fs.writeFile(file, prefix + toAdd.join('\n') + '\n', 'utf8');
	return toAdd;
}

/**
 * Remove the given lines from `<cwd>/.gitignore` (exact, trimmed match).
 * No-op when the file or lines are absent.
 *
 * @param {string}   cwd   - Project directory.
 * @param {string[]} lines - .gitignore lines to remove.
 * @return {Promise<string[]>} The lines that were removed.
 */
async function removeGitignoreLines(cwd, lines) {
	if (!lines || lines.length === 0) {
		return [];
	}
	const file = path.join(cwd, '.gitignore');
	let current;
	try {
		current = await fs.readFile(file, 'utf8');
	} catch {
		return [];
	}
	const drop = new Set(lines.map((l) => l.trim()));
	const allLines = current.split('\n');
	const shouldDrop = (l) => l.trim() !== '' && drop.has(l.trim());
	const removed = allLines.filter(shouldDrop).map((l) => l.trim());
	if (removed.length === 0) {
		return [];
	}
	const kept = allLines.filter((l) => !shouldDrop(l));
	await fs.writeFile(file, kept.join('\n'), 'utf8');
	return removed;
}

module.exports = { ScaffoldRegistry, ScaffoldError };
