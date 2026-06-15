// Subcommand contract: see `loadCommands` in `src/cli/index.js`. Lazy require
// in `run` keeps cold-start light when another subcommand is invoked.

'use strict';

module.exports = {
	name: 'validate',
	summary: 'Validate scaffold manifests in the catalogue.',
	run: (argv) => require('../../scaffolds/validate').runCli(argv),
};
