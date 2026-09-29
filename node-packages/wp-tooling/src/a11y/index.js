/**
 * Barrel for the a11y runner library exposed as `@rtcamp/wp-tooling/a11y`.
 */

'use strict';

const { runA11y } = require('./run');
const { normalizeA11y } = require('./normalize');
const { resolveUrls } = require('./urls');

module.exports = {
	runA11y,
	normalizeA11y,
	resolveUrls,
};
