/**
 * Barrel for the CI helper library exposed as `@rtcamp/wp-tooling/ci`.
 */

'use strict';

const {
	detectChanges,
	DEFAULT_PATTERNS,
	DEFAULT_IGNORE,
} = require('./detect-changes');
const {
	computeGate,
	parseClover,
	parseLcov,
	parseDiffHunks,
} = require('./coverage-gate');

module.exports = {
	detectChanges,
	DEFAULT_PATTERNS,
	DEFAULT_IGNORE,
	computeGate,
	parseClover,
	parseLcov,
	parseDiffHunks,
};
