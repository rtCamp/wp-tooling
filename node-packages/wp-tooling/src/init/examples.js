/**
 * Remove the starter's example classes/blocks/templates when the user declines
 * them on first scaffold. Two parts, both driven by the per-project config's
 * `examples` block:
 *
 *   - delete whole files/dirs matching a group's `remove` globs
 *   - strip `// wp:example` ... `// wp:example:end` regions from a group's
 *     `strip` files (so registrations referencing the deleted classes go too)
 *
 * A group may set its own `marker` (e.g. `wp:example:settings`) so several
 * groups can share one registration file, each scoping its own region. Groups
 * that omit it inherit `examples.marker` (the file-per-group model).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { resolveWithin } = require('./transform');

/**
 * Expand a simple glob (only `*`, matched within a single path segment) to
 * absolute matches under root. No `**`, no braces — just enough for the example
 * patterns (e.g. `inc/Modules/*\/Example*.php`).
 *
 * @param {string} root    - Project root.
 * @param {string} pattern - Project-relative glob.
 * @return {string[]} Absolute matching paths.
 */
const expandGlob = (root, pattern) => {
	let bases = [root];

	pattern.split('/').forEach((segment) => {
		const re = new RegExp(
			'^' +
				segment
					.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
					.replace(/\*/g, '[^/]*') +
				'$'
		);
		const next = [];
		bases.forEach((base) => {
			let entries = [];
			try {
				entries = fs.readdirSync(base);
			} catch {
				return;
			}
			entries.forEach((name) => {
				if (re.test(name)) {
					next.push(path.join(base, name));
				}
			});
		});
		bases = next;
	});

	return bases;
};

/**
 * Match a marker line, e.g. `// wp:example` or `// wp:example:end`. Accepts
 * `//`, `#` and `*` comment leaders.
 *
 * @param {string} marker - Marker token.
 * @param {string} suffix - '' for the opener, ':end' for the closer.
 * @return {RegExp} Line matcher.
 */
const markerLine = (marker, suffix) =>
	new RegExp(
		`^\\s*(?://|#|\\*)\\s*${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${suffix}\\s*$`
	);

/**
 * Process `<marker>` ... `<marker>:end` regions. With `dropBody` the whole
 * region (markers + enclosed lines) is removed; otherwise just the two marker
 * comment lines go and the enclosed code stays. Either way the markers never
 * survive into the scaffolded project.
 *
 * @param {string}  text     - File contents.
 * @param {string}  marker   - Marker token.
 * @param {boolean} dropBody - Remove the enclosed lines too.
 * @return {string} Processed text.
 */
const stripRegions = (text, marker, dropBody) => {
	const open = markerLine(marker, '');
	const close = markerLine(marker, ':end');
	const out = [];
	let inside = false;

	text.split('\n').forEach((line) => {
		if (open.test(line) || close.test(line)) {
			inside = open.test(line);
			return; // marker lines are always dropped
		}
		if (!inside || !dropBody) {
			out.push(line);
		}
	});

	return out.join('\n');
};

/**
 * Apply the per-group example decision. Every group's marker comments are
 * stripped (the markers never ship); a group whose key is in `removeKeys` also
 * loses its enclosed registration code and its globbed files.
 *
 * @param {Object}      config     - Per-project scaffold config (uses `examples.groups`).
 * @param {string}      root       - Project root.
 * @param {Object}      ui         - Merged UI.
 * @param {Set<string>} removeKeys - Group keys to remove (others are kept).
 * @return {void}
 */
const applyExamples = (config, root, ui, removeKeys) => {
	const spec = config.examples;
	if (!spec || !Array.isArray(spec.groups)) {
		return;
	}

	const defaultMarker = spec.marker || 'wp:example';
	let deleted = 0;
	let cleaned = 0;

	spec.groups.forEach((group) => {
		const remove = removeKeys.has(group.key);
		// A group's own marker scopes its region when it shares a file with other
		// groups; otherwise the shared default (file-per-group) applies.
		const marker = group.marker || defaultMarker;

		// Strip this group's markers from its registration files (drop the code too
		// when removing). Only regions tagged with this group's marker are touched.
		(group.strip || []).forEach((rel) => {
			let file;
			try {
				file = resolveWithin(root, rel);
			} catch (err) {
				if (ui && ui.warn) {
					ui.warn(err.message);
				}
				return;
			}
			if (!fs.existsSync(file)) {
				return;
			}
			const text = fs.readFileSync(file, 'utf8');
			const next = stripRegions(text, marker, remove);
			if (next !== text) {
				fs.writeFileSync(file, next);
				cleaned++;
			}
		});

		if (remove) {
			(group.remove || []).forEach((glob) => {
				expandGlob(root, glob).forEach((target) => {
					// expandGlob only ever returns paths under root, but re-assert
					// before an irreversible recursive delete.
					resolveWithin(root, path.relative(root, target));
					fs.rmSync(target, { recursive: true, force: true });
					deleted++;
				});
			});
		}
	});

	if (ui && ui.success && (deleted || removeKeys.size)) {
		ui.success(
			`Removed ${removeKeys.size} example set(s): ${deleted} path(s) deleted, ${cleaned} file(s) cleaned.`
		);
	}
};

module.exports = { applyExamples, stripRegions, expandGlob };
