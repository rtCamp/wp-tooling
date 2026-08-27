/**
 * Persist the resolved project identity to a JSON file.
 *
 * Downstream tooling (e.g. a component-download script) reads this to rewrite
 * namespace / text-domain / prefixes inside fetched components.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/** Name of the persisted identity file at the project root. */
const IDENTITY_FILE = '.wp-scaffold.json';

/**
 * Thrown when `.wp-scaffold.json` exists but cannot be parsed. A corrupt
 * identity file must never be silently treated as absent: that would drop an
 * initialized project back into setup mode (and re-run destructive scaffold
 * steps). Callers branch on `code === 'EIDENTITYCORRUPT'`.
 */
class IdentityFileError extends Error {
	constructor(message, details = {}) {
		super(message);
		this.name = 'IdentityFileError';
		this.code = 'EIDENTITYCORRUPT';
		Object.assign(this, details);
	}
}

/**
 * Write the identity payload to `<root>/.wp-scaffold.json` (tab-indented).
 *
 * @param {string} root    - Project root.
 * @param {Object} payload - Identity payload to persist.
 * @param {Object} [ui]    - `@rtcamp/wp-tooling/ui` for an optional log line.
 * @return {string} Absolute path written.
 */
const writeIdentityFile = (root, payload, ui) => {
	const filePath = path.join(root, IDENTITY_FILE);
	fs.writeFileSync(
		filePath,
		`${JSON.stringify(payload, null, '\t')}\n`,
		'utf8'
	);
	if (ui) {
		ui.info(`wrote ${IDENTITY_FILE}`);
	}
	return filePath;
};

/**
 * Read the persisted identity. Absent file -> null; unparseable file -> throw.
 *
 * @param {string} root - Project root.
 * @return {Object|null} The parsed identity, or null when the file is absent.
 * @throws {IdentityFileError} EIDENTITYCORRUPT when the file exists but cannot
 *                             be parsed (callers decide whether --reinit may
 *                             discard it).
 */
const readIdentityFile = (root) => {
	const filePath = path.join(root, IDENTITY_FILE);
	if (!fs.existsSync(filePath)) {
		return null;
	}
	try {
		const identity = JSON.parse(fs.readFileSync(filePath, 'utf8'));
		if (
			!identity ||
			'object' !== typeof identity ||
			Array.isArray(identity)
		) {
			throw new Error('identity root must be a JSON object');
		}
		return identity;
	} catch (err) {
		throw new IdentityFileError(
			`${IDENTITY_FILE} exists but is not valid JSON (${err.message}). ` +
				'Fix or delete the file, or pass --reinit to discard it.',
			{ path: filePath }
		);
	}
};

/**
 * Read the persisted features map ({ key: bool }), or {} when absent.
 *
 * @param {string} root - Project root.
 * @return {Object} Features map.
 */
const readFeatures = (root) => {
	const identity = readIdentityFile(root);
	return (identity && identity.features) || {};
};

/**
 * Update only the `features` field of the persisted identity, preserving every
 * other field and the file's tab indentation.
 *
 * @param {string} root        - Project root.
 * @param {Object} featuresMap - Features map to persist.
 * @param {Object} [ui]        - UI for an optional log line.
 * @return {string} Absolute path written.
 */
const writeFeatures = (root, featuresMap, ui) => {
	const identity = readIdentityFile(root) || {};
	identity.features = featuresMap;
	return writeIdentityFile(root, identity, ui);
};

module.exports = {
	writeIdentityFile,
	readIdentityFile,
	readFeatures,
	writeFeatures,
	IdentityFileError,
	IDENTITY_FILE,
};
