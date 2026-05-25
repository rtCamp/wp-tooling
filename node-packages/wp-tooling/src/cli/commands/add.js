// Subcommand contract: see `loadCommands` in `src/cli/index.js`. Lazy require
// in `run` keeps cold-start light when another subcommand is invoked.

'use strict';

module.exports = {
	name: 'add',
	summary:
		'Add a scaffold to the current project (e.g., wp-tooling add wp/cli --name=qm-export).',
	run: (argv) => require('../../scaffolds/add').runCli(argv),
};
