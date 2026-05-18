/**
 * ScaffoldRegistry -- recursive `scaffold.json` discovery + validation.
 *
 * Library API:
 *   const { ScaffoldRegistry } = require( '@rtcamp/wp-tooling/scaffolds' );
 *   const r = new ScaffoldRegistry( '/path/to/skeleton/bin/scaffolds' );
 *   await r.scan();
 *   r.all();
 *   r.filter({ wizard_step: 'modules' });
 *   r.collectDependencies(['cache', 'algolia']);
 *
 * Zero runtime dependencies -- Node built-ins only.
 */

'use strict';

const fs = require('fs').promises;
const path = require('path');
const { validate } = require('./validate');

/**
 * Output keys for `collectDependencies`. Mirrors the snake_case schema
 * fields onto the camelCase API shape consumers see. Kept here (not in
 * `schema.js`) because the camelCase keys are an API decision rather than
 * a schema rule.
 */
const DEPENDENCY_OUTPUT_KEYS = {
	npm_dependencies: 'npm',
	npm_dev_dependencies: 'npmDev',
	composer_dependencies: 'composer',
	composer_dev_dependencies: 'composerDev',
	composer_suggest: 'composerSuggest',
};

class ScaffoldRegistry {
	/**
	 * @param {string} rootDir Directory to scan recursively for `scaffold.json` files.
	 */
	constructor(rootDir) {
		this.rootDir = rootDir;
		this.scaffolds = {};
	}

	/**
	 * Scan `rootDir` recursively, parse + validate every `scaffold.json`,
	 * then atomically replace `this.scaffolds`. Last-write-wins on
	 * duplicate slugs within a single scan, with a stderr warning.
	 *
	 * State updates are atomic relative to errors:
	 * - On parse or validation failure, `this.scaffolds` is unchanged --
	 *   the caller can inspect the prior good state or retry.
	 * - On a missing `rootDir`, `this.scaffolds` is cleared and an empty
	 *   array is returned. The registry reflects the directory's current
	 *   reality, not historical state from a previous scan.
	 * - On success, `this.scaffolds` is replaced with the new map.
	 *   Slugs that existed in a previous scan but are absent from this
	 *   one are removed.
	 *
	 * @return {Promise<Object[]>} All discovered scaffolds.
	 * @throws {Error} On JSON parse failure or schema validation failure,
	 *                 with the offending file path in the message.
	 */
	async scan() {
		let files;
		try {
			files = await this._findScaffoldFiles(this.rootDir);
		} catch (err) {
			if (err.code === 'ENOENT') {
				this.scaffolds = {};
				return [];
			}
			throw err;
		}

		files.sort();

		const nextScaffolds = {};

		for (const file of files) {
			let parsed;
			try {
				parsed = JSON.parse(await fs.readFile(file, 'utf8'));
			} catch (err) {
				throw new Error(`Failed to parse ${file}: ${err.message}`);
			}
			const errors = validate(parsed, file);
			if (errors.length > 0) {
				throw new Error(errors.join('\n'));
			}
			if (nextScaffolds[parsed.slug]) {
				process.stderr.write(
					`scaffolds: duplicate slug "${parsed.slug}" at ${file} ` +
						`overrides earlier definition (last write wins)\n`
				);
			}
			nextScaffolds[parsed.slug] = parsed;
		}

		this.scaffolds = nextScaffolds;
		return this.all();
	}

	/**
	 * @return {Object[]} All scaffolds discovered by the last `scan()`.
	 */
	all() {
		return Object.values(this.scaffolds);
	}

	/**
	 * Filter scaffolds by a predicate.
	 *
	 * Shorthand: pass an object literal -- each key/value pair must match
	 * the scaffold's same-named property by strict equality. Example:
	 * `filter({ wizard_step: 'modules' })`.
	 *
	 * Function form: pass `(scaffold) => boolean`. Example:
	 * `filter((s) => s.slug.startsWith('rest-'))`.
	 *
	 * @param {Object|Function} predicate
	 * @return {Object[]} Matching scaffolds.
	 * @throws {TypeError} When `predicate` is neither an object nor a function.
	 */
	filter(predicate) {
		const fn =
			typeof predicate === 'function'
				? predicate
				: this._objectPredicate(predicate);
		return this.all().filter(fn);
	}

	/**
	 * Merge the five dependency maps across the named scaffolds.
	 *
	 * Last-write-wins on per-package version conflicts; conflicts are
	 * surfaced via a stderr warning so a caller running in CI can grep
	 * for them.
	 *
	 * @param {string[]} slugs
	 * @return {{
	 *   npm: Object,
	 *   npmDev: Object,
	 *   composer: Object,
	 *   composerDev: Object,
	 *   composerSuggest: Object,
	 * }} Merged dependency maps.
	 */
	collectDependencies(slugs) {
		const out = {
			npm: {},
			npmDev: {},
			composer: {},
			composerDev: {},
			composerSuggest: {},
		};
		for (const slug of slugs) {
			const scaffold = this.scaffolds[slug];
			if (!scaffold) {
				continue;
			}
			for (const [schemaKey, outKey] of Object.entries(
				DEPENDENCY_OUTPUT_KEYS
			)) {
				this._mergeMap(out[outKey], scaffold[schemaKey], {
					ownerSlug: slug,
					mapName: outKey,
				});
			}
		}
		return out;
	}

	/**
	 * Build an object-shorthand predicate. Validates that the input is a
	 * plain object so callers get a clear error rather than `undefined`
	 * filter behaviour.
	 *
	 * @param {Object} spec
	 * @return {Function} Predicate.
	 * @throws {TypeError} When `spec` is not a plain object.
	 */
	_objectPredicate(spec) {
		if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
			throw new TypeError(
				'ScaffoldRegistry.filter expects an object or a function'
			);
		}
		const entries = Object.entries(spec);
		return (s) => entries.every(([k, v]) => s[k] === v);
	}

	/**
	 * Merge a scaffold's dependency map into the accumulator. Last write
	 * wins; emits a stderr warning when a key already exists with a
	 * different value.
	 *
	 * @param {Object}                                 target
	 * @param {Object|null}                            source
	 * @param {{ ownerSlug: string, mapName: string }} ctx    Diagnostic context.
	 */
	_mergeMap(target, source, ctx) {
		if (!source) {
			return;
		}
		for (const [key, value] of Object.entries(source)) {
			if (
				Object.prototype.hasOwnProperty.call(target, key) &&
				target[key] !== value
			) {
				process.stderr.write(
					`scaffolds: ${ctx.mapName} version conflict for "${key}": ` +
						`"${target[key]}" -> "${value}" (from "${ctx.ownerSlug}"); ` +
						`last write wins\n`
				);
			}
			target[key] = value;
		}
	}

	/**
	 * Walk `dir` recursively and return every `scaffold.json` path found.
	 * Does not follow symlinks (per `fs.readdir`'s default with
	 * `withFileTypes: true`).
	 *
	 * @param {string} dir
	 * @return {Promise<string[]>} Absolute or relative paths, depending on `rootDir`.
	 */
	async _findScaffoldFiles(dir) {
		const out = [];
		const entries = await fs.readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				const nested = await this._findScaffoldFiles(full);
				out.push(...nested);
			} else if (entry.isFile() && entry.name === 'scaffold.json') {
				out.push(full);
			}
		}
		return out;
	}
}

module.exports = { ScaffoldRegistry };
