// Subcommand contract: see `loadCommands` in `src/cli/index.js`. Lazy require
// in `run` keeps cold-start light when another subcommand is invoked.

'use strict';

module.exports = {
	name: 'install-hooks',
	summary: 'Install commit-msg and pre-commit hooks into the current repo',
	run: (argv) => require('../../hooks/install').runCli(argv),
};
