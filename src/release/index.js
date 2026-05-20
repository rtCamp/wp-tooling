/**
 * Release scripts -- barrel export.
 *
 * Programmatic access to the three release operations. CLI adapters
 * live under `src/cli/commands/release-*.js`.
 */

'use strict';

const { bump } = require('./bump');
const { changelog } = require('./changelog');
const { zip } = require('./zip');
const { loadContext, findPluginEntry } = require('./context');

module.exports = {
	bump,
	changelog,
	zip,
	loadContext,
	findPluginEntry,
};
