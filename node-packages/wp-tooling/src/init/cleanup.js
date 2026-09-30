/**
 * Remove scaffolding-only files/directories after a successful setup, and apply
 * the first-setup file moves (`cleanup.replace`) and JSON key removals
 * (`cleanup.unset`) a starter declares.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { resolveWithin, validateRelativePath } = require('./transform');
const { detectIndent } = require('./features');

/**
 * Validate every cleanup target before deletion starts.
 *
 * @param {string}   root    - Project root.
 * @param {string[]} targets - Project-relative paths to remove.
 * @return {Object[]} Validated relative and absolute paths.
 */
const resolveCleanupTargets = (root, targets = []) => {
	if (!Array.isArray(targets)) {
		throw new Error(
			`Expected cleanup.targets to be an array, received ${JSON.stringify(targets)}`
		);
	}
	return targets.map((target) => {
		validateRelativePath(target);
		const full = resolveWithin(root, target);
		if (full === path.resolve(root)) {
			throw new Error(`Refusing to remove the project root: ${target}`);
		}
		return { target, full };
	});
};

/**
 * Delete validated cleanup targets, skipping paths that no longer exist.
 *
 * @param {string}   root    Project root.
 * @param {string[]} targets Relative paths to remove.
 * @param {Object}   ui      Status output.
 * @return {number} Number of targets removed.
 */
const runCleanup = (root, targets, ui) => {
	const resolved = resolveCleanupTargets(root, targets);
	let removed = 0;
	for (const { target, full } of resolved) {
		if (!fs.existsSync(full)) {
			continue;
		}
		fs.rmSync(full, { recursive: true, force: true });
		ui.info(`removed ${target}`);
		removed++;
	}
	return removed;
};

/**
 * Check for a plain `{}` object.
 *
 * @param {*} value Value to check.
 * @return {boolean} Whether value is a non-null, non-array object.
 */
const isPlainObject = (value) =>
	null !== value && 'object' === typeof value && !Array.isArray(value);

/**
 * Check whether a path exists and is a directory.
 *
 * @param {string} full Absolute path.
 * @return {boolean} Whether full is an existing directory.
 */
const isDirectory = (full) =>
	fs.existsSync(full) && fs.statSync(full).isDirectory();

/**
 * Require a config list to be an array.
 *
 * @param {*}      value Configured value.
 * @param {string} label Config location, for error messages.
 * @return {void}
 */
const assertArray = (value, label) => {
	if (!Array.isArray(value)) {
		throw new Error(
			`Expected ${label} to be an array, received ${JSON.stringify(value)}`
		);
	}
};

/**
 * Find the first value that already appeared earlier in a list.
 *
 * @param {Array} values Values to scan.
 * @return {number} Index of the first repeat, or -1 when every value is unique.
 */
const firstRepeat = (values) =>
	values.findIndex((value, index) => values.indexOf(value) !== index);

/**
 * Validate one configured path and resolve it inside the project root.
 *
 * @param {string} root  Project root.
 * @param {*}      value Configured path.
 * @param {string} label Config location, for error messages.
 * @return {string} Absolute path below root.
 */
const resolveEntryPath = (root, value, label) => {
	try {
		validateRelativePath(value);
	} catch {
		throw new Error(
			`Expected ${label} to be a relative path without "..", received ${JSON.stringify(value)}`
		);
	}
	const full = resolveWithin(root, value);
	if (full === path.resolve(root)) {
		throw new Error(
			`Expected ${label} to be a path below the project root, received ${JSON.stringify(value)}`
		);
	}
	return full;
};

/**
 * Refuse a path that a cleanup target would delete.
 *
 * @param {Object[]} targets Resolved cleanup targets.
 * @param {string}   full    Absolute path to check.
 * @param {string}   label   Config location, for error messages.
 * @param {string}   value   Configured path, for error messages.
 * @return {void}
 */
const assertOutsideTargets = (targets, full, label, value) => {
	const hit = targets.find(
		(target) =>
			full === target.full || full.startsWith(target.full + path.sep)
	);
	if (!hit) {
		return;
	}
	throw new Error(
		`Expected ${label} to be outside cleanup target "${hit.target}", received ${JSON.stringify(value)}`
	);
};

/**
 * Validate one `cleanup.replace` entry. The source may sit inside a cleanup
 * target, because moves run before targets are deleted; the destination may
 * not, or the moved file would be deleted with it.
 *
 * @param {string}   root    Project root.
 * @param {Object[]} targets Resolved cleanup targets.
 * @param {*}        entry   Configured `{ from, to }` pair.
 * @param {number}   index   Position in `cleanup.replace`.
 * @return {Object} The move with relative and absolute paths.
 */
const resolveMove = (root, targets, entry, index) => {
	const label = `cleanup.replace[${index}]`;
	if (!isPlainObject(entry)) {
		throw new Error(
			`Expected ${label} to be an object { from, to }, received ${JSON.stringify(entry)}`
		);
	}
	const fromFull = resolveEntryPath(root, entry.from, `${label}.from`);
	const toFull = resolveEntryPath(root, entry.to, `${label}.to`);
	if (fromFull === toFull) {
		throw new Error(
			`Expected ${label}.to to differ from ${label}.from, received ${JSON.stringify(entry.to)}`
		);
	}
	assertOutsideTargets(targets, toFull, `${label}.to`, entry.to);
	return { from: entry.from, to: entry.to, fromFull, toFull };
};

/**
 * Require every source and destination once, no source that another pair
 * writes, and no destination under another one (that file would block its
 * folder), so the moves never depend on their order or fail halfway.
 *
 * @param {Object[]} moves Resolved moves.
 * @return {void}
 */
const assertIndependentMoves = (moves) => {
	const repeatedTo = firstRepeat(moves.map((move) => move.toFull));
	if (-1 !== repeatedTo) {
		throw new Error(
			`Expected each cleanup.replace destination once, received ${JSON.stringify(moves[repeatedTo].to)} again at cleanup.replace[${repeatedTo}].to`
		);
	}
	const repeatedFrom = firstRepeat(moves.map((move) => move.fromFull));
	if (-1 !== repeatedFrom) {
		throw new Error(
			`Expected each cleanup.replace source once, received ${JSON.stringify(moves[repeatedFrom].from)} again at cleanup.replace[${repeatedFrom}].from`
		);
	}
	const destinations = moves.map((move) => move.toFull);
	const chained = moves.findIndex((move) =>
		destinations.includes(move.fromFull)
	);
	if (-1 !== chained) {
		throw new Error(
			`Expected cleanup.replace[${chained}].from not to be another pair's destination, received ${JSON.stringify(moves[chained].from)}`
		);
	}
	const nested = moves.findIndex((move) =>
		destinations.some((dest) => move.toFull.startsWith(dest + path.sep))
	);
	if (-1 !== nested) {
		throw new Error(
			`Expected cleanup.replace[${nested}].to not to sit under another pair's destination, received ${JSON.stringify(moves[nested].to)}`
		);
	}
};

/**
 * Validate one `cleanup.unset` entry.
 *
 * @param {string}   root    Project root.
 * @param {Object[]} targets Resolved cleanup targets.
 * @param {Object[]} moves   Resolved moves.
 * @param {*}        entry   Configured `{ file, keys }` entry.
 * @param {number}   index   Position in `cleanup.unset`.
 * @return {Object} The edit with relative and absolute paths.
 */
const resolveEdit = (root, targets, moves, entry, index) => {
	const label = `cleanup.unset[${index}]`;
	if (!isPlainObject(entry)) {
		throw new Error(
			`Expected ${label} to be an object { file, keys }, received ${JSON.stringify(entry)}`
		);
	}
	const full = resolveEntryPath(root, entry.file, `${label}.file`);
	const validKeys =
		Array.isArray(entry.keys) &&
		entry.keys.length > 0 &&
		entry.keys.every((key) => 'string' === typeof key && key.length > 0) &&
		-1 === firstRepeat(entry.keys);
	if (!validKeys) {
		throw new Error(
			`Expected ${label}.keys to be a nonempty array of unique key names, received ${JSON.stringify(entry.keys)}`
		);
	}
	assertOutsideTargets(targets, full, `${label}.file`, entry.file);
	if (moves.some((move) => [move.fromFull, move.toFull].includes(full))) {
		throw new Error(
			`Expected ${label}.file not to be a cleanup.replace source or destination, received ${JSON.stringify(entry.file)}`
		);
	}
	return { file: entry.file, full, keys: entry.keys };
};

/**
 * Require each JSON file once, so its keys are listed in one place.
 *
 * @param {Object[]} edits Resolved edits.
 * @return {void}
 */
const assertUniqueEdits = (edits) => {
	const repeated = firstRepeat(edits.map((edit) => edit.full));
	if (-1 === repeated) {
		return;
	}
	throw new Error(
		`Expected each cleanup.unset file once, received ${JSON.stringify(edits[repeated].file)} again at cleanup.unset[${repeated}].file`
	);
};

/**
 * Validate `cleanup.replace` and `cleanup.unset` before any file changes.
 *
 * `replace` lists `{ from, to }` file moves; `unset` lists `{ file, keys }`
 * top-level JSON key removals. Moves run before `cleanup.targets` are
 * deleted, so a source may live in a target folder, but no destination or
 * JSON file may sit in one. A JSON edit may not target a moved file.
 *
 * @param {string} root      Project root.
 * @param {Object} [cleanup] The scaffold config's `cleanup` block.
 * @return {{ moves: Object[], edits: Object[] }} Validated moves and JSON edits.
 */
const resolveSetupCleanup = (root, cleanup) => {
	const targets = resolveCleanupTargets(root, cleanup?.targets);
	const replace = cleanup?.replace ?? [];
	const unset = cleanup?.unset ?? [];
	assertArray(replace, 'cleanup.replace');
	assertArray(unset, 'cleanup.unset');

	const moves = replace.map((entry, index) =>
		resolveMove(root, targets, entry, index)
	);
	assertIndependentMoves(moves);

	const edits = unset.map((entry, index) =>
		resolveEdit(root, targets, moves, entry, index)
	);
	assertUniqueEdits(edits);

	return { moves, edits };
};

/**
 * Pre-flight one move: skip a missing source, refuse directories.
 *
 * @param {Object} move Resolved move.
 * @param {Object} ui   Status output.
 * @return {boolean} Whether the move should run.
 */
const checkMove = (move, ui) => {
	if (!fs.existsSync(move.fromFull)) {
		ui.warn(`skipped ${move.to}: ${move.from} not found`);
		return false;
	}
	if (isDirectory(move.fromFull)) {
		throw new Error(
			`Expected cleanup.replace source ${move.from} to be a file, received a directory`
		);
	}
	if (isDirectory(move.toFull)) {
		throw new Error(
			`Expected cleanup.replace destination ${move.to} to be a file, received a directory`
		);
	}
	return true;
};

/**
 * Pre-flight one JSON edit: skip a missing file, parse the rest.
 *
 * @param {Object} edit Resolved edit.
 * @param {Object} ui   Status output.
 * @return {Object|null} The edit with its raw text and parsed data, or null to skip.
 */
const readEdit = (edit, ui) => {
	if (!fs.existsSync(edit.full)) {
		ui.warn(`skipped ${edit.file}: file not found`);
		return null;
	}
	const raw = fs.readFileSync(edit.full, 'utf8');
	let data;
	try {
		data = JSON.parse(raw);
	} catch (err) {
		throw new Error(
			`Expected ${edit.file} to be valid JSON for cleanup.unset, received a parse error: ${err.message}`
		);
	}
	if (!isPlainObject(data)) {
		throw new Error(
			`Expected ${edit.file} to contain a JSON object for cleanup.unset, received ${JSON.stringify(data)}`
		);
	}
	return { ...edit, raw, data };
};

/**
 * Move a source file over its destination.
 *
 * @param {Object} move Checked move.
 * @param {Object} ui   Status output.
 * @return {void}
 */
const applyMove = (move, ui) => {
	fs.mkdirSync(path.dirname(move.toFull), { recursive: true });
	fs.renameSync(move.fromFull, move.toFull);
	ui.info(`replaced ${move.to} with ${move.from}`);
};

/**
 * Remove the listed keys that are present, keeping the file's indentation and
 * trailing newline. A file with none of the keys is left untouched.
 *
 * @param {Object} edit Parsed edit.
 * @param {Object} ui   Status output.
 * @return {number} Number of keys removed.
 */
const applyEdit = (edit, ui) => {
	const present = edit.keys.filter((key) => Object.hasOwn(edit.data, key));
	if (!present.length) {
		return 0;
	}
	const kept = Object.fromEntries(
		Object.entries(edit.data).filter(([key]) => !present.includes(key))
	);
	const eol = edit.raw.endsWith('\n') ? '\n' : '';
	const body = JSON.stringify(kept, null, detectIndent(edit.raw));
	fs.writeFileSync(edit.full, `${body}${eol}`);
	ui.info(`removed ${present.join(', ')} from ${edit.file}`);
	return present.length;
};

/**
 * Apply the first-setup `cleanup.replace` moves and `cleanup.unset` key
 * removals. Every source is checked and every JSON file parsed before the
 * first write, so a bad file fails setup before anything moves. Missing
 * sources and files are warned about and skipped.
 *
 * @param {string} root      Project root.
 * @param {Object} [cleanup] The scaffold config's `cleanup` block.
 * @param {Object} ui        Status output.
 * @return {{ replaced: number, unset: number }} Files moved and keys removed.
 */
const runSetupCleanup = (root, cleanup, ui) => {
	const { moves, edits } = resolveSetupCleanup(root, cleanup);
	const pendingMoves = moves.filter((move) => checkMove(move, ui));
	const pendingEdits = edits
		.map((edit) => readEdit(edit, ui))
		.filter(Boolean);

	pendingMoves.forEach((move) => applyMove(move, ui));
	const unset = pendingEdits.reduce(
		(count, edit) => count + applyEdit(edit, ui),
		0
	);
	return { replaced: pendingMoves.length, unset };
};

module.exports = {
	runCleanup,
	resolveCleanupTargets,
	resolveSetupCleanup,
	runSetupCleanup,
};
