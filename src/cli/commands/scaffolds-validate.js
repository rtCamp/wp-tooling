// Subcommand contract: see `loadCommands` in `src/cli/index.js`. Lazy require
// in `run` keeps cold-start light when another subcommand is invoked.

'use strict';

module.exports = {
	name: 'scaffolds-validate',
	summary: 'Validate every scaffold.json under a directory',
	run: (argv) => require('../../scaffolds/cli').runCli(argv),
};
