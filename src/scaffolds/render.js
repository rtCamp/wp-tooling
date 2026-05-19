/**
 * Minimal Mustache-style renderer for scaffold templates.
 *
 * Hand-rolled because the package policy is zero runtime dependencies.
 * Supports only the subset the scaffold engine needs:
 *
 *   {{name}}            simple variable substitution
 *   {{base_path}}/foo   variables inside paths
 *
 * Does NOT support: partials, sections (#name), inverted sections (^name),
 * comments, set delimiters. If a scaffold ever needs more, extend here.
 *
 * Critical: HTML escape is DISABLED. Templates render code (PHP, JS, YAML);
 * HTML-encoding would mangle generated code. This matches the project rule
 * `Mustache.escape = (text) => text` documented in CLAUDE.md.
 *
 * Undefined placeholders throw `RenderError` with code `ERENDERFAIL`. We
 * never silently render empty strings.
 *
 * Implements:
 *   WTL-06  rendering used by execute() for files, dests, and wiring snippets
 */

'use strict';

class RenderError extends Error {
	constructor(message, details = {}) {
		super(message);
		this.name = 'RenderError';
		this.code = details.code || 'ERENDERFAIL';
		Object.assign(this, details);
	}
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/**
 * Render a Mustache-style template string with the given variables.
 *
 * @param {string}                template - The template to render.
 * @param {Object<string,string>} vars     - Resolved input values keyed by name.
 * @return {string} Rendered string.
 * @throws {RenderError} If a placeholder is not in `vars`.
 */
function render(template, vars) {
	if (typeof template !== 'string') {
		throw new RenderError('render(): template must be a string', {
			code: 'ERENDERFAIL',
			received: typeof template,
		});
	}
	const safeVars = vars && typeof vars === 'object' ? vars : {};
	return template.replace(PLACEHOLDER_RE, (_match, key) => {
		if (!Object.prototype.hasOwnProperty.call(safeVars, key)) {
			throw new RenderError(`undefined placeholder '${key}'`, {
				code: 'ERENDERFAIL',
				placeholder: key,
			});
		}
		return String(safeVars[key]);
	});
}

/**
 * Collect every distinct placeholder name in a template.
 *
 * Used by execute() to determine which inputs a scaffold needs when the
 * manifest has no explicit `inputs[]` block (backward-compat path).
 *
 * @param {string} template
 * @return {string[]} Unique placeholder names, in first-appearance order.
 */
function collectPlaceholders(template) {
	if (typeof template !== 'string') {
		return [];
	}
	const seen = new Set();
	let match;
	PLACEHOLDER_RE.lastIndex = 0;
	while ((match = PLACEHOLDER_RE.exec(template)) !== null) {
		seen.add(match[1]);
	}
	return Array.from(seen);
}

const TRANSFORMS = {
	'pascal-case': (s) => splitWords(s).map(capitalise).join(''),
	'kebab-case': (s) => splitWords(s).join('-').toLowerCase(),
	'snake-case': (s) => splitWords(s).join('_').toLowerCase(),
	'upper-snake-case': (s) => splitWords(s).join('_').toUpperCase(),
};

function splitWords(s) {
	return String(s)
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.split(/[\s_\-/.]+/)
		.filter(Boolean);
}

function capitalise(word) {
	return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Apply a named transform to a value. Returns the value unchanged if no
 * transform is named (or the name is not recognised; validation should have
 * caught unknown names already).
 *
 * @param {string}           value
 * @param {string|undefined} name  - One of `pascal-case`, `kebab-case`, ...
 * @return {string} The transformed value (or the input unchanged when no transform applies).
 */
function applyTransform(value, name) {
	if (!name) {
		return value;
	}
	const fn = TRANSFORMS[name];
	return fn ? fn(value) : value;
}

module.exports = { render, collectPlaceholders, applyTransform, RenderError };
