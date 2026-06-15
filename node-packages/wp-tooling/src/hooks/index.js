/**
 * Barrel for the git-hooks helper library exposed as
 * `@rtcamp/wp-tooling/hooks`.
 */

'use strict';

const { installHooks, runCli, TEMPLATES } = require('./install');

module.exports = {
	installHooks,
	runCli,
	TEMPLATES,
};
