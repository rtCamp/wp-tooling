/**
 * scaffold.json validator -- hand-rolled, zero runtime dependencies.
 *
 * Each error string is prefixed with the source path so a multi-file scan
 * can surface every error together. Empty array means the scaffold is
 * valid.
 */

'use strict';

const {
	REQUIRED_FIELDS,
	ALLOWED_SOURCES,
	ALLOWED_WIZARD_STEPS,
	DEPENDENCY_MAPS,
} = require('./schema');

/**
 * Test whether `value` is a plain object (excludes arrays and `null`).
 *
 * @param {*} value
 * @return {boolean} True when `value` is a non-null, non-array object.
 */
function isPlainObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate a parsed `scaffold.json`. Returns an array of human-readable
 * error strings (empty when the scaffold is valid).
 *
 * @param {*}      scaffold   Parsed JSON value.
 * @param {string} sourcePath Path to the source file, used as error prefix.
 * @return {string[]} Error messages; empty when valid.
 */
function validate(scaffold, sourcePath) {
	const errors = [];
	const where = `${sourcePath}: `;

	if (!isPlainObject(scaffold)) {
		errors.push(where + 'scaffold must be a JSON object');
		return errors;
	}

	for (const field of REQUIRED_FIELDS) {
		if (scaffold[field] === undefined) {
			errors.push(where + `missing required field "${field}"`);
		}
	}

	if (
		scaffold.slug !== undefined &&
		(typeof scaffold.slug !== 'string' ||
			!/^[a-z0-9-]+$/.test(scaffold.slug))
	) {
		errors.push(
			where +
				`slug must be kebab-case, got ${JSON.stringify(scaffold.slug)}`
		);
	}

	if (scaffold.name !== undefined && typeof scaffold.name !== 'string') {
		errors.push(where + 'name must be a string');
	}

	if (
		scaffold.description !== undefined &&
		typeof scaffold.description !== 'string'
	) {
		errors.push(where + 'description must be a string');
	}

	if (
		scaffold.source !== undefined &&
		!ALLOWED_SOURCES.includes(scaffold.source)
	) {
		errors.push(
			where +
				`source must be one of ${ALLOWED_SOURCES.join('|')}, got ${JSON.stringify(scaffold.source)}`
		);
	}

	if (
		scaffold.wizard_step !== undefined &&
		!ALLOWED_WIZARD_STEPS.includes(scaffold.wizard_step)
	) {
		errors.push(
			where +
				`wizard_step must be one of ${ALLOWED_WIZARD_STEPS.map((v) =>
					v === null ? 'null' : v
				).join('|')}, got ${JSON.stringify(scaffold.wizard_step)}`
		);
	}

	if (
		scaffold.module_class !== undefined &&
		typeof scaffold.module_class !== 'string'
	) {
		errors.push(where + 'module_class must be a string');
	}

	if (scaffold.files !== undefined && !Array.isArray(scaffold.files)) {
		errors.push(
			where + 'files must be an array (use [] for source: package)'
		);
	}

	if (Array.isArray(scaffold.files)) {
		scaffold.files.forEach((file, idx) => {
			if (!isPlainObject(file)) {
				errors.push(where + `files[${idx}] must be an object`);
				return;
			}
			if (typeof file.src !== 'string' || file.src.length === 0) {
				errors.push(where + `files[${idx}] missing or empty "src"`);
			}
			if (typeof file.dest !== 'string' || file.dest.length === 0) {
				errors.push(where + `files[${idx}] missing or empty "dest"`);
			}
		});
	}

	for (const key of DEPENDENCY_MAPS) {
		const map = scaffold[key];
		if (map === undefined) {
			continue;
		}
		if (!isPlainObject(map)) {
			errors.push(where + `${key} must be an object`);
			continue;
		}
		for (const [pkg, range] of Object.entries(map)) {
			if (typeof range !== 'string' || range.length === 0) {
				errors.push(
					where +
						`${key}["${pkg}"] must be a non-empty version range string, got ${JSON.stringify(range)}`
				);
			}
		}
	}

	return errors;
}

module.exports = { validate };
