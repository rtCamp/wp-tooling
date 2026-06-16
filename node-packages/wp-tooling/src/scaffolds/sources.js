/**
 * Remote-scaffold sources: the local list of *repos* that host scaffolds, and
 * the parser/validator for each repo's own scaffold index.
 *
 * Discovery model:
 *   - wp-tooling ships a small `sources.json` listing the repos (and a pinned
 *     ref + path) that host scaffolds — nothing per-scaffold.
 *   - Each owning repo publishes an `index.json` in its `<path>/` that
 *     enumerates the scaffolds it offers. The registry fetches that index to
 *     discover scaffolds (the remote substitute for the local recursive
 *     `scaffold.json` filesystem walk, which is impossible over
 *     `raw.githubusercontent`), then hydrates each scaffold's ordinary
 *     `scaffold.json` + templates lazily on `add` (see registry.js
 *     `hydrateRemote`).
 *
 * `sources.json` shape (wp-tooling side):
 *   { "sources": [ { "repository", "ref", "path" }, ... ] }
 *
 * `index.json` shape (owning-repo side, fetched):
 *   { "scaffolds": [ { "id", "path", "name", "description", "checksum"? }, ... ] }
 *
 * `ref` is a literal pin (a tag/SHA the team controls) — the version of the
 * owning repo wp-tooling fetches scaffolds from. `name`/`description` live in
 * the upstream index so offline `list` has no local copy to drift.
 *
 * Zero runtime dependencies. Pure JS using built-in `fs/promises` and `path`.
 */

'use strict';

const fs = require('fs/promises');
const path = require('path');

const {
	SLUG_PATTERN,
	CATEGORY_PATTERN,
	GITHUB_REPO_PATTERN,
} = require('./schema');
const { ScaffoldError } = require('./errors');

const SOURCES_FILENAME = 'sources.json';
const INDEX_FILENAME = 'index.json';

const SLUG_RE = new RegExp(SLUG_PATTERN);
const CATEGORY_RE = new RegExp(CATEGORY_PATTERN);
const GITHUB_REPO_RE = new RegExp(GITHUB_REPO_PATTERN);

/**
 * Split a scaffold id into `{ category, slug }`. The final `/`-segment is the
 * slug; everything before it is the category (`null` when there is none).
 *
 * @param {string} id - e.g. `ci/test-php` or `cache`.
 * @return {{category: (string|null), slug: string}} Parsed id parts.
 */
function parseId(id) {
	const idx = id.lastIndexOf('/');
	if (idx === -1) {
		return { category: null, slug: id };
	}
	return { category: id.slice(0, idx), slug: id.slice(idx + 1) };
}

/**
 * Read `<dir>/sources.json`.
 *
 * @param {string} dir - Directory that may contain the sources file.
 * @return {Promise<{file: string, parsed: *}|null>} Parsed sources + its path,
 *         or `null` when the file is absent (the dormant default).
 * @throws {ScaffoldError} EBADSCAFFOLD when the file exists but is invalid JSON.
 */
async function readSources(dir) {
	if (!dir) {
		return null;
	}
	const file = path.join(dir, SOURCES_FILENAME);
	let raw;
	try {
		raw = await fs.readFile(file, 'utf8');
	} catch (err) {
		if (err.code === 'ENOENT') {
			return null;
		}
		throw err;
	}
	try {
		return { file, parsed: JSON.parse(raw) };
	} catch (err) {
		throw new ScaffoldError(
			'EBADSCAFFOLD',
			`Invalid JSON in ${file}: ${err.message}`,
			{ file }
		);
	}
}

/**
 * Validate a parsed `sources.json` object's shape. Returns an array of error
 * messages (empty when valid), each prefixed with its field path.
 *
 * @param {unknown} sources - The parsed sources object.
 * @return {string[]} Error messages.
 */
function validateSources(sources) {
	const errors = [];
	if (
		sources === null ||
		typeof sources !== 'object' ||
		Array.isArray(sources)
	) {
		return ['sources must be a JSON object'];
	}
	if (!Array.isArray(sources.sources)) {
		return ["sources: 'sources' must be an array"];
	}
	for (const key of Object.keys(sources)) {
		if (key !== 'sources') {
			errors.push(`sources: unknown top-level field '${key}'`);
		}
	}

	const seen = new Set();
	for (let i = 0; i < sources.sources.length; i++) {
		const entry = sources.sources[i];
		const at = `sources[${i}]`;
		errors.push(...validateSource(entry, at));
		if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
			const dupKey = `${entry.repository}@${entry.path}`;
			if (seen.has(dupKey)) {
				errors.push(
					`${at}: duplicate source '${entry.repository}' path '${entry.path}'`
				);
			}
			seen.add(dupKey);
		}
	}
	return errors;
}

/**
 * Validate one source entry's `{ repository, ref, path }` shape.
 *
 * @param {unknown} source - The candidate source entry.
 * @param {string}  at     - Field-path prefix for messages.
 * @return {string[]} Error messages.
 */
function validateSource(source, at) {
	if (
		source === null ||
		typeof source !== 'object' ||
		Array.isArray(source)
	) {
		return [`${at}: must be an object`];
	}
	const errs = [];
	for (const required of ['repository', 'ref', 'path']) {
		if (!(required in source)) {
			errs.push(`${at}.${required}: required`);
		}
	}
	for (const k of Object.keys(source)) {
		if (!['repository', 'ref', 'path'].includes(k)) {
			errs.push(`${at}: unknown field '${k}'`);
		}
	}
	if (
		source.repository !== undefined &&
		(typeof source.repository !== 'string' ||
			!GITHUB_REPO_RE.test(source.repository))
	) {
		errs.push(`${at}.repository: must match 'owner/repo'`);
	}
	for (const field of ['ref', 'path']) {
		if (
			source[field] !== undefined &&
			(typeof source[field] !== 'string' || source[field].length === 0)
		) {
			errs.push(`${at}.${field}: must be a non-empty string`);
		}
	}
	return errs;
}

/**
 * Validate a parsed remote `index.json` object's shape. Returns an array of
 * error messages (empty when valid), each prefixed with its field path.
 *
 * @param {unknown} index - The parsed index.
 * @return {string[]} Error messages.
 */
function validateIndex(index) {
	const errors = [];
	if (index === null || typeof index !== 'object' || Array.isArray(index)) {
		return ['index must be a JSON object'];
	}
	if (!Array.isArray(index.scaffolds)) {
		return ["index: 'scaffolds' must be an array"];
	}
	for (const key of Object.keys(index)) {
		if (key !== 'scaffolds') {
			errors.push(`index: unknown top-level field '${key}'`);
		}
	}

	const seenIds = new Set();
	for (let i = 0; i < index.scaffolds.length; i++) {
		const entry = index.scaffolds[i];
		const at = `scaffolds[${i}]`;
		if (
			entry === null ||
			typeof entry !== 'object' ||
			Array.isArray(entry)
		) {
			errors.push(`${at}: must be an object`);
			continue;
		}
		for (const k of Object.keys(entry)) {
			if (
				!['id', 'path', 'name', 'description', 'checksum'].includes(k)
			) {
				errors.push(`${at}: unknown field '${k}'`);
			}
		}
		if (typeof entry.id !== 'string' || entry.id.length === 0) {
			errors.push(`${at}.id: must be a non-empty string`);
		} else {
			if (seenIds.has(entry.id)) {
				errors.push(`${at}.id: duplicate id '${entry.id}'`);
			}
			seenIds.add(entry.id);
			const { category, slug } = parseId(entry.id);
			if (!SLUG_RE.test(slug)) {
				errors.push(`${at}.id: slug must match ${SLUG_PATTERN}`);
			}
			if (category !== null && !CATEGORY_RE.test(category)) {
				errors.push(
					`${at}.id: category must match ${CATEGORY_PATTERN}`
				);
			}
		}
		if (typeof entry.path !== 'string' || entry.path.length === 0) {
			errors.push(`${at}.path: must be a non-empty string`);
		}
		if (typeof entry.name !== 'string' || entry.name.length === 0) {
			errors.push(`${at}.name: must be a non-empty string`);
		}
		if (
			typeof entry.description !== 'string' ||
			entry.description.length === 0
		) {
			errors.push(`${at}.description: must be a non-empty string`);
		}
		if (
			entry.checksum !== undefined &&
			typeof entry.checksum !== 'string'
		) {
			errors.push(`${at}.checksum: must be a string`);
		}
	}
	return errors;
}

/**
 * Turn a (validated) index entry into a thin registry record. The record
 * carries discovery metadata + a repository pointer resolved to the scaffold's
 * own directory; the full manifest (inputs/files/wiring/...) is fetched lazily
 * by the registry on `add`.
 *
 * @param {Object} source - The source repo this index came from `{ repository, ref, path }`.
 * @param {Object} entry  - One validated index entry.
 * @return {Object} Thin remote scaffold record.
 */
function indexEntryToRecord(source, entry) {
	const { category, slug } = parseId(entry.id);
	const strip = (s) => String(s).replace(/^\/+|\/+$/g, '');
	const scaffoldPath = [strip(source.path), strip(entry.path)]
		.filter((s) => s.length > 0)
		.join('/');
	return {
		slug,
		category,
		name: entry.name,
		description: entry.description,
		origin: 'remote',
		_repository: {
			repository: source.repository,
			ref: source.ref,
			path: scaffoldPath,
		},
		_checksum: entry.checksum,
	};
}

module.exports = {
	SOURCES_FILENAME,
	INDEX_FILENAME,
	parseId,
	readSources,
	validateSources,
	validateIndex,
	indexEntryToRecord,
};
