/**
 * Barrel for the CI helper library exposed as `@rtcamp/wp-tooling/ci`.
 */

'use strict';

const {
	detectChanges,
	DEFAULT_PATTERNS,
	DEFAULT_IGNORE,
} = require('./detect-changes');

module.exports = {
	detectChanges,
	DEFAULT_PATTERNS,
	DEFAULT_IGNORE,
};
