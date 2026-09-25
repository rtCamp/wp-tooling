/**
 * Capability enumeration for `--list`.
 *
 * "Capabilities" are the keep/remove example sets a project declares in its
 * scaffold config under `examples.groups` (post types, taxonomies, blocks, CI
 * workflows, ...). Unlike features (tailwind / hmr), they are a one-shot choice
 * at setup, so their state is RECONCILED from two sources (mirroring the
 * features reconcile pattern -- neither side silently overrides the other):
 *
 *   - `detected`: does the group's primary on-disk artifact (first concrete,
 *     non-glob `remove` path) still exist? Null when the group has no concrete
 *     artifact (glob-only / file-less groups) -- unknown, never guessed.
 *   - `intent`: the selection recorded at setup in `.wp-scaffold.json` under
 *     `examples.removed`. Null for identities written before that field
 *     existed (legacy).
 *
 * `present` prefers detection, falls back to intent, then to true (a fresh
 * starter ships everything). `drift` flags a disagreement when BOTH sides are
 * known -- e.g. the sanctioned manual removal of a module after setup.
 *
 * This module is engine-generic: `module` comes from the group's own config
 * declaration when present; the `inc/Modules/<Name>.php` artifact fallback is
 * a convenience for configs that predate the declared field.
 */

'use strict';

const fs = require('fs');
const { resolveWithin } = require('./transform');

/**
 * Existence check confined to the project root; never throws.
 *
 * @param {string} root - Project root.
 * @param {string} rel  - Project-relative path.
 * @return {boolean} True when the path exists inside root.
 */
const safeExists = (root, rel) => {
	try {
		return fs.existsSync(resolveWithin(root, rel));
	} catch {
		return false;
	}
};

/**
 * The removed-at-setup record from `.wp-scaffold.json`, or null when the
 * identity predates the `examples.removed` field (or there is no identity).
 *
 * @param {Object|null} identity - Parsed identity file.
 * @return {Set<string>|null} Removed group keys, or null when unrecorded.
 */
const recordedRemovals = (identity) =>
	identity && identity.examples && Array.isArray(identity.examples.removed)
		? new Set(identity.examples.removed)
		: null;

/**
 * Enumerate the project's keep/remove capabilities, reconciling recorded
 * intent against detected reality. Reads the filesystem but changes nothing.
 *
 * @param {Object}      config     - Per-project scaffold config.
 * @param {string}      root       - Project root.
 * @param {Object|null} [identity] - Parsed .wp-scaffold.json (manage mode).
 * @return {Array<Object>} One row per capability:
 *   `{ key, label, category, module, present, detected, intent, drift }`.
 */
const listCapabilities = (config, root, identity = null) => {
	const groups = (config.examples && config.examples.groups) || [];
	const removed = recordedRemovals(identity);

	return groups.map((g) => {
		const remove = g.remove || [];
		// Detection uses the first concrete (non-glob) `remove` entry, not
		// `strip` -- strip targets shared files (inc/Core/*) that survive removal.
		const artifact = remove.find((r) => !/[*?]/.test(r)) || null;
		const detected = artifact ? safeExists(root, artifact) : null;
		const intent = removed ? !removed.has(g.key) : null;

		let module = null;
		if (undefined !== g.module) {
			module = g.module || null;
		} else if (artifact) {
			const match = artifact.match(
				/(?:^|\/)inc\/Modules\/([\w-]+)\.php$/
			);
			module = (match && match[1]) || null;
		}

		let present = true;
		if (null !== detected) {
			present = detected;
		} else if (null !== intent) {
			present = intent;
		}

		return {
			key: g.key,
			label: g.label,
			category: g.category || 'Other',
			module,
			present,
			detected,
			intent,
			drift: null !== detected && null !== intent && detected !== intent,
		};
	});
};

/**
 * Render capabilities as a human-readable table (mirrors manage's showStatus).
 *
 * @param {Array<Object>} rows        - Rows from `listCapabilities`.
 * @param {Object}        ui          - UI kit.
 * @param {Object}        [opts]      - Options.
 * @param {string}        [opts.mode] - 'setup' | 'manage' (drives the hint line).
 * @return {void}
 */
const showCapabilities = (rows, ui, opts = {}) => {
	if (!rows.length) {
		ui.info('No keep/remove capabilities are declared for this project.');
		return;
	}
	ui.table(
		rows.map((r) => [
			r.label,
			`${r.present ? 'present' : 'removed'}${r.drift ? '  (drift)' : ''}`,
		]),
		{ title: 'Capabilities' }
	);
	if ('manage' === opts.mode && rows.some((r) => !r.present)) {
		ui.info(
			'Removed capabilities were example sets dropped at setup; add real ones with `npx wp-tooling add`.'
		);
	}
};

module.exports = { listCapabilities, showCapabilities };
