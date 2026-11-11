/**
 * File journal for the init engine: every change records how to undo it, so a
 * failed setup can put the project back the way it was.
 *
 * Removed paths are renamed into a trash folder under the project root instead
 * of deleted, so whole trees come back on rollback. The journal lives in memory;
 * it is not a crash-recovery log.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/** Name prefix of the folder that holds removed paths until setup commits. */
const TRASH_PREFIX = '.wp-init-trash-';

/**
 * Find the directory `fs.mkdirSync(dir, { recursive: true })` would actually
 * create. Its recursive option can create several levels in one call, so
 * removing just this one directory on rollback undoes exactly that.
 *
 * @param {string} dir - Directory that is about to be mkdir'd.
 * @return {string|null} Topmost missing ancestor, or null if `dir` exists.
 */
const firstMissingAncestor = (dir) => {
	if (fs.existsSync(dir)) {
		return null;
	}
	let cur = dir;
	while (!fs.existsSync(path.dirname(cur))) {
		cur = path.dirname(cur);
	}
	return cur;
};

/**
 * Remove the folders a recursive mkdir created, deepest first, while they are
 * empty. A folder that still holds something is left alone: whatever is in it
 * was not undone, and its own undo entry reports why.
 *
 * @param {string}      dir     Deepest folder the mkdir ensured.
 * @param {string|null} created Topmost folder the mkdir created, or null.
 * @return {void}
 */
const removeCreatedDirs = (dir, created) => {
	if (!created) {
		return;
	}
	for (let cur = dir; ; cur = path.dirname(cur)) {
		try {
			fs.rmdirSync(cur);
		} catch (error) {
			if ('ENOENT' !== error.code) {
				return;
			}
		}
		if (cur === created) {
			return;
		}
	}
};

/**
 * Whether a path exists, without following a final symlink.
 *
 * @param {string} full Absolute path.
 * @return {boolean} Whether anything (including a dangling symlink) is there.
 */
const present = (full) =>
	Boolean(fs.lstatSync(full, { throwIfNoEntry: false }));

/**
 * File operations that act on disk directly, with no undo. The default for
 * helpers that take an optional journal.
 */
const directOps = {
	writeFile: (file, content, options) =>
		fs.writeFileSync(file, content, options),
	moveFile: (from, to) => {
		fs.mkdirSync(path.dirname(to), { recursive: true });
		fs.renameSync(from, to);
	},
	removePath: (full) => fs.rmSync(full, { recursive: true, force: true }),
};

/**
 * Create a journal of file changes that can be rolled back or committed.
 *
 * Each operation records one undo entry before it changes anything and tracks
 * which of its steps finished, so its undo only reverses what happened. A step
 * that depends on an earlier one is skipped when that one cannot be undone, so
 * a failed undo never destroys the data that survived.
 *
 * @param {string} [root] Project root; required to remove or move paths.
 * @return {Object} The journal.
 */
const createJournal = (root) => {
	const entries = [];
	let trash = null;
	let stashed = 0;

	const stash = (full) => {
		if (!root) {
			throw new Error(
				'journal: a project root is required to remove or move paths'
			);
		}
		if (!trash) {
			trash = fs.mkdtempSync(path.join(root, TRASH_PREFIX));
		}
		const kept = path.join(trash, String(stashed++));
		fs.renameSync(full, kept);
		return kept;
	};
	const unstash = (kept, full) => {
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.renameSync(kept, full);
	};

	const journal = {
		/**
		 * Write a file, keeping its previous bytes (or its absence) for rollback.
		 *
		 * @param {string} file      Absolute path.
		 * @param {*}      content   File body.
		 * @param {*}      [options] fs.writeFileSync options.
		 * @return {void}
		 */
		writeFile(file, content, options) {
			const existed = fs.existsSync(file);
			const original = existed ? fs.readFileSync(file) : null;
			// Register before writing: a failed write may have truncated the file.
			entries.push(() => {
				if (existed) {
					fs.writeFileSync(file, original);
				} else {
					fs.rmSync(file, { force: true });
				}
			});
			fs.writeFileSync(file, content, options);
		},

		/**
		 * Rename a path; rollback renames it back.
		 *
		 * @param {string} from Current path.
		 * @param {string} to   New path.
		 * @return {void}
		 */
		renameFile(from, to) {
			fs.renameSync(from, to);
			entries.push(() => fs.renameSync(to, from));
		},

		/**
		 * Remove a file or folder by moving it into the trash.
		 *
		 * @param {string} full Absolute path.
		 * @return {boolean} Whether anything was there to remove.
		 */
		removePath(full) {
			if (!present(full)) {
				return false;
			}
			const kept = stash(full);
			entries.push(() => unstash(kept, full));
			return true;
		},

		/**
		 * Move a file over its destination, backing up a destination that exists
		 * and creating missing parent folders.
		 *
		 * @param {string} from Source path.
		 * @param {string} to   Destination path.
		 * @return {void}
		 */
		moveFile(from, to) {
			const parent = path.dirname(to);
			const state = {
				backup: null,
				createdDir: firstMissingAncestor(parent),
				moved: false,
			};
			entries.push(() => {
				// If the source cannot go back, its content now lives only at `to`:
				// keep the backup and the folders rather than overwrite or remove it.
				if (state.moved) {
					fs.renameSync(to, from);
				}
				if (state.backup) {
					unstash(state.backup, to);
				}
				removeCreatedDirs(parent, state.createdDir);
			});
			if (present(to)) {
				state.backup = stash(to);
			}
			fs.mkdirSync(parent, { recursive: true });
			fs.renameSync(from, to);
			state.moved = true;
		},

		/**
		 * Record a custom synchronous undo step.
		 *
		 * @param {Function} undo Reverses a change made outside the journal.
		 * @return {void}
		 */
		record(undo) {
			entries.push(undo);
		},

		/**
		 * Undo every recorded change, newest first, continuing past failures.
		 * The trash is removed only when everything was restored; otherwise it
		 * keeps the paths that could not go back.
		 *
		 * @return {{ errors: Error[], trash: string|null }} Undo failures, and the trash folder when it is still on disk.
		 */
		rollback() {
			const errors = [];
			while (entries.length) {
				const undo = entries.pop();
				try {
					undo();
				} catch (error) {
					errors.push(error);
				}
			}
			const dir = trash;
			trash = null;
			if (dir && !errors.length) {
				try {
					fs.rmSync(dir, { recursive: true, force: true });
				} catch {
					// Reported below: the folder is still there.
				}
			}
			return { errors, trash: dir && fs.existsSync(dir) ? dir : null };
		},

		/**
		 * Keep every change: forget the undo steps and delete the trash folder.
		 *
		 * @return {string|null} The trash folder when it could not be removed.
		 */
		commit() {
			entries.length = 0;
			const dir = trash;
			trash = null;
			if (!dir) {
				return null;
			}
			try {
				fs.rmSync(dir, { recursive: true, force: true });
			} catch {
				// Returned below so the caller can ask for a manual removal.
			}
			return fs.existsSync(dir) ? dir : null;
		},
	};

	return journal;
};

module.exports = {
	TRASH_PREFIX,
	createJournal,
	directOps,
	firstMissingAncestor,
};
