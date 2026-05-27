/**
 * Minimal Mustache-style renderer for scaffold templates.
 *
 * Hand-rolled because the package policy is zero runtime dependencies.
 * Supports the subset the scaffold engine needs:
 *
 *   {{name}}                       simple variable substitution
 *   {{base_path}}/foo              variables inside paths
 *   {{#flag}}...{{/flag}}          section: render inner content when truthy
 *   {{^flag}}...{{/flag}}          inverted section: render when falsy
 *
 * Section flags are string values. Truthy = non-empty and not one of
 * `"false"`, `"no"`, `"0"`. Sections do not nest within themselves and
 * cannot iterate (we only need boolean flags, e.g. singleton vs multi).
 *
 * Does NOT support: partials, comments, set delimiters, iterating over
 * arrays/lists. Extend here if a scaffold ever needs more.
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
 *   WTL-10  conditional sections enabling pattern-flag templates (singleton/multi)
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
const SECTION_RE =
	/\{\{#\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}([\s\S]*?)\{\{\/\s*\1\s*\}\}/g;
const INVERTED_SECTION_RE =
	/\{\{\^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}([\s\S]*?)\{\{\/\s*\1\s*\}\}/g;
const ANY_TAG_RE = /\{\{[#^/]?\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

const FALSY_STRINGS = new Set(['', 'false', 'no', '0']);

function isTruthy(value) {
	if (typeof value !== 'string') {
		return Boolean(value);
	}
	return !FALSY_STRINGS.has(value.trim().toLowerCase());
}

/**
 * Render a Mustache-style template string with the given variables.
 *
 * Three passes, in order:
 *   1. Sections          `{{#flag}}...{{/flag}}` keep inner when truthy.
 *   2. Inverted sections `{{^flag}}...{{/flag}}` keep inner when falsy.
 *   3. Variables         `{{name}}` substituted with `vars[name]`.
 *
 * Section flags and variables are looked up the same way (both throw
 * ERENDERFAIL when the key is not in `vars`).
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

	let result = template.replace(SECTION_RE, (_match, key, inner) => {
		if (!Object.prototype.hasOwnProperty.call(safeVars, key)) {
			throw new RenderError(`undefined placeholder '${key}'`, {
				code: 'ERENDERFAIL',
				placeholder: key,
			});
		}
		return isTruthy(safeVars[key]) ? inner : '';
	});

	result = result.replace(INVERTED_SECTION_RE, (_match, key, inner) => {
		if (!Object.prototype.hasOwnProperty.call(safeVars, key)) {
			throw new RenderError(`undefined placeholder '${key}'`, {
				code: 'ERENDERFAIL',
				placeholder: key,
			});
		}
		return !isTruthy(safeVars[key]) ? inner : '';
	});

	return result.replace(PLACEHOLDER_RE, (_match, key) => {
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
 * Collect every distinct placeholder name in a template, including
 * section flags (`{{#key}}`, `{{^key}}`) and closing tags (`{{/key}}`).
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
	ANY_TAG_RE.lastIndex = 0;
	while ((match = ANY_TAG_RE.exec(template)) !== null) {
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
