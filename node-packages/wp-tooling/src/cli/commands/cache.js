// Subcommand contract: see `loadCommands` in `src/cli/index.js`. Lazy require
// in `run` keeps cold-start light when another subcommand is invoked.

'use strict';

module.exports = {
	name: 'cache',
	summary:
		'Manage the on-disk cache for remote scaffold templates (e.g., wp-tooling cache clear).',
	run: (argv) => require('../../scaffolds/cache').runCli(argv),
};
