/**
 * Interactive input collector. The ONLY module under src/scaffolds/ that
 * imports the TTY UI kit. Called from `src/scaffolds/add.js` in interactive
 * mode only. AI orchestrators and CI scripts never load this file.
 *
 * Catches `EMISSINGINPUT` errors from `registry.execute()` and prompts the
 * developer for each missing input via TTY UI `text()`. Returns the
 * supplemented inputs object so the caller can retry the execute call.
 *
 * Implements:
 *   WTL-06  interactive layer on top of the engine
 */

'use strict';

const { text, confirm, CancelledError } = require('@rtcamp/wp-tooling/ui');

/**
 * Prompt the developer for each missing input, returning a merged map.
 *
 * @param {Object}   options
 * @param {Object}   options.scaffold       - The scaffold record (has `inputs[]`).
 * @param {string[]} options.missing        - Keys reported by EMISSINGINPUT.
 * @param {Object}   options.missingDetails - Per-key metadata from the error payload.
 * @param {Object}   options.supplied       - Inputs already supplied (will be merged into).
 * @return {Promise<Object>} The merged inputs object.
 * @throws {CancelledError} If the developer hits Ctrl+C.
 */
async function promptMissingInputs({
	scaffold,
	missing,
	missingDetails,
	supplied,
}) {
	const next = { ...supplied };
	for (const key of missing) {
		const detail = missingDetails.find((d) => d.key === key) || {};
		const declared =
			(scaffold.inputs || []).find((i) => i.key === key) || {};
		const message =
			detail.description || declared.description || `Value for ${key}`;
		const defaultValue = declared.default;
		const answer = await text({
			message: `${message}${defaultValue !== undefined ? ` (default: ${defaultValue})` : ''}`,
			defaultValue,
		});
		next[key] = answer;
	}
	return next;
}

/**
 * Ask the developer to confirm the planned scaffold run.
 *
 * @param {Object}   options
 * @param {string}   options.scaffoldId - `<category>/<slug>` form.
 * @param {string[]} options.willCreate - Paths the engine plans to write.
 * @return {Promise<boolean>} `true` if the developer approves, `false` otherwise.
 */
async function confirmRun({ scaffoldId, willCreate }) {
	const fileLine =
		willCreate.length === 1
			? `1 file (${willCreate[0]})`
			: `${willCreate.length} files`;
	return confirm({
		message: `Scaffold ${scaffoldId} will create ${fileLine}. Proceed?`,
		defaultValue: true,
	});
}

module.exports = { promptMissingInputs, confirmRun, CancelledError };
