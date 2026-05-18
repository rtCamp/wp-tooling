/**
 * Scaffold engine -- public API.
 *
 * Library:
 *   const { ScaffoldRegistry, validate } = require( '@rtcamp/wp-tooling/scaffolds' );
 *
 * CLI:
 *   wp-tooling scaffolds-validate <dir>
 *
 * Zero runtime dependencies.
 */

'use strict';

const { ScaffoldRegistry } = require('./registry');
const { validate } = require('./validate');

module.exports = {
	ScaffoldRegistry,
	validate,
};
