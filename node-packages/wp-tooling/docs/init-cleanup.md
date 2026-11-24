# Init cleanup and recovery

Starters can declare a `cleanup` block in their setup config:

```js
cleanup: {
    replace: [{ from: 'starter-docs/README.md', to: 'README.md' }],
    unset: [{ file: 'package.json', keys: ['homepage', 'repository', 'bugs'] }],
    targets: ['starter-docs'],
},
```

On first setup, the Cleanup step moves each source file over its destination, removes the configured top-level JSON keys, then deletes `targets`. Moves create missing destination directories. Sources can live inside a cleanup target because moves happen before deletion. JSON edits preserve indentation, LF or CRLF line endings, single-line layout and whether there is a trailing newline; other whitespace is normalized by JSON serialization.

Cleanup runs after identity changes, feature setup, identity persistence and the optional Composer autoloader step, and before Git initialization and the initial commit. `steps.cleanup: false` skips the whole Cleanup step. The `replace` and `unset` operations are first-setup choices: manage mode, `--reinit` and `--clean` do not run them. `--clean` only deletes `cleanup.targets`.

## Validation and errors

Setup validates cleanup configuration before changing files. Invalid paths, malformed entries, duplicate sources or destinations, conflicting moves and JSON edits, and destinations or JSON edits inside deletion targets stop setup. Destinations beneath a move source or another destination are rejected because the file would block the destination directory.

Before the first cleanup write, every move is checked and every existing JSON file is read and parsed. Directory sources or destinations, invalid JSON and JSON values that are not objects stop cleanup. These checks prevent cleanup writes for those errors; earlier setup steps may already have changed files.

A missing source or JSON file produces a warning and is skipped. Identical source and destination paths produce a notice and no move. JSON keys that are already absent require no write. A skipped operation does not guarantee that the intended project structure was produced; check the warnings and resulting files.

## Current recovery limitations

Cleanup is not transactional. Permission errors, locked files, cross-filesystem renames or other filesystem failures can interrupt it after earlier moves, JSON writes or deletions have completed. An overwritten destination is not backed up, and a failed JSON write may leave that file truncated. There is no automatic cleanup rollback, resume command or durable recovery journal, including after a process crash. Identity changes have their own rollback protection; it does not extend across the whole setup or cleanup flow.

`.wp-scaffold.json` is saved before cleanup and does not record cleanup completion. After a cleanup failure, a normal rerun enters manage mode, and `--reinit` skips the first-setup moves and key removals. Neither resumes pending cleanup. Running `--clean` cannot finish those operations and may delete a pending move's source when it is inside a cleanup target.

Keep a complete starter backup before setup. If setup fails after application begins:

1. Inspect the error and diff to identify partial changes; save any work you need to retain separately.
2. Restore the complete starter from the backup, including replaced or deleted files and the original state of `.wp-scaffold.json`, or start from a fresh starter copy. Removing only the identity file does not undo the changes.
3. Correct the reported configuration, JSON or filesystem problem in the restored starter and run setup again.

The CLI reports partial setup and asks you to restore your starter backup before retrying. Git-stage failures after project setup completes have separate guidance: finish Git setup manually rather than rerunning project setup.

## Follow-up work

Automatic recovery is deferred for this initial version. Follow-up work should track cleanup completion separately from identity, allow unfinished operations to resume without repeating completed setup steps, and restore affected sources, overwritten destinations and JSON contents on failure. Recovering deleted files or surviving a process crash requires durable backups and a recovery journal. Failure-and-retry tests should verify the final project structure, including failures midway through moves, JSON edits and deletions.
