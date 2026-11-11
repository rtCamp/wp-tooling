# Init cleanup and recovery

Starters can declare a `cleanup` block in their setup config:

```js
cleanup: {
    replace: [{ from: 'starter-docs/README.md', to: 'README.md' }],
    unset: [{ file: 'package.json', keys: ['homepage', 'repository', 'bugs'] }],
    targets: ['starter-docs', 'SECURITY.md'],
},
```

The Cleanup step moves each `replace` source over its destination, removes the `unset` keys from each JSON file, then deletes the `targets`. Moves create missing destination directories. Sources can live inside a target, because moves happen before deletion. JSON edits keep the file's indentation, LF or CRLF line endings, single-line layout and whether it ends with a newline; other whitespace is normalized by JSON serialization.

## When cleanup runs

Cleanup runs once, on first setup. Manage mode and `--reinit` never run it, so a file the project later creates at a target path (its own `SECURITY.md`, a regenerated `languages/` folder) is never deleted. A starter needs no `.wp-scaffold.json` check in its config to get this. `steps.cleanup: false` skips the step.

First setup runs in this order: identity changes, examples and features, cleanup, `composer dump-autoload`, then `.wp-scaffold.json`. Git initialization, hooks and the initial commit come after, so the initial commit already contains the cleaned-up project.

## Validation and errors

Setup validates the cleanup configuration before changing files. Invalid paths, malformed entries, duplicate sources or destinations, conflicting moves and JSON edits, and destinations or JSON edits inside a target stop setup. A destination beneath a move source or another destination is rejected, because the file would block the destination directory.

Before the first cleanup write, every move is checked and every existing JSON file is read and parsed. Directory sources or destinations, invalid JSON and JSON values that are not objects stop setup.

A missing source or JSON file produces a warning and is skipped. Identical source and destination paths produce a notice and no move. JSON keys that are already absent need no write. Check the warnings: a skipped operation means that part of the intended project structure was not produced.

## If setup fails

`.wp-scaffold.json` is the last file setup writes. Until it exists, every change setup makes to project files is recorded, and a failure undoes them in reverse order:

- identity replacements, renames and version updates
- example removal and marker stripping
- feature changes made through the FeatureApi (`api.write`, `api.remove`, `api.editJson`, `api.setEnv`, `api.setDefine`)
- cleanup moves, JSON key removals and target deletions
- a `vendor/` folder that `composer dump-autoload` created

Deleted and overwritten paths are kept in a `.wp-init-trash-*` folder in the project root until setup finishes, then that folder is removed. After a failure, setup reports the error and that its changes were undone; there is no `.wp-scaffold.json`, so fixing the problem and running `npm run init` again is a clean first setup. A failed `--reinit` restores the previous `.wp-scaffold.json` and files the same way.

Not undone:

- **Composer's changes to an existing `vendor/`**, and anything Composer scripts or plugins do. Setup says so when it applies; the next successful setup runs `composer dump-autoload` again.
- **Feature hooks that write files with `fs` directly** instead of the FeatureApi.
- **The Git steps.** They run after `.wp-scaffold.json` is written; if one fails, finish Git setup by hand rather than running setup again.

If an undo step itself fails, setup says which changes could not be undone and keeps the `.wp-init-trash-*` folder, which holds the deleted and overwritten files, and names it. Restore the project from version control or a copy before running setup again.

Rollback runs inside the init process. A killed process, Ctrl+C or a power loss while files are changing skips it: restore from version control, and look in any leftover `.wp-init-trash-*` folder for deleted files. A target on a different filesystem from the project root (a separate mount) cannot be moved into the trash, so setup fails and is rolled back.

## Projects set up with an earlier version

`--clean` has been removed. Before this version, setup wrote `.wp-scaffold.json` before cleanup, so a setup that failed during cleanup could leave starter files behind. If that happened to a project, delete the paths listed in the starter's `cleanup.targets` by hand.
