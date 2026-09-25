/**
 * Barrel for the perf runner library exposed as `@rtcamp/wp-tooling/perf`.
 */

'use strict';

const { runPerf } = require('./run');
const { normalizePerf } = require('./normalize');
const { resolveConfig } = require('./config');

module.exports = {
	runPerf,
	normalizePerf,
	resolveConfig,
};
