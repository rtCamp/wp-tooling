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
 * Read the persisted identity, or null when absent / unparseable.
 *
 * @param {string} root - Project root.
 * @return {Object|null} The parsed identity, or null.
 */
const readIdentityFile = (root) => {
	const filePath = path.join(root, IDENTITY_FILE);
	if (!fs.existsSync(filePath)) {
		return null;
	}
	try {
		return JSON.parse(fs.readFileSync(filePath, 'utf8'));
	} catch {
		return null;
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
	IDENTITY_FILE,
};
