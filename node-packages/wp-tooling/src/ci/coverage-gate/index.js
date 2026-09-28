/**
 * coverage-gate -- fail CI when too few of the lines a pull request changed are covered.
 *
 * Library API:
 *   const { computeGate, parseClover, parseLcov } = require( '@rtcamp/wp-tooling/ci' );
 *
 * CLI:
 *   wp-tooling coverage-gate --report coverage/clover.xml --threshold 80 [options]
 *
 * Zero runtime dependencies -- Node built-ins plus the `git` CLI.
 */

'use strict';

const { parseDiffHunks, gitChangedLines, resolveGateBase } = require('./diff');
const { parseClover, parseLcov, inferFormat } = require('./reports');
const {
	computeGate,
	indexReportPaths,
	matchReportFile,
	DEFAULT_EXCLUDE,
	DEFAULT_THRESHOLD,
} = require('./gate');
const { formatRanges, formatSummary } = require('./render');
const { runCli } = require('./cli');
const { GateError } = require('./errors');

module.exports = {
	computeGate,
	parseClover,
	parseLcov,
	parseDiffHunks,
	gitChangedLines,
	resolveGateBase,
	indexReportPaths,
	matchReportFile,
	inferFormat,
	formatRanges,
	formatSummary,
	runCli,
	GateError,
	DEFAULT_EXCLUDE,
	DEFAULT_THRESHOLD,
};
