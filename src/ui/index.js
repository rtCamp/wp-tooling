/**
 * TTY UI kit -- barrel export.
 *
 * Public API for @rtcamp/wp-tooling/ui.
 * Zero runtime dependencies.
 */
'use strict';

const { Wizard } = require('./wizard/index');
const { text, confirm, password } = require('./prompts/index');
const { checkbox, radio } = require('./selects/flat');
const { checkboxTree } = require('./selects/tree');
const { spinner } = require('./spinner/index');

module.exports = {
	// Wizard
	Wizard,
	// Prompts
	text,
	confirm,
	password,
	// Selects
	checkbox,
	radio,
	checkboxTree,
	// Spinner
	spinner,
};
