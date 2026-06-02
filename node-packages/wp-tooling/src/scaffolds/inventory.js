/**
 * Scaffold inventory: the local index of scaffolds that live in another
 * repo.
 *
 * Local scaffolds are discovered by scanning `scaffolds/` for `scaffold.json`
 * files. Remote scaffolds are instead listed in an `inventory.json` that maps
 * a scaffold id to the GitHub repo + ref + path that hosts its (ordinary)
 * `scaffold.json` and templates. The registry turns each inventory entry into
 * a thin record and fetches the full manifest on `add` (see registry.js
 * `hydrateRemote`). A remote scaffold's manifest is shape-identical to a local
 * one — remoteness lives here, not in the manifest.
 *
 * Inventory file shape:
 *   { "scaffolds": [ { "id", "name", "description",
 *                      "repository": { "github", "ref", "path" } }, ... ] }
 *
 * `ref` is a literal pin (a tag for reproducibility/caching) — the version of
 * the owning repo wp-tooling fetches the scaffold from. It is independent of
 * any input the scaffold itself declares.
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

const INVENTORY_FILENAME = 'inventory.json';

const SLUG_RE = new RegExp(SLUG_PATTERN);
const CATEGORY_RE = new RegExp(CATEGORY_PATTERN);
const GITHUB_REPO_RE = new RegExp(GITHUB_REPO_PATTERN);

/**
 * Split an inventory id into `{ category, slug }`. The final `/`-segment is
 * the slug; everything before it is the category (`null` when there is none).
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
 * Read `<dir>/inventory.json`.
 *
 * @param {string} dir - Directory that may contain the inventory file.
 * @return {Promise<{file: string, parsed: *}|null>} Parsed inventory + its
 *         path, or `null` when the file is absent (the dormant default).
 * @throws {ScaffoldError} EBADSCAFFOLD when the file exists but is invalid JSON.
 */
async function readInventory(dir) {
	if (!dir) {
		return null;
	}
	const file = path.join(dir, INVENTORY_FILENAME);
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
 * Validate a parsed inventory object's shape. Returns an array of error
 * messages (empty when valid), each prefixed with its field path.
 *
 * @param {unknown} inventory - The parsed inventory.
 * @return {string[]} Error messages.
 */
function validateInventory(inventory) {
	const errors = [];
	if (
		inventory === null ||
		typeof inventory !== 'object' ||
		Array.isArray(inventory)
	) {
		return ['inventory must be a JSON object'];
	}
	if (!Array.isArray(inventory.scaffolds)) {
		return ["inventory: 'scaffolds' must be an array"];
	}
	for (const key of Object.keys(inventory)) {
		if (key !== 'scaffolds') {
			errors.push(`inventory: unknown top-level field '${key}'`);
		}
	}

	const seenIds = new Set();
	for (let i = 0; i < inventory.scaffolds.length; i++) {
		const entry = inventory.scaffolds[i];
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
			if (!['id', 'name', 'description', 'repository'].includes(k)) {
				errors.push(`${at}: unknown field '${k}'`);
			}
		}
		// id
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
		// name / description
		if (typeof entry.name !== 'string' || entry.name.length === 0) {
			errors.push(`${at}.name: must be a non-empty string`);
		}
		if (
			typeof entry.description !== 'string' ||
			entry.description.length === 0
		) {
			errors.push(`${at}.description: must be a non-empty string`);
		}
		// repository
		errors.push(
			...validateRepository(entry.repository, `${at}.repository`)
		);
	}
	return errors;
}

function validateRepository(repository, at) {
	const errs = [];
	if (
		repository === null ||
		typeof repository !== 'object' ||
		Array.isArray(repository)
	) {
		return [`${at}: must be an object`];
	}
	for (const required of ['github', 'ref', 'path']) {
		if (!(required in repository)) {
			errs.push(`${at}.${required}: required`);
		}
	}
	for (const k of Object.keys(repository)) {
		if (!['github', 'ref', 'path'].includes(k)) {
			errs.push(`${at}: unknown field '${k}'`);
		}
	}
	if (
		repository.github !== undefined &&
		(typeof repository.github !== 'string' ||
			!GITHUB_REPO_RE.test(repository.github))
	) {
		errs.push(`${at}.github: must match 'owner/repo'`);
	}
	for (const field of ['ref', 'path']) {
		if (
			repository[field] !== undefined &&
			(typeof repository[field] !== 'string' ||
				repository[field].length === 0)
		) {
			errs.push(`${at}.${field}: must be a non-empty string`);
		}
	}
	return errs;
}

/**
 * Turn a (validated) inventory entry into a thin registry record. The record
 * carries discovery metadata + the repository pointer; the full manifest
 * (inputs/files/wiring/...) is fetched lazily by the registry on `add`.
 *
 * @param {Object} entry - One validated inventory entry.
 * @return {Object} Thin remote scaffold record.
 */
function entryToRecord(entry) {
	const { category, slug } = parseId(entry.id);
	return {
		slug,
		category,
		name: entry.name,
		description: entry.description,
		origin: 'remote',
		_repository: { ...entry.repository },
	};
}

module.exports = {
	INVENTORY_FILENAME,
	parseId,
	readInventory,
	validateInventory,
	entryToRecord,
};
