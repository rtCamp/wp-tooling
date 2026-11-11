'use strict';

const fs = require('fs');
const path = require('path');
const {
	TRASH_PREFIX,
	createJournal,
	directOps,
	firstMissingAncestor,
} = require('../../src/init/journal');
const { makeRoot, touch, snapshot, tree } = require('./_helpers');

describe('createJournal', () => {
	let root;
	const at = (rel) => path.join(root, rel);
	const read = (rel) => fs.readFileSync(at(rel), 'utf8');
	const trashEntries = () =>
		fs.readdirSync(root).filter((name) => name.startsWith(TRASH_PREFIX));

	beforeEach(() => {
		root = makeRoot();
	});
	afterEach(() => {
		jest.restoreAllMocks();
		fs.rmSync(root, { recursive: true, force: true });
	});

	test('writeFile restores an existing file and deletes a new one', () => {
		touch(root, 'kept.txt', 'before');
		const before = tree(root);
		const journal = createJournal(root);
		journal.writeFile(at('kept.txt'), 'after');
		journal.writeFile(at('new.txt'), 'new');
		expect(read('kept.txt')).toBe('after');
		expect(journal.rollback()).toEqual({ errors: [], trash: null });
		expect(read('kept.txt')).toBe('before');
		expect(tree(root)).toEqual(before);
	});

	test('removePath moves a file and a folder aside and brings both back', () => {
		touch(root, 'notes.md', 'notes');
		touch(root, 'docs/a/b.md', 'deep');
		const before = snapshot(root);
		const paths = tree(root);
		const journal = createJournal(root);
		expect(journal.removePath(at('notes.md'))).toBe(true);
		expect(journal.removePath(at('docs'))).toBe(true);
		expect(journal.removePath(at('missing.md'))).toBe(false);
		expect(fs.existsSync(at('docs'))).toBe(false);
		expect(trashEntries()).toHaveLength(1);
		journal.rollback();
		expect(snapshot(root)).toEqual(before);
		expect(tree(root)).toEqual(paths);
	});

	test('removing a folder and then a path that was inside it restores both', () => {
		touch(root, 'docs/inner.md', 'inner');
		touch(root, 'docs/outer.md', 'outer');
		const before = snapshot(root);
		const journal = createJournal(root);
		journal.removePath(at('docs/inner.md'));
		journal.removePath(at('docs'));
		journal.rollback();
		expect(snapshot(root)).toEqual(before);
	});

	test('moveFile backs up the destination and removes the folders it created', () => {
		touch(root, 'starter/README.md', 'project readme');
		touch(root, 'README.md', 'starter readme');
		touch(root, 'starter/guide.md', 'guide');
		const before = snapshot(root);
		const paths = tree(root);
		const journal = createJournal(root);
		journal.moveFile(at('starter/README.md'), at('README.md'));
		journal.moveFile(at('starter/guide.md'), at('docs/deep/guide.md'));
		expect(read('README.md')).toBe('project readme');
		expect(read('docs/deep/guide.md')).toBe('guide');
		expect(journal.rollback()).toEqual({ errors: [], trash: null });
		expect(snapshot(root)).toEqual(before);
		expect(tree(root)).toEqual(paths);
	});

	test('moveFile restores the destination when the move itself fails after the backup', () => {
		touch(root, 'source.md', 'source');
		touch(root, 'README.md', 'original');
		const before = snapshot(root);
		const paths = tree(root);
		const rename = fs.renameSync;
		jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
			if (from === at('source.md')) {
				throw new Error('move failed');
			}
			return rename(from, to);
		});
		const journal = createJournal(root);
		expect(() =>
			journal.moveFile(at('source.md'), at('README.md'))
		).toThrow('move failed');
		expect(fs.existsSync(at('README.md'))).toBe(false);
		expect(journal.rollback()).toEqual({ errors: [], trash: null });
		expect(snapshot(root)).toEqual(before);
		expect(tree(root)).toEqual(paths);
	});

	/**
	 * Make renaming `from` fail, as when the moved file cannot go back.
	 *
	 * @param {string} from Path whose rename fails.
	 * @return {void}
	 */
	const failRenameFrom = (from) => {
		const rename = fs.renameSync;
		jest.spyOn(fs, 'renameSync').mockImplementation((source, to) => {
			if (source === from) {
				throw new Error('rename back failed');
			}
			return rename(source, to);
		});
	};

	test('a source that cannot move back is not overwritten by the backed-up destination', () => {
		touch(root, 'source.md', 'source');
		touch(root, 'README.md', 'original');
		const journal = createJournal(root);
		journal.moveFile(at('source.md'), at('README.md'));
		failRenameFrom(at('README.md'));
		const { errors, trash } = journal.rollback();
		expect(errors.map((error) => error.message)).toEqual([
			'rename back failed',
		]);
		expect(read('README.md')).toBe('source');
		// The destination's backup stays in the kept trash.
		expect(trash).toBe(at(trashEntries()[0]));
		const [backup] = fs.readdirSync(trash);
		expect(fs.readFileSync(path.join(trash, backup), 'utf8')).toBe(
			'original'
		);
	});

	test('a source that cannot move back keeps the folders created for it', () => {
		touch(root, 'source.md', 'source');
		const journal = createJournal(root);
		journal.moveFile(at('source.md'), at('new/dir/README.md'));
		failRenameFrom(at('new/dir/README.md'));
		const { errors, trash } = journal.rollback();
		expect(errors.map((error) => error.message)).toEqual([
			'rename back failed',
		]);
		expect(read('new/dir/README.md')).toBe('source');
		expect(trash).toBeNull();
	});

	test('rollback keeps going past a failing entry and keeps the trash', () => {
		touch(root, 'a.md', 'a');
		touch(root, 'b.md', 'b');
		const journal = createJournal(root);
		journal.removePath(at('a.md'));
		journal.record(() => {
			throw new Error('first undo failed');
		});
		journal.removePath(at('b.md'));
		journal.record(() => {
			throw new Error('second undo failed');
		});
		const { errors, trash } = journal.rollback();
		expect(errors.map((error) => error.message)).toEqual([
			'second undo failed',
			'first undo failed',
		]);
		expect(read('a.md')).toBe('a');
		expect(read('b.md')).toBe('b');
		expect(trash).not.toBeNull();
		expect(fs.existsSync(trash)).toBe(true);
	});

	test('commit keeps the changes and deletes the trash folder itself', () => {
		touch(root, 'a.md', 'a');
		const journal = createJournal(root);
		journal.removePath(at('a.md'));
		journal.writeFile(at('b.md'), 'b');
		expect(trashEntries()).toHaveLength(1);
		expect(journal.commit()).toBeNull();
		expect(tree(root)).toEqual(['b.md']);
		// Nothing is left to undo.
		expect(journal.rollback()).toEqual({ errors: [], trash: null });
		expect(tree(root)).toEqual(['b.md']);
	});

	test('commit reports a trash folder it could not delete', () => {
		touch(root, 'a.md', 'a');
		const journal = createJournal(root);
		journal.removePath(at('a.md'));
		const [trashName] = trashEntries();
		jest.spyOn(fs, 'rmSync').mockImplementation(() => {
			throw new Error('busy');
		});
		expect(journal.commit()).toBe(at(trashName));
	});

	test('removing or moving needs a project root', () => {
		touch(root, 'a.md', 'a');
		expect(() => createJournal().removePath(at('a.md'))).toThrow(
			/project root is required/
		);
	});
});

describe('directOps', () => {
	let root;
	beforeEach(() => {
		root = makeRoot();
	});
	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
	});

	test('acts on disk with no trash', () => {
		touch(root, 'a.md', 'a');
		touch(root, 'gone/x.md', 'x');
		directOps.moveFile(path.join(root, 'a.md'), path.join(root, 'n/a.md'));
		directOps.removePath(path.join(root, 'gone'));
		directOps.writeFile(path.join(root, 'b.md'), 'b');
		expect(tree(root)).toEqual(['b.md', 'n', path.join('n', 'a.md')]);
	});
});

describe('firstMissingAncestor', () => {
	let root;
	beforeEach(() => {
		root = makeRoot();
	});
	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
	});

	test('names the topmost folder a recursive mkdir would create', () => {
		expect(firstMissingAncestor(root)).toBeNull();
		expect(firstMissingAncestor(path.join(root, 'a', 'b', 'c'))).toBe(
			path.join(root, 'a')
		);
	});
});
