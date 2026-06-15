/**
 * `@rtcamp/wp-tooling/version-monitor` -- public entry point.
 *
 * Detects dependency updates that Dependabot does not cover (npm packages,
 * GitHub Actions, PHP/Node targets, WP-CLI, container base images) and applies
 * them. Driven by `.github/version-monitor.yml`. Used as a library or through
 * the `wp-tooling version-monitor` CLI.
 *
 * Zero runtime dependencies -- Node built-ins only.
 */

'use strict';

const { loadConfig } = require('./config');
const { detect } = require('./detect');
const { applyUpdates } = require('./updater');
const { report } = require('./reporter');
const { runCli } = require('./cli');

module.exports = {
	loadConfig,
	detect,
	applyUpdates,
	report,
	runCli,
};
