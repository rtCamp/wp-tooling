// Subcommand contract: see `loadCommands` in `src/cli/index.js`. Lazy require
// in `run` keeps cold-start light when another subcommand is invoked.

'use strict';

module.exports = {
	name: 'features',
	summary:
		'Toggle project features on/off (e.g., wp-tooling features --enable tailwind).',
	run: (argv) => require('../../scaffolds/features').runCli(argv),
};
