/**
 * iapi-check -- find Interactivity API usages that WordPress 7.2 stops supporting.
 *
 * Library API:
 *   const { checkIapi, scanIapiText } = require( '@rtcamp/wp-tooling/ci' );
 *
 * CLI:
 *   wp-tooling iapi-check [--working-dir .] [--output text|github|json] [options]
 *
 * Zero runtime dependencies -- Node built-ins, plus the `git` CLI for
 * annotation paths in github mode.
 */

'use strict';

const { checkIapi, scanText, SKIPPED_DIRS } = require('./scan');
const { RULES, SOURCE_URL, WP_RELEASE_DATE, WP_VERSION } = require('./rules');
const {
	buildAnnotations,
	formatJson,
	formatSummary,
	formatText,
	stepOutputs,
} = require('./render');
const { runCli } = require('./cli');
const { IapiCheckError } = require('./errors');

module.exports = {
	checkIapi,
	scanText,
	runCli,
	buildAnnotations,
	formatJson,
	formatSummary,
	formatText,
	stepOutputs,
	IapiCheckError,
	RULES,
	SKIPPED_DIRS,
	SOURCE_URL,
	WP_RELEASE_DATE,
	WP_VERSION,
};
