/**
 * Scaffolds barrel export.
 *
 * Public API for `@rtcamp/wp-tooling/scaffolds`. The engine core
 * (registry, validate, render) is exported here and has zero TTY UI
 * dependency. Interactive prompting lives in `prompt-inputs.js` and is
 * a separate import so AI / CI consumers can avoid loading it.
 */

'use strict';

const { ScaffoldRegistry, ScaffoldError } = require('./registry');
const { validate } = require('./validate');
const {
	render,
	collectPlaceholders,
	applyTransform,
	RenderError,
} = require('./render');
const schema = require('./schema');

module.exports = {
	ScaffoldRegistry,
	ScaffoldError,
	RenderError,
	validate,
	render,
	collectPlaceholders,
	applyTransform,
	schema,
};
