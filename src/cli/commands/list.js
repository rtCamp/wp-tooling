// Subcommand contract: see `loadCommands` in `src/cli/index.js`. Lazy require
// in `run` keeps cold-start light when another subcommand is invoked.

'use strict';

module.exports = {
	name: 'list',
	summary: 'List all available scaffolds in the merged catalogue.',
	run: (argv) => require('../../scaffolds/list').runCli(argv),
};
